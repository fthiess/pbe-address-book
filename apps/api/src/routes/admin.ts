import { type Role, headshotObjectKey, isRoleEligible, thumbnailObjectKey } from "@pbe/shared";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { ProfileCache } from "../data/cache.js";
import type { ImageStore } from "../data/images.js";
import type { ProfileStore } from "../data/profiles.js";
import type { AdminUserStore } from "../data/users.js";
import { AuditingGhostLifecycle } from "../identity/ghost-audit-lifecycle.js";
import type { GhostLifecycle } from "../identity/ghost-lifecycle.js";
import type { SessionService } from "../identity/session-store.js";
import { writeRateLimit } from "../security/rate-limit.js";
import {
  authorizePrivileged,
  commitStatusWrite,
  mergeProfile,
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
 *  - `PUT /api/profiles/{id}/role` — the Change-role function with the
 *    server-enforced last-admin invariant. Re-pathed from `…/users/{id}/role`
 *    once `role` moved onto the profile (OFC-139, superseding N44/N50): it is now
 *    a protected-field profile write (like `…/deceased` / `…/debrothered`) that
 *    advances the cache token, and the invariant reads {@link ProfileCache.adminCount}.
 *    API-SPEC §5.
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
  /** The admin `users`-collection delete scrubs (stars removal, user-doc delete, orphan audit). */
  adminUsers: AdminUserStore;
  /** Ghost-first member lifecycle (N41); a succeed-and-log stub until Phase 5. */
  ghostLifecycle: GhostLifecycle;
  audit: AuditLog;
  clock: Clock;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  registerDelete(app, deps);
  registerRole(app, deps);
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

      // Last-admin invariant (D106; OFC-134/OFC-241): deleting the sole usable admin
      // would lock the org out of every admin function — the same lockout the
      // role-change / mark-deceased / de-brother guards prevent. (Deleting a nominal-only
      // admin — deceased/emailless/de-brothered — is never blocked; it removes no usable
      // admin.) Checked BEFORE the Ghost-first step so a rejection leaves Ghost, GCS, and
      // Book untouched.
      if (cache.isSoleUsableAdmin(stored)) {
        audit.record(
          { action: "profile.delete", actorId, targetId: id, outcome: "denied", trace },
          now.toISOString(),
        );
        return reply.code(409).send({ error: "last_admin" });
      }

      // Ghost-first (D96/D98): if the Ghost member delete fails, abort clean — no
      // Book state has been touched, and the admin retries. **Only when the brother
      // actually has a Ghost member** (OFC-201 follow-up): a Book-only brother — no
      // email, so no Ghost record, an explicitly tolerated state (C15/D20/D115) — has
      // nothing to delete, and calling `deleteMember` without a `ghostMemberId` would
      // throw in the real client (→ a spurious 502 that makes ~1/3 of the real roster
      // undeletable). Skip the Ghost step for them.
      if (stored.ghostMemberId) {
        // Audit the Ghost member delete at the seam (`ghost.push`, 7a-3a) — the failed
        // case included, which the abort-clean 502 below would otherwise leave unrecorded.
        const auditedGhost = new AuditingGhostLifecycle(ghostLifecycle, audit, clock, {
          actorId,
          trace,
        });
        try {
          await auditedGhost.deleteMember(stored);
        } catch {
          return reply.code(502).send({ error: "ghost_delete_failed" });
        }
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
        trace,
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
 * `PUT /api/profiles/{id}/role` — the admin Change-role function (API-SPEC §5;
 * D51/D106; re-pathed from `…/users/{id}/role` by OFC-139, superseding N44/N50).
 * The target must be an existing **profile** (404 otherwise). Now that `role`
 * lives on the profile it is a **protected-field profile write**, committed like
 * mark-deceased / de-brother through {@link commitStatusWrite} so the cache token
 * advances in lock-step. The last-admin invariant reads the authoritative
 * in-memory admin count ({@link ProfileCache.adminCount}) rather than a Firestore
 * `users` query: a demotion of the sole admin is rejected `409 last_admin`.
 * Audited with the before/after role (D106).
 */
function registerRole(app: FastifyInstance, deps: AdminRouteDeps): void {
  const { cache, gate, store, sessionStore, audit, clock } = deps;
  app.put(
    "/api/profiles/:id/role",
    { preHandler: gate, config: writeRateLimit() },
    async (request, reply) => {
      const ctx = authorizePrivileged(request, reply, cache, audit, clock, "role.change", "admin");
      if (ctx === null) {
        return reply;
      }
      const { actorId, id, stored, trace } = ctx;

      const role = (request.body as { role?: unknown } | null)?.role;
      if (typeof role !== "string" || !ROLES.has(role)) {
        return reply.code(422).send({
          error: "validation_failed",
          message: "Role must be brother, manager, or admin.",
        });
      }

      const now = clock();
      // Role now lives on the profile (concrete in the cache — created records are
      // stamped `brother`, hydrated ones normalized), so the prior role is simply the
      // stored record's: no separate read, no create-if-absent (the profile always
      // exists, checked above). A same-role reassignment is a no-op.
      const before: Role = stored.role;
      const changed = role !== before;

      // Promote-guard (OFC-241; the D129 hygiene half): a brother who can't sign in —
      // deceased, de-brothered, or with no usable email — can never exercise a role, so
      // making them **any staff role** (manager or admin) only creates a nominal,
      // unusable staff member. Reject at the source rather than let it dangle. (A no-op
      // reassignment is not a promotion, so `changed` gates this; you can always still
      // demote them to `brother`. Cleaning up an *existing* nominal admin is OFC-242.)
      if (changed && role !== "brother" && !isRoleEligible(stored)) {
        return reply.code(422).send({
          error: "validation_failed",
          message:
            "This brother can’t sign in (deceased, de-brothered, or no email on file), so they can’t be made a manager or administrator.",
        });
      }

      // Last-admin invariant (D51/D106; OFC-241): demoting the sole usable admin to a
      // non-admin role would leave zero usable admins and lock the org out. Demoting a
      // nominal-only admin is not blocked (they were never counted). The narrow
      // check-then-write race is the same one the delete path accepts as negligible
      // under the single-instance model (D83).
      if (role !== "admin" && cache.isSoleUsableAdmin(stored)) {
        return reply.code(409).send({ error: "last_admin" });
      }

      // Only a real change writes and revokes; a no-op reassignment does neither (but
      // is still audited, with sessionsRevoked 0, for OFC-147 parity).
      let sessionsRevoked: number | null = 0;
      if (changed) {
        // Commit as a protected-field profile write (advances the cache token in
        // lock-step, tolerating a concurrent PATCH — OFC-125/136); `lastModified` is
        // stamped like the other status writes.
        await commitStatusWrite(
          store,
          cache,
          id,
          stored,
          { role: role as Role, lastModified: now.toISOString() },
          [],
        );
        // Revoke the target's live sessions (OFC-147): the role is snapshotted on the
        // session, so without this a demoted admin keeps admin powers — and could
        // re-promote themselves — until the 4-hour cap (D22). The next request re-auths
        // and picks up the new role. This includes an admin demoting themselves (legal
        // when other admins remain): their own session is torn down, this response still
        // completes, and their next action re-auths silently. Best-effort (OFC-146): a
        // transient failure logs and degrades to the cap.
        sessionsRevoked = await revokeSessionsBestEffort(sessionStore, id, {
          action: "role.change",
          actorId,
          trace,
        });
      }

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
