import {
  type DeceasedInfo,
  type Profile,
  type Role,
  shouldHaveGhostMember,
  validateProfile,
} from "@pbe/shared";
import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { ProfileCache } from "../data/cache.js";
import type { ProfileStore } from "../data/profiles.js";
import type { GhostCreateResult, GhostLifecycle } from "../identity/ghost-lifecycle.js";
import type { SessionService } from "../identity/session-store.js";
import { projectRecord } from "../projection/projection.js";
import { writeRateLimit } from "../security/rate-limit.js";
import { GhostStepError } from "./ghost-push.js";
import {
  MissingProfileError,
  authorizePrivileged,
  captureConsentSnapshot,
  commitStatusWrite,
  revokeSessionsBestEffort,
} from "./privileged-support.js";
import type { Clock } from "./profiles.js";
import type { RecordLock } from "./record-lock.js";
import { WriteValidationError, replyWriteError, runRecordWrite } from "./record-write.js";

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
  const { cache, gate, store, audit, clock, recordLock } = deps;
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
      // Under the shared per-record lock (OFC-220): verify advances the concurrency
      // token, so it must serialize with the Ghost-gated writes — otherwise it could
      // commit during a PATCH's awaited Ghost push and 412 that PATCH after Ghost was
      // mutated. No Ghost step of its own.
      let result: { token: string; next: Profile };
      try {
        result = await runRecordWrite(recordLock, id, {
          prepare: () => currentOr404(cache, id),
          commit: (current) => commitStatusWrite(store, cache, id, current, set, []),
        });
      } catch (error) {
        return replyWriteError(error, reply);
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
 * how staff correct a typo'd obituary link.
 *
 * **Ghost lifecycle (OFC-232, amends D80):** a deceased brother has **no Ghost
 * member** (the email↔Ghost invariant, D133) — the same posture as de-brothering
 * (D115). So the first raise **deletes** the Ghost member (Ghost-first) and drops
 * the `ghostMemberId`; a reverse **re-creates** it when the brother is once again
 * Ghost-eligible (living + non-de-brothered + usable email), folding in the fresh
 * id. The D80 Book-side coordination is unchanged — the first raise still snapshots
 * consent/verification and forces `allowNewsletterEmail` off, and the reverse
 * restores that snapshot — and the re-created member is created with the **restored**
 * newsletter consent so Ghost and Book agree from the first moment. A re-PUT on an
 * already-deceased record only edits the facts (no member, no re-snapshot, no
 * re-force).
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
      // `stored` from the auth ctx drives only the last-admin pre-check below; the
      // write's consent snapshot + diff are built from a FRESH in-lock read (OFC-221).
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

      // Last-admin invariant (OFC-241): marking the sole usable admin deceased makes
      // them unusable and leaves zero usable admins — an org lockout, and note this
      // route is manager-OR-admin tier, so without this a *manager* could trigger it.
      // Only on a raise (clearing deceased restores usability). Rejected before the
      // Ghost push / write so nothing is touched.
      if (raising && cache.isSoleUsableAdmin(stored)) {
        return reply.code(409).send({ error: "last_admin" });
      }

      const now = clock();
      // The whole write runs under the shared per-record lock (N65; OFC-220/221/226):
      // the consent SNAPSHOT is built inside the lock from a FRESH read
      // (`currentOr404`), so a PATCH that changed consent before this task acquired the
      // lock is reflected — otherwise a later reverse would restore a stale snapshot
      // and re-subscribe a brother who had unsubscribed (OFC-221). Ghost-first: the
      // member delete (raise) / re-create (reverse) runs before any Book write, and a
      // failure aborts clean (502, Book untouched). A raise re-creates NOTHING; a
      // reverse folds the re-created member's fresh id into the reinstating write.
      interface DeceasedPrepared {
        current: Profile;
        /** The raise write, built and validated once in `prepare` (undefined on a reverse). */
        raise?: { set: Partial<Profile>; remove: (keyof Profile)[] };
        created?: GhostCreateResult;
      }
      let outcome: {
        token: string;
        next: Profile;
        set: Partial<Profile>;
        remove: (keyof Profile)[];
      };
      try {
        outcome = await runRecordWrite<DeceasedPrepared, typeof outcome>(recordLock, id, {
          prepare: () => {
            const current = currentOr404(cache, id);
            if (!raising) {
              return { current };
            }
            // Build the raise write **once** here and validate its candidate — the same
            // built result is written in `commit`, so there is no rebuild and no chance
            // of prepare-validated diverging from commit-written. Surface only
            // deceased-field issues (the endpoint writes nothing else, so an unrelated
            // legacy value must not block it).
            const raise = buildDeceasedRaise(body as DeceasedBody, current, now);
            const issues = validateProfile({ ...current, ...raise.set } as Profile, {
              currentYear: now.getUTCFullYear(),
            }).issues.filter((issue) => issue.field.startsWith("deceased"));
            if (issues.length > 0) {
              throw new WriteValidationError(issues);
            }
            return { current, raise };
          },
          ghostStep: async (p) => {
            try {
              if (raising) {
                // First raise deletes the Ghost member — a deceased brother has none
                // (OFC-232/D133), mirroring the de-brother raise (D115). A re-PUT edit
                // of an already-deceased record, or a Book-only brother, has no member.
                if (p.current.ghostMemberId) {
                  await ghostLifecycle.deleteMember(p.current);
                }
              } else if (isGhostEligibleAfterReverse(p.current)) {
                // Reverse re-creates the member for a brother who is Ghost-eligible once
                // living again — created with the RESTORED newsletter consent (the
                // snapshot value the commit writes), so Ghost and Book agree from the
                // first moment rather than the forced-off state `p.current` still holds.
                p.created = await ghostLifecycle.createMember(profileForDeceasedReverse(p.current));
              }
            } catch (cause) {
              throw new GhostStepError(
                raising ? "ghost_delete_failed" : "ghost_create_failed",
                cause,
              );
            }
          },
          commit: async (p) => {
            // Reuse the raise built in `prepare`; a reverse builds its clear here (it
            // needs the fresh `ghostMemberId` the ghostStep just minted).
            const { set, remove } =
              p.raise ?? buildDeceasedClear(p.current, now, p.created?.ghostMemberId);
            const { token, next } = await commitStatusWrite(
              store,
              cache,
              id,
              p.current,
              set,
              remove,
            );
            return { token, next, set, remove };
          },
        });
      } catch (error) {
        return replyWriteError(error, reply);
      }
      audit.record(
        {
          action: "profile.deceased",
          actorId,
          targetId: id,
          outcome: "ok",
          fields: auditFields(outcome.set, outcome.remove),
          trace,
        },
        now.toISOString(),
      );
      return replyRecord(reply, outcome.next, role, outcome.token);
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

      // Last-admin invariant (OFC-241): de-brothering the sole usable admin makes them
      // unusable (sign-in is denied for a de-brothered member, D115) and leaves zero
      // usable admins. Only on a raise; rejected before the Ghost-first step so nothing
      // is touched.
      if (raising && cache.isSoleUsableAdmin(stored)) {
        return reply.code(409).send({ error: "last_admin" });
      }

      const now = clock();

      // Under the shared per-record lock (N65; OFC-220/221/226): Ghost-first
      // (D96/D98) — the member delete/create runs (in `ghostStep`) before any Book
      // write, and a failure aborts clean via GhostStepError → 502. A **reverse**
      // re-creates the member and gets a *fresh* `ghostMemberId` (N65/N67), folded
      // into the reinstating write; a **raise** drops the now-dangling id (OFC-222).
      // The snapshot is captured from a FRESH in-lock read (OFC-221).
      interface DebrotherPrepared {
        current: Profile;
        created?: GhostCreateResult;
      }
      let outcome: {
        token: string;
        next: Profile;
        set: Partial<Profile>;
        remove: (keyof Profile)[];
      };
      try {
        outcome = await runRecordWrite<DebrotherPrepared, typeof outcome>(recordLock, id, {
          prepare: () => ({ current: currentOr404(cache, id) }),
          ghostStep: async (p) => {
            try {
              if (raising) {
                // Only delete a member that exists (OFC-201 follow-up): a Book-only
                // brother (no email → no Ghost record, a tolerated state C15/D20/D115)
                // has nothing to delete, and the real client throws without a
                // `ghostMemberId`. De-brothering them is a Book-only operation.
                if (p.current.ghostMemberId) {
                  await ghostLifecycle.deleteMember(p.current);
                }
              } else if (
                shouldHaveGhostMember({ ...p.current, debrothered: { isDebrothered: false } })
              ) {
                // Re-create a member only for a brother who SHOULD have one once
                // reinstated (D133; OFC-232): living, with a usable email (he is being
                // un-de-brothered, so debrothered is forced false here). An email-less —
                // or also-deceased — brother is reinstated Book-only, no Ghost.
                p.created = await ghostLifecycle.createMember(p.current);
              }
            } catch (cause) {
              throw new GhostStepError(
                raising ? "ghost_delete_failed" : "ghost_create_failed",
                cause,
              );
            }
          },
          commit: async (p) => {
            const { set, remove } = raising
              ? buildDebrotherRaise(p.current, now)
              : buildDebrotherReverse(p.current, now, p.created?.ghostMemberId);
            const { token, next } = await commitStatusWrite(
              store,
              cache,
              id,
              p.current,
              set,
              remove,
            );
            return { token, next, set, remove };
          },
        });
      } catch (error) {
        return replyWriteError(error, reply);
      }
      const { set, remove } = outcome;

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
      return replyRecord(reply, outcome.next, role, outcome.token);
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
 * coordination: capture the consent/verification snapshot, force the newsletter
 * flag off, and stamp `newsletterConsentChangedAt` if newsletter consent
 * actually changed — **and drop the `ghostMemberId`** (OFC-232), since the Ghost
 * member was just deleted Ghost-first, mirroring the de-brother raise (OFC-222):
 * leaving the id would point a later pushed-field PATCH (and the reconcile) at a
 * nonexistent member. Verification is **frozen**, not cleared (D48) — left as-is,
 * captured in the snapshot for a faithful restore. A re-PUT on an already-deceased
 * record edits only the facts (the snapshot, consent, and id are untouched — there
 * is no member).
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
    if (stored.allowNewsletterEmail) {
      set.newsletterConsentChangedAt = now.toISOString();
    }
    // The Ghost member was just deleted (Ghost-first, OFC-232) — drop the now-dangling
    // id. The reverse re-mints a fresh one.
    if (stored.ghostMemberId) {
      remove.push("ghostMemberId");
    }
  }
  return { set, remove };
}

/**
 * Build the write for **reversing** a deceased mark (D49/D80): restore the
 * snapshotted consent + verification, clear the deceased block, drop the snapshot,
 * and record the **fresh `ghostMemberId`** the re-created Ghost member received
 * (OFC-232) — a re-created member gets a new id, so the stale one must not survive.
 * `ghostMemberId` is omitted (leaving the record Book-only) when the brother is
 * reinstated without an email, so no member was created. `newsletterConsentChangedAt`
 * is re-stamped only if newsletter consent actually changes on restore.
 */
function buildDeceasedClear(
  stored: Profile,
  now: Date,
  ghostMemberId: string | undefined,
): { set: Partial<Profile>; remove: (keyof Profile)[] } {
  const set: Partial<Profile> = {
    deceased: { isDeceased: false },
    lastModified: now.toISOString(),
  };
  const remove: (keyof Profile)[] = [];
  if (ghostMemberId !== undefined) {
    set.ghostMemberId = ghostMemberId;
  }
  restoreConsentSnapshot(stored.deceasedConsentSnapshot, stored, set, remove, now);
  remove.push("deceasedConsentSnapshot");
  return { set, remove };
}

/**
 * Whether a brother becomes Ghost-eligible once his deceased mark is cleared — not
 * de-brothered, with a usable email (D133; OFC-232). Evaluated against the
 * post-reverse state (deceased forced false), so the reverse re-creates a member
 * exactly when the invariant says he should have one.
 */
function isGhostEligibleAfterReverse(stored: Profile): boolean {
  return shouldHaveGhostMember({ ...stored, deceased: { isDeceased: false } });
}

/**
 * The profile view used to re-create the Ghost member on a deceased reverse: the
 * stored record with `allowNewsletterEmail` set to the value the reverse will
 * **restore** (the snapshot, or the current value if there is no snapshot), never
 * the forced-off state mark-deceased left behind. Creating the member with the
 * restored consent keeps Ghost and Book in agreement from the first moment.
 */
function profileForDeceasedReverse(stored: Profile): Profile {
  const restored =
    stored.deceasedConsentSnapshot?.allowNewsletterEmail ?? stored.allowNewsletterEmail;
  return { ...stored, allowNewsletterEmail: restored };
}

// --- De-brother state builders ----------------------------------------------

/**
 * Build the write for **raising** de-brothering: snapshot consent/verification
 * (D80) and set the flag with its timestamp. Unlike mark-deceased, the Book
 * consent flags are **not** forced off — the Ghost member deletion (already done,
 * Ghost-first) is what stops the mail, and the reconcile treats a de-brothered
 * profile as expected-to-have-no-Ghost-member (D99).
 *
 * **`ghostMemberId` is removed** (OFC-222): the Ghost member was just deleted, so
 * the stored id now dangles. Leaving it would make any later pushed-field PATCH on
 * the de-brothered record push to a deleted member → a hard `502`, rendering the
 * record un-editable; and the D99 reconcile would see an id pointing at nothing.
 * The reverse path re-mints a fresh id via `createMember`.
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
  return { set, remove: ["ghostMemberId"] };
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

/**
 * Read the record's **current** cached state, inside the lock, or throw
 * `MissingProfileError` (→ 404) if it vanished. The fresh read is what makes the
 * consent snapshot and the pushed diff reflect a concurrent write that committed
 * before this task acquired the lock (OFC-221).
 */
function currentOr404(cache: ProfileCache, id: number): Profile {
  const current = cache.getById(id);
  if (!current) {
    throw new MissingProfileError();
  }
  return current;
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
