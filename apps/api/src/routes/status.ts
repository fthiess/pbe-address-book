import { type DeceasedInfo, type Profile, type Role, validateProfile } from "@pbe/shared";
import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { ProfileCache } from "../data/cache.js";
import type { ProfileStore } from "../data/profiles.js";
import type { GhostCreateResult, GhostLifecycle } from "../identity/ghost-lifecycle.js";
import type { SessionService } from "../identity/session-store.js";
import { projectRecord } from "../projection/projection.js";
import { writeRateLimit } from "../security/rate-limit.js";
import { GhostPushError, computeConsentDiff, pushGhostUpdate } from "./ghost-push.js";
import {
  MissingProfileError,
  authorizePrivileged,
  captureConsentSnapshot,
  commitStatusWrite,
  revokeSessionsBestEffort,
} from "./privileged-support.js";
import type { Clock } from "./profiles.js";
import type { RecordLock } from "./record-lock.js";

/**
 * The profile **status** actions of 4c-2 (the privileged-action slice, DECISIONS
 * N39–N41), all dedicated audited server writes to a single record:
 *
 *  - `POST /api/profiles/{id}/verify` — stamp the record freshly verified
 *    (owner/manager/admin; server-set date + verifier; D28/D48). API-SPEC §3.
 *  - `PUT /api/profiles/{id}/deceased` — raise / edit / clear the deceased state
 *    (manager/admin), carrying the five D122 fields, with the **Book-side** D80
 *    consent force-off + snapshot/restore + `newsletterConsentChangedAt` stamp
 *    (only the Ghost *push* is Phase 5 — N40). API-SPEC §3.
 *  - `PUT /api/profiles/{id}/debrothered` — raise / reverse de-brothering
 *    (admin only), **Ghost-first** via the injected {@link GhostLifecycle} seam
 *    (N41), with the D80/D115 snapshot/restore. API-SPEC §3.
 *
 * All three write **unconditionally** (no `If-Match`, like the headshot pointer —
 * N42) and return a fresh `ETag` so the SPA container's held token does not go
 * stale, and all three route through {@link authorizePrivileged} for the shared
 * audited guard.
 */
export interface StatusRouteDeps {
  cache: ProfileCache;
  gate: preHandlerHookHandler;
  store: ProfileStore;
  /** Session revocation on de-brother raise (OFC-147). */
  sessionStore: SessionService;
  audit: AuditLog;
  clock: Clock;
  /** Ghost-first member lifecycle (N41/N65): deceased pushes the consent diff, de-brother the member. */
  ghostLifecycle: GhostLifecycle;
  /** Per-record write serializer (N65): shared with PATCH so all pushed-field writes serialize. */
  recordLock: RecordLock;
}

export function registerStatusRoutes(app: FastifyInstance, deps: StatusRouteDeps): void {
  registerVerify(app, deps);
  registerDeceased(app, deps);
  registerDebrother(app, deps);
}

/**
 * `POST /api/profiles/{id}/verify` — the explicit verify action (API-SPEC §3;
 * D28/D48). Covers the cases a PATCH's auto-verify does not: the owner confirming
 * with nothing to change, and a manager/admin re-verifying after an edit. A
 * **deceased** record is frozen (D48): verify is a no-op on it (verification is
 * neither stamped nor cleared), so a mistaken re-verify can't unfreeze it — the
 * response still carries the record's current verification and `ETag`.
 */
function registerVerify(app: FastifyInstance, deps: StatusRouteDeps): void {
  const { cache, gate, store, audit, clock } = deps;
  app.post(
    "/api/profiles/:id/verify",
    { preHandler: gate, config: writeRateLimit() },
    async (request, reply) => {
      const ctx = authorizePrivileged(
        request,
        reply,
        cache,
        audit,
        clock,
        "profile.verify",
        "owner-or-staff",
      );
      if (ctx === null) {
        return reply;
      }
      const { actorId, id, stored, trace } = ctx;

      // Deceased is frozen (D48): return the current verification unchanged, with the
      // current token so the client's held ETag stays valid — no write, no audit.
      if (stored.deceased.isDeceased) {
        return replyVerification(reply, stored, cache.concurrencyToken(id) ?? "");
      }

      const now = clock();
      const set: Partial<Profile> = {
        lastVerifiedDate: isoDate(now),
        verifiedBy: actorId,
        lastModified: now.toISOString(),
      };
      let result: { token: string; next: Profile };
      try {
        result = await commitStatusWrite(store, cache, id, stored, set, []);
      } catch (error) {
        return handleMissing(error, reply);
      }
      audit.record(
        {
          action: "profile.verify",
          actorId,
          targetId: id,
          outcome: "ok",
          fields: ["lastVerifiedDate", "verifiedBy"],
          trace,
        },
        now.toISOString(),
      );
      return replyVerification(reply, result.next, result.token);
    },
  );
}

/**
 * `PUT /api/profiles/{id}/deceased` — raise, edit, or clear the deceased state
 * (manager/admin; API-SPEC §3, N40). PUT semantics: the body's five D122 fields
 * **replace** the deceased block (an omitted field is cleared), so a re-PUT is
 * how staff correct a typo'd obituary link. Raising for the first time performs
 * the D80 Book-side coordination; a re-PUT on an already-deceased record only
 * edits the facts (no re-snapshot, no re-force). Reversing restores the snapshot.
 */
function registerDeceased(app: FastifyInstance, deps: StatusRouteDeps): void {
  const { cache, gate, store, audit, clock, ghostLifecycle, recordLock } = deps;
  app.put(
    "/api/profiles/:id/deceased",
    { preHandler: gate, config: writeRateLimit() },
    async (request, reply) => {
      const ctx = authorizePrivileged(
        request,
        reply,
        cache,
        audit,
        clock,
        "profile.deceased",
        "staff",
      );
      if (ctx === null) {
        return reply;
      }
      const { actorId, role, id, stored, trace } = ctx;

      const body = request.body;
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return reply.code(400).send({ error: "bad_request", message: "Body must be an object." });
      }
      const raising = (body as { deceased?: unknown }).deceased;
      if (typeof raising !== "boolean") {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "`deceased` must be true or false." });
      }

      const now = clock();
      let set: Partial<Profile>;
      let remove: (keyof Profile)[];
      if (raising) {
        const built = buildDeceasedRaise(body as DeceasedBody, stored, now);
        // Validate the candidate record; surface only deceased-field issues (the
        // endpoint writes nothing else, so an unrelated legacy value must not block it).
        const issues = validateProfile({ ...stored, ...built.set } as Profile, {
          currentYear: now.getUTCFullYear(),
        }).issues.filter((issue) => issue.field.startsWith("deceased"));
        if (issues.length > 0) {
          return reply.code(422).send({ error: "validation_failed", issues });
        }
        set = built.set;
        remove = built.remove;
      } else {
        const built = buildDeceasedClear(stored, now);
        set = built.set;
        remove = built.remove;
      }

      // Ghost-first-gated (N65): the forced unsubscribes on a raise — and the
      // restored subscription on a reverse — push to Ghost *before* Book commits;
      // a Ghost failure fails the action (`502`, Book untouched). A re-PUT that
      // edits only the deceased facts changes no consent flag → empty diff → no
      // Ghost call. Serialized per record so it shares PATCH's write ordering.
      const consentDiff = computeConsentDiff(stored, set);
      return recordLock.run(id, async () => {
        try {
          await pushGhostUpdate(ghostLifecycle, stored, consentDiff);
        } catch (error) {
          if (error instanceof GhostPushError) {
            return reply.code(502).send({ error: "ghost_update_failed" });
          }
          throw error;
        }

        let result: { token: string; next: Profile };
        try {
          result = await commitStatusWrite(store, cache, id, stored, set, remove);
        } catch (error) {
          return handleMissing(error, reply);
        }
        audit.record(
          {
            action: "profile.deceased",
            actorId,
            targetId: id,
            outcome: "ok",
            fields: auditFields(set, remove),
            trace,
          },
          now.toISOString(),
        );
        return replyRecord(reply, result.next, role, result.token);
      });
    },
  );
}

/**
 * `PUT /api/profiles/{id}/debrothered` — raise or reverse de-brothering (admin
 * only; API-SPEC §3; D96/D98/D115/N41). **Ghost-first**: the Ghost member is
 * deleted (raise) or re-created (reverse) *before* Book mutates anything; a Ghost
 * failure aborts cleanly with `502` and Book untouched. The Book side snapshots
 * (raise) or restores (reverse) consent/verification (D80).
 */
function registerDebrother(app: FastifyInstance, deps: StatusRouteDeps): void {
  const { cache, gate, store, sessionStore, audit, clock, ghostLifecycle, recordLock } = deps;
  app.put(
    "/api/profiles/:id/debrothered",
    { preHandler: gate, config: writeRateLimit() },
    async (request, reply) => {
      const ctx = authorizePrivileged(
        request,
        reply,
        cache,
        audit,
        clock,
        "profile.debrother",
        "admin",
      );
      if (ctx === null) {
        return reply;
      }
      const { actorId, role, id, stored, trace } = ctx;

      const body = request.body;
      const raising = (body as { debrothered?: unknown } | null)?.debrothered;
      if (typeof raising !== "boolean") {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "`debrothered` must be true or false." });
      }

      // No-op if already in the requested state: no Ghost call, no write, no audit;
      // return the current token so the client's held ETag stays valid.
      if (raising === stored.debrothered.isDebrothered) {
        return replyRecord(reply, stored, role, cache.concurrencyToken(id) ?? "");
      }

      const now = clock();

      // Serialized per record (N65) so the Ghost step and the Book write share the
      // same ordering guarantee as PATCH/deceased.
      return recordLock.run(id, async () => {
        // Ghost-first (D96/D98): the member delete/create runs before any Book
        // write. A failure aborts clean — nothing below has mutated Firestore/GCS/
        // the cache. A **reverse** re-creates the member and gets a *fresh*
        // `ghostMemberId` (N65/N67) — the stale one must not survive, so it is
        // folded into the reinstating write below.
        let createResult: GhostCreateResult | undefined;
        try {
          if (raising) {
            await ghostLifecycle.deleteMember(stored);
          } else {
            createResult = await ghostLifecycle.createMember(stored);
          }
        } catch {
          const error = raising ? "ghost_delete_failed" : "ghost_create_failed";
          return reply.code(502).send({ error });
        }

        const { set, remove } = raising
          ? buildDebrotherRaise(stored, now)
          : buildDebrotherReverse(stored, now, createResult?.ghostMemberId);
        let result: { token: string; next: Profile };
        try {
          result = await commitStatusWrite(store, cache, id, stored, set, remove);
        } catch (error) {
          return handleMissing(error, reply);
        }

        // Revoke the de-brothered member's live sessions on a raise (OFC-147): the
        // sign-in denial (D115) blocks only *new* sessions, so without this a member
        // de-brothered mid-session keeps directory access until the 4-hour cap (D22).
        // Only on raise — reinstating restores access, it does not withdraw it.
        // Best-effort (OFC-146 review): the gate's de-brothered liveness check is the
        // structural backstop here, so a transient failure degrades safely and logs.
        const sessionsRevoked = raising
          ? await revokeSessionsBestEffort(sessionStore, id, {
              action: "profile.debrother",
              actorId,
            })
          : undefined;

        audit.record(
          {
            action: "profile.debrother",
            actorId,
            targetId: id,
            outcome: "ok",
            fields: auditFields(set, remove),
            sessionsRevoked,
            trace,
          },
          now.toISOString(),
        );
        return replyRecord(reply, result.next, role, result.token);
      });
    },
  );
}

// --- Deceased state builders -------------------------------------------------

/** The mark-deceased request body: the flag plus the five D122 deceased facts. */
interface DeceasedBody {
  deceased: boolean;
  dateOfDeath?: unknown;
  deathYear?: unknown;
  birthYear?: unknown;
  obituaryUrl?: unknown;
  inMemoriamUrl?: unknown;
}

/**
 * Build the write for **raising or editing** a deceased record. The five D122
 * fields replace the deceased block (PUT semantics — an omitted field clears).
 * On the *first* raise (`stored` not yet deceased) this also performs the D80
 * coordination: capture the consent/verification snapshot, force both email
 * flags off, and stamp `newsletterConsentChangedAt` if newsletter consent
 * actually changed. Verification is **frozen**, not cleared (D48) — left as-is,
 * captured in the snapshot for a faithful restore. A re-PUT on an already-deceased
 * record edits only the facts (the snapshot and consent are untouched).
 */
function buildDeceasedRaise(
  body: DeceasedBody,
  stored: Profile,
  now: Date,
): { set: Partial<Profile>; remove: (keyof Profile)[] } {
  const deceased: DeceasedInfo = { isDeceased: true };
  assignYear(deceased, "birthYear", body.birthYear);
  assignYear(deceased, "deathYear", body.deathYear);
  assignString(deceased, "dateOfDeath", body.dateOfDeath);
  assignString(deceased, "obituaryUrl", body.obituaryUrl);
  assignString(deceased, "inMemoriamUrl", body.inMemoriamUrl);

  const set: Partial<Profile> = { deceased, lastModified: now.toISOString() };
  const remove: (keyof Profile)[] = [];

  if (!stored.deceased.isDeceased) {
    // First raise: the D80 force-off + snapshot.
    set.deceasedConsentSnapshot = captureConsentSnapshot(stored);
    set.allowNewsletterEmail = false;
    set.allowCommentReplyEmail = false;
    if (stored.allowNewsletterEmail) {
      set.newsletterConsentChangedAt = now.toISOString();
    }
  }
  return { set, remove };
}

/**
 * Build the write for **reversing** a deceased mark (D49/D80): restore the
 * snapshotted consent + verification, clear the deceased block, and drop the
 * snapshot. `newsletterConsentChangedAt` is re-stamped only if newsletter consent
 * actually changes on restore.
 */
function buildDeceasedClear(
  stored: Profile,
  now: Date,
): { set: Partial<Profile>; remove: (keyof Profile)[] } {
  const set: Partial<Profile> = {
    deceased: { isDeceased: false },
    lastModified: now.toISOString(),
  };
  const remove: (keyof Profile)[] = [];
  restoreConsentSnapshot(stored.deceasedConsentSnapshot, stored, set, remove, now);
  remove.push("deceasedConsentSnapshot");
  return { set, remove };
}

// --- De-brother state builders ----------------------------------------------

/**
 * Build the write for **raising** de-brothering: snapshot consent/verification
 * (D80) and set the flag with its timestamp. Unlike mark-deceased, the Book
 * consent flags are **not** forced off — the Ghost member deletion (already done,
 * Ghost-first) is what stops the mail, and the reconcile treats a de-brothered
 * profile as expected-to-have-no-Ghost-member (D99).
 */
function buildDebrotherRaise(
  stored: Profile,
  now: Date,
): { set: Partial<Profile>; remove: (keyof Profile)[] } {
  const set: Partial<Profile> = {
    debrothered: { isDebrothered: true, debrotheredAt: now.toISOString() },
    debrotherConsentSnapshot: captureConsentSnapshot(stored),
    lastModified: now.toISOString(),
  };
  return { set, remove: [] };
}

/**
 * Build the write for **reversing** de-brothering: restore the snapshot, clear the
 * flag, and record the **fresh `ghostMemberId`** the re-created Ghost member
 * received (N65/N67) — a re-created member gets a new id, so the stale one must not
 * survive the reversal. `ghostMemberId` is omitted only if the caller had no id to
 * fold in (e.g. a Ghost step that resolved without one), leaving the stored value.
 */
function buildDebrotherReverse(
  stored: Profile,
  now: Date,
  ghostMemberId: string | undefined,
): { set: Partial<Profile>; remove: (keyof Profile)[] } {
  const set: Partial<Profile> = {
    debrothered: { isDebrothered: false },
    lastModified: now.toISOString(),
  };
  if (ghostMemberId !== undefined) {
    set.ghostMemberId = ghostMemberId;
  }
  const remove: (keyof Profile)[] = [];
  restoreConsentSnapshot(stored.debrotherConsentSnapshot, stored, set, remove, now);
  remove.push("debrotherConsentSnapshot");
  return { set, remove };
}

/**
 * Restore a captured {@link import('@pbe/shared').ConsentSnapshot} onto the write:
 * both consent flags, and the verification stamp (set if the snapshot held one,
 * else removed). Re-stamps `newsletterConsentChangedAt` only when the newsletter
 * flag's value actually changes. A missing snapshot (a record marked before this
 * feature existed) leaves consent as-is — nothing to restore.
 */
function restoreConsentSnapshot(
  snapshot: Profile["deceasedConsentSnapshot"],
  stored: Profile,
  set: Partial<Profile>,
  remove: (keyof Profile)[],
  now: Date,
): void {
  if (!snapshot) {
    return;
  }
  set.allowNewsletterEmail = snapshot.allowNewsletterEmail;
  set.allowCommentReplyEmail = snapshot.allowCommentReplyEmail;
  if (snapshot.lastVerifiedDate !== undefined) {
    set.lastVerifiedDate = snapshot.lastVerifiedDate;
  } else {
    remove.push("lastVerifiedDate");
  }
  if (snapshot.verifiedBy !== undefined) {
    set.verifiedBy = snapshot.verifiedBy;
  } else {
    remove.push("verifiedBy");
  }
  if (stored.allowNewsletterEmail !== snapshot.allowNewsletterEmail) {
    set.newsletterConsentChangedAt = now.toISOString();
  }
}

// --- Small helpers -----------------------------------------------------------

/** Copy a numeric year field onto the deceased block only when the body carries a number. */
function assignYear(target: DeceasedInfo, key: "birthYear" | "deathYear", value: unknown): void {
  if (typeof value === "number") {
    target[key] = value;
  }
}

/** Copy a string deceased field only when the body carries a non-empty string. */
function assignString(
  target: DeceasedInfo,
  key: "dateOfDeath" | "obituaryUrl" | "inMemoriamUrl",
  value: unknown,
): void {
  if (typeof value === "string" && value !== "") {
    target[key] = value;
  }
}

/** The audit field-name list: the top-level keys the write set or removed, sans housekeeping. */
function auditFields(set: Partial<Profile>, remove: readonly (keyof Profile)[]): string[] {
  const housekeeping = new Set<string>(["lastModified", "newsletterConsentChangedAt"]);
  return [...Object.keys(set), ...remove].filter((field) => !housekeeping.has(field));
}

/** Map a store `MissingProfileError` (TOCTOU delete) to a 404; rethrow anything else. */
function handleMissing(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof MissingProfileError) {
    return reply.code(404).send({ error: "not_found", message: "No such brother." });
  }
  throw error;
}

/** The verify response: `{ lastVerifiedDate, verifiedBy }` (API-SPEC §3) + the fresh ETag. */
function replyVerification(reply: FastifyReply, profile: Profile, token: string): FastifyReply {
  return reply
    .header("Cache-Control", "no-store")
    .header("ETag", `"${token}"`)
    .send({ lastVerifiedDate: profile.lastVerifiedDate, verifiedBy: profile.verifiedBy });
}

/**
 * The deceased/de-brother response: the record projected for the (staff) caller,
 * `no-store`, with the fresh ETag — so the SPA container refreshes both its record
 * and its concurrency token. These actions are staff/admin-only, never the owner,
 * so the role projection (not `projectSelf`) is always correct.
 */
function replyRecord(
  reply: FastifyReply,
  profile: Profile,
  role: Role,
  token: string,
): FastifyReply {
  return reply
    .header("Cache-Control", "no-store")
    .header("ETag", `"${token}"`)
    .header("Content-Type", "application/json; charset=utf-8")
    .send(projectRecord(profile, role));
}

/** Today's date as `YYYY-MM-DD` (UTC) — the verification date format (D28). */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
