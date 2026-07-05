import { type Role, headshotObjectKey, thumbnailObjectKey } from "@pbe/shared";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { ProfileCache } from "../data/cache.js";
import type { ImageStore } from "../data/images.js";
import type { ProfileStore } from "../data/profiles.js";
import { type AdminUserStore, LastAdminError } from "../data/users.js";
import type { GhostLifecycle } from "../identity/ghost-lifecycle.js";
import type { SessionService } from "../identity/session-store.js";
import { readRateLimit, writeRateLimit } from "../security/rate-limit.js";
import {
  authorizePrivileged,
  mergeProfile,
  parseProfileId,
  requireEffectiveAdmin,
  revokeSessionsBestEffort,
} from "./privileged-support.js";
import type { Clock } from "./profiles.js";

/**
 * The **admin-only** privileged controls of 4c-2 (DECISIONS N39/N41/N44):
 *
 *  - `DELETE /api/profiles/{id}` — remove a brother across Ghost, GCS, and Book,
 *    **Ghost-first** (D96/D98), scrubbing inbound references (`bigBrotherId`,
 *    `users.stars`) first so no dangling pointer survives, then the idempotent
 *    Book-side deletes (GCS objects → `users` doc → `profiles` doc). API-SPEC §4.
 *  - `PUT /api/users/{id}/role` — the Change-role function with the server-enforced
 *    last-admin invariant and create-if-absent for a never-signed-in brother
 *    (N44). API-SPEC §5.
 *
 * Both authorize at the caller's **effective** admin role (a "View as manager/
 * brother" admin cannot delete or change roles — N31), via the shared
 * {@link authorizePrivileged} guard.
 */
export interface AdminRouteDeps {
  cache: ProfileCache;
  gate: preHandlerHookHandler;
  store: ProfileStore;
  /** Session revocation on delete + role change (OFC-147). */
  sessionStore: SessionService;
  imageStore: ImageStore;
  /** The admin `users` operations: role change (with the invariant) + delete scrubs. */
  adminUsers: AdminUserStore;
  /** Ghost-first member lifecycle (N41); a succeed-and-log stub until Phase 5. */
  ghostLifecycle: GhostLifecycle;
  audit: AuditLog;
  clock: Clock;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  registerDelete(app, deps);
  registerRoleRead(app, deps);
  registerRole(app, deps);
}

/**
 * `GET /api/users/{id}/role` — read a brother's current role (admin only; API-SPEC
 * §5). Backs the admin Role control so its segmented control can highlight the
 * active role. Returns `brother` when the brother has no `users` document yet (a
 * never-signed-in brother — the role a first sign-in would give, R20/N44). A read,
 * so it is not audited; `404` only when no **profile** with that id exists.
 */
function registerRoleRead(app: FastifyInstance, deps: AdminRouteDeps): void {
  const { cache, gate, adminUsers } = deps;
  app.get(
    "/api/users/:id/role",
    { preHandler: gate, config: readRateLimit() },
    async (request, reply) => {
      // Admin-only at the caller's **effective** role (a "View as" step-down loses it,
      // N31), via the shared guard (OFC-185). No denial audit passed — a role *read*'s
      // denial is not audited, consistent with the pre-existing behavior here.
      if (requireEffectiveAdmin(request, reply) === null) {
        return reply;
      }
      const id = parseProfileId(request);
      if (id === null) {
        return reply.code(400).send({ error: "bad_request", message: "Invalid profile id." });
      }
      if (!cache.getById(id)) {
        return reply.code(404).send({ error: "not_found", message: "No such brother." });
      }
      return reply
        .header("Cache-Control", "no-store")
        .send({ id, role: await adminUsers.getRole(id) });
    },
  );
}

/**
 * `DELETE /api/profiles/{id}` — the admin delete (API-SPEC §4; D96/D98). The fixed
 * order leaves a benign state on any partial failure: **Ghost member first**
 * (abort clean on failure — `502`, Book untouched); then the reference scrub and
 * the idempotent Book-side deletes. Reference scrubbing (clearing `bigBrotherId ==
 * id` and pulling `id` from every `users.stars`) runs before the record is
 * removed, so the delete leaves no dangling pointer. The in-memory cache is
 * updated last, in one atomic swap ({@link ProfileCache.applyDelete}).
 */
function registerDelete(app: FastifyInstance, deps: AdminRouteDeps): void {
  const { cache, gate, store, sessionStore, imageStore, adminUsers, ghostLifecycle, audit, clock } =
    deps;
  app.delete(
    "/api/profiles/:id",
    { preHandler: gate, config: writeRateLimit() },
    async (request, reply) => {
      const ctx = authorizePrivileged(
        request,
        reply,
        cache,
        audit,
        clock,
        "profile.delete",
        "admin",
      );
      if (ctx === null) {
        return reply;
      }
      const { actorId, id, stored, trace } = ctx;
      const now = clock();

      // Last-admin invariant (D106; OFC-134): deleting the only remaining admin would
      // lock the org out of every admin function — the same lockout the role-change
      // guard prevents — and the UI deliberately doesn't show roles, so an admin can't
      // see they're removing the last one. Checked BEFORE the Ghost-first step so a
      // rejection leaves Ghost, GCS, and Book untouched.
      if (await adminUsers.isLastAdmin(id)) {
        audit.record(
          { action: "profile.delete", actorId, targetId: id, outcome: "denied", trace },
          now.toISOString(),
        );
        return reply.code(409).send({ error: "last_admin" });
      }

      // Ghost-first (D96/D98): if the Ghost member delete fails, abort clean — no
      // Book state has been touched, and the admin retries.
      try {
        await ghostLifecycle.deleteMember(stored);
      } catch {
        return reply.code(502).send({ error: "ghost_delete_failed" });
      }

      // Scrub inbound Big-Brother references first (D98): clear `bigBrotherId` on
      // every record that named this brother, capturing each write's fresh token so
      // the cache stays consistent (no spurious future 412 on a scrubbed referrer).
      // The writes run in parallel (OFC-138), and each scrubbed copy is re-read from
      // the cache *after* its write (never the pre-await snapshot, OFC-135) so a PATCH
      // that committed to a referrer during the write window is preserved rather than
      // clobbered when applyDelete folds these back in — the same re-base discipline
      // commitStatusWrite uses (OFC-125). A referrer *newly* created during the window
      // is not caught here; the D98 graceful-straggler rendering is the backstop.
      const scrubbed = await Promise.all(
        cache.referrersOf(id).map(async (referrer) => {
          const token = await store.updateUnconditional(referrer.id, {
            set: {},
            remove: ["bigBrotherId"],
          });
          const current = cache.getById(referrer.id) ?? referrer;
          return { profile: mergeProfile(current, {}, ["bigBrotherId"]), token };
        }),
      );

      // Scrub star references (private `users.stars`, outside the profile cache).
      await adminUsers.removeStarFromAll(id);

      // Purge the current-version image objects (best-effort; older versions and any
      // straggler are covered by the D94 bucket lifecycle). Never fail the delete.
      if (stored.hasHeadshot && stored.headshotVersion) {
        await purge(imageStore, [
          headshotObjectKey(id, stored.headshotVersion),
          thumbnailObjectKey(id, stored.headshotVersion),
        ]);
      }

      // The idempotent Book-side deletes: users doc, then the profile doc.
      await adminUsers.deleteUser(id);
      await store.delete(id);

      // Cache last: remove the record and fold in the scrubbed referrers + tokens.
      await cache.applyDelete(id, scrubbed);

      // Revoke the deleted brother's own live sessions (OFC-147). The gate does
      // NOT self-heal this (it passes on record *absence*), so revocation is the
      // control — but best-effort: a transient failure here must not fail an
      // otherwise-complete delete or drop its audit entry; it degrades to the
      // D22 cap and logs (OFC-146 review).
      const sessionsRevoked = await revokeSessionsBestEffort(sessionStore, id, {
        action: "profile.delete",
        actorId,
      });

      audit.record(
        { action: "profile.delete", actorId, targetId: id, outcome: "ok", sessionsRevoked, trace },
        now.toISOString(),
      );
      return reply.code(204).send();
    },
  );
}

/** The three assignable roles (API-SPEC §5). */
const ROLES: ReadonlySet<string> = new Set<Role>(["brother", "manager", "admin"]);

/**
 * `PUT /api/users/{id}/role` — the admin Change-role function (API-SPEC §5; D51/
 * N44). The target must be an existing **profile** (404 otherwise); a missing
 * `users` doc is created with the given role (N44), so a never-signed-in brother
 * is promotable. The last-admin invariant is enforced server-side inside the
 * store's transaction (`409 last_admin`). Audited with the before/after role
 * (D106).
 */
function registerRole(app: FastifyInstance, deps: AdminRouteDeps): void {
  const { cache, gate, sessionStore, adminUsers, audit, clock } = deps;
  app.put(
    "/api/users/:id/role",
    { preHandler: gate, config: writeRateLimit() },
    async (request, reply) => {
      // The `:id` addresses a brother; existence is checked against `profiles`
      // (N44), which is exactly what `authorizePrivileged` verifies against the cache.
      const ctx = authorizePrivileged(request, reply, cache, audit, clock, "role.change", "admin");
      if (ctx === null) {
        return reply;
      }
      const { actorId, id, trace } = ctx;

      const role = (request.body as { role?: unknown } | null)?.role;
      if (typeof role !== "string" || !ROLES.has(role)) {
        return reply.code(422).send({
          error: "validation_failed",
          message: "Role must be brother, manager, or admin.",
        });
      }

      const now = clock();
      let before: Role;
      try {
        ({ before } = await adminUsers.setRole(id, role as Role));
      } catch (error) {
        if (error instanceof LastAdminError) {
          return reply.code(409).send({ error: "last_admin" });
        }
        throw error;
      }

      // Revoke the target's live sessions when the role actually changed (OFC-147):
      // the role is snapshotted on the session, so without this a demoted admin
      // keeps admin powers — and could re-promote themselves — until the 4-hour cap
      // (D22). The next request re-auths through the bridge and picks up the new
      // role. A no-op reassignment (same role) touches nothing. This includes the
      // admin demoting themselves (legal when other admins remain): their own
      // session is torn down, this response still completes, and their next action
      // re-auths silently. Best-effort (OFC-146 review): a transient revocation
      // failure logs and degrades to the D22 cap rather than dropping the audit.
      const sessionsRevoked =
        before === role
          ? 0
          : await revokeSessionsBestEffort(sessionStore, id, { action: "role.change", actorId });

      audit.record(
        {
          action: "role.change",
          actorId,
          targetId: id,
          outcome: "ok",
          fromRole: before,
          toRole: role,
          sessionsRevoked,
          trace,
        },
        now.toISOString(),
      );
      return reply.header("Cache-Control", "no-store").send({ id, role });
    },
  );
}

/** Best-effort delete of object keys — swallows failures (D94 recovery covers them). */
async function purge(imageStore: ImageStore, keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await imageStore.delete(key);
      } catch {
        // A failed purge leaves a recoverable orphan (versioning + lifecycle, D94).
      }
    }),
  );
}
