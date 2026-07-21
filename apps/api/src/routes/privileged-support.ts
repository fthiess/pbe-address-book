import { type ConsentSnapshot, type Profile, type Role, canActOnProfile } from "@pbe/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditAction, AuditLog } from "../audit/audit-log.js";
import { type DiagnosticLog, diagnosticLog } from "../audit/diagnostic-log.js";
import type { ProfileCache } from "../data/cache.js";
import { MissingProfileError, type ProfileStore, isTokenNewer } from "../data/profiles.js";
import type { SessionService } from "../identity/session-store.js";
import { effectiveRole } from "../identity/types.js";
import type { Clock } from "./profiles.js";
import { traceId } from "./trace.js";

/**
 * Best-effort session revocation for a privileged action (OFC-147; OFC-146
 * review). The de-brother/delete/role-change routes call this **after** their
 * state change has already committed, so a transient failure in
 * {@link SessionService.destroyAllForProfile} must not throw out of the
 * handler: that would drop the action's audit entry and — for role-change and
 * delete, which the gate cannot self-heal (it keys on de-brothered, not on role
 * or absence) — leave the change committed with no audit trail and a masked 500
 * whose retry does not re-revoke. So on failure we log loudly to stderr and
 * return `null`, degrading to the D22 4-hour session cap (the accepted baseline
 * this proactive revocation only *improves* on, never replaces). The return
 * value feeds the audit `sessionsRevoked` field: a count on success, `null` when
 * revocation failed so the forensic record shows the cap is the backstop.
 */
export async function revokeSessionsBestEffort(
  sessionStore: SessionService,
  profileId: number,
  context: { action: AuditAction; actorId: number },
  diagnostics: DiagnosticLog = diagnosticLog,
): Promise<number | null> {
  try {
    return await sessionStore.destroyAllForProfile(profileId);
  } catch (error) {
    // Constant message; the action, actor, and target ride structured slots and
    // the raw error detail is scrubbed (P10). Loud enough that the fall-back to
    // the D22 cap is visible in the forensic record.
    diagnostics.error("session revocation failed; falling back to the 4-hour session cap", {
      action: context.action,
      actorId: context.actorId,
      targetId: profileId,
      detail: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

/**
 * Shared front-half for 4c-2's privileged, dedicated server actions (verify,
 * mark-deceased, de-brother, delete, change-role). Each is a small route with the
 * same skeleton the PATCH and headshot paths already use — session → valid id →
 * role-tier predicate (the IDOR guard, at the caller's **effective** role, N31) →
 * record exists — differing only in *which* tier it requires and, for the status
 * writes, a shared unconditional-write-then-cache-apply commit. Factored here so
 * the five endpoints share one audited guard rather than five copies.
 */

/**
 * The authorization tier a privileged action requires, evaluated at the caller's
 * **effective** role so a "View as" step-down genuinely loses the power (N31):
 * - `owner-or-staff` — the owner, a manager, or an admin (verify; `canActOnProfile`).
 * - `staff` — manager or admin only (mark-deceased).
 * - `admin` — admin only (de-brother, delete, change-role).
 */
export type RoleTier = "owner-or-staff" | "staff" | "admin";

function tierAllows(tier: RoleTier, role: Role, actorId: number, targetId: number): boolean {
  switch (tier) {
    case "owner-or-staff":
      return canActOnProfile(role, actorId, targetId);
    case "staff":
      return role === "manager" || role === "admin";
    case "admin":
      return role === "admin";
  }
}

/** The authorized context a privileged route works from once the guards pass. */
export interface PrivilegedContext {
  actorId: number;
  role: Role;
  id: number;
  stored: Profile;
  trace: string | undefined;
}

/**
 * The shared guard: session (belt-and-suspenders behind the `gate` preHandler) →
 * valid Constitution id → the required role tier (the **audited** IDOR denial,
 * mirroring PATCH/headshot so probing contiguous ids leaves a trail) → the record
 * exists. Returns the context, or `null` after sending the matching error (the
 * caller returns `reply` unchanged). The `stored` record is the raw cached record
 * (visibility hides are irrelevant — staff act on hidden records here).
 */
export function authorizePrivileged(
  request: FastifyRequest,
  reply: FastifyReply,
  cache: ProfileCache,
  audit: AuditLog,
  clock: Clock,
  action: AuditAction,
  tier: RoleTier,
): PrivilegedContext | null {
  const session = request.session;
  if (!session) {
    reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
    return null;
  }
  const actor = session.identity;
  const role = effectiveRole(session);
  const id = parseProfileId(request);
  if (id === null) {
    reply.code(400).send({ error: "bad_request", message: "Invalid profile id." });
    return null;
  }
  const trace = traceId(request);

  if (!tierAllows(tier, role, actor.profileId, id)) {
    audit.record(
      { action, actorId: actor.profileId, targetId: id, outcome: "denied", trace },
      clock().toISOString(),
    );
    reply.code(403).send({ error: "forbidden", message: "You may not perform this action." });
    return null;
  }

  const stored = cache.getById(id);
  if (!stored) {
    reply.code(404).send({ error: "not_found", message: "No such brother." });
    return null;
  }
  return { actorId: actor.profileId, role, id, stored, trace };
}

/**
 * The optional denial-audit context for {@link requireEffectiveAdmin}: pass it to
 * record an `outcome:"denied"` entry when a valid non-admin session is refused
 * (OFC-190), mirroring {@link authorizePrivileged}'s per-record IDOR trail. Omit it
 * for read endpoints whose denials are not audited.
 */
export interface AdminDenialAudit {
  action: AuditAction;
  audit: AuditLog;
  clock: Clock;
}

/**
 * Guard for a whole-database admin action that has **no `:id` subject** (the banner
 * set and the backup download). Session present (belt-and-suspenders behind the
 * `gate` preHandler) + effective-role admin (N31, so a "View as" step-down
 * genuinely loses the power). Returns the actor's Constitution id, or `null` after
 * sending the matching 401/403 (the caller returns `reply` unchanged). Unlike
 * {@link authorizePrivileged} it parses no id; pass `denial` to audit the 403 for
 * the whole-database surfaces (banner set, backup download), where a probe by a
 * stepped-down admin is worth the forensic trail (OFC-190). The success path is
 * audited by the caller.
 */
export function requireEffectiveAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  denial?: AdminDenialAudit,
): number | null {
  const session = request.session;
  if (!session) {
    reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
    return null;
  }
  if (effectiveRole(session) !== "admin") {
    if (denial) {
      denial.audit.record(
        {
          action: denial.action,
          actorId: session.identity.profileId,
          outcome: "denied",
          trace: traceId(request),
        },
        denial.clock().toISOString(),
      );
    }
    reply.code(403).send({ error: "forbidden", message: "You may not perform this action." });
    return null;
  }
  return session.identity.profileId;
}

/** Parse and validate the `:id` route param as a positive Constitution ID. */
export function parseProfileId(request: FastifyRequest): number | null {
  const raw = (request.params as { id?: string }).id;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The next authoritative record: stored ⊕ set ⊖ remove (for the cache update). */
export function mergeProfile(
  stored: Profile,
  set: Partial<Profile>,
  remove: readonly (keyof Profile)[],
): Profile {
  const next = { ...stored, ...set } as Profile;
  for (const field of remove) {
    delete next[field];
  }
  return next;
}

/**
 * Commit a privileged **status** write (verify / deceased / de-brother): an
 * unconditional store write — these dedicated actions carry no `If-Match`, like
 * the headshot pointer (N42) — then advance the cache in lock-step onto the
 * *current* cached record (OFC-125: a concurrent PATCH may have committed during
 * the await) and return the new token plus the next record for the response.
 * Throws {@link MissingProfileError} (→ the route's 404) if the doc vanished.
 *
 * Token non-regression (OFC-136): if a concurrent write advanced the cache token
 * to a **newer** value during our await, we keep it rather than overwriting it
 * with this write's own (now older) token — Firestore `updateTime` is monotonic
 * per document, so the cache token must never go backwards, or the client's next
 * `If-Match` would carry a stale ETag and spuriously `412`.
 */
export async function commitStatusWrite(
  store: ProfileStore,
  cache: ProfileCache,
  id: number,
  stored: Profile,
  set: Partial<Profile>,
  remove: readonly (keyof Profile)[],
): Promise<{ token: string; next: Profile }> {
  const written = await store.updateUnconditional(id, { set, remove: [...remove] });
  const current = cache.getById(id) ?? stored;
  const next = mergeProfile(current, set, remove);
  const cached = cache.concurrencyToken(id);
  const token = cached !== null && !isTokenNewer(written, cached) ? cached : written;
  await cache.applyUpdate(next, token);
  return { token, next };
}

export { MissingProfileError };

/**
 * Capture a record's consent + verification state for the reversible force-off
 * (D80): the newsletter-consent flag and, when present, the verification stamp. Used
 * by mark-deceased and de-brother; each stores its own snapshot ({@link Profile}
 * has two slots) so the orthogonal actions never clobber one another.
 */
export function captureConsentSnapshot(profile: Profile): ConsentSnapshot {
  const snapshot: ConsentSnapshot = {
    allowNewsletterEmail: profile.allowNewsletterEmail,
  };
  if (profile.lastVerifiedDate !== undefined) {
    snapshot.lastVerifiedDate = profile.lastVerifiedDate;
  }
  if (profile.verifiedBy !== undefined) {
    snapshot.verifiedBy = profile.verifiedBy;
  }
  return snapshot;
}
