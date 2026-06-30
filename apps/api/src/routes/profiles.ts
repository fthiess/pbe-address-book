import {
  type Profile,
  type Role,
  type ValidationIssue,
  canActOnProfile,
  normalizeEmail,
  partitionWritableFields,
  validateProfile,
} from "@pbe/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { ProfileCache } from "../data/cache.js";
import { MissingProfileError, type ProfileStore, StaleWriteError } from "../data/profiles.js";
import { effectiveRole } from "../identity/types.js";
import {
  type ProjectedProfile,
  type SelfProfile,
  projectRecord,
  projectSelf,
} from "../projection/projection.js";
import { negotiateEncoding } from "./encoding.js";
import { traceId } from "./trace.js";

/** A clock seam so the write path's timestamps stay deterministic under test. */
export type Clock = () => Date;

/** The collaborators the profile routes need (read cache + write path + audit). */
export interface ProfileRouteDeps {
  cache: ProfileCache;
  gate: preHandlerHookHandler;
  /** The conditional Firestore write path (D25); a fake double in unit tests. */
  store: ProfileStore;
  /** The audit stream (D61); the names-not-values record of every mutation. */
  audit: AuditLog;
  /** Supplies "now" for `lastModified`, the verification date, and audit stamps. */
  clock: Clock;
}

/**
 * The `/api/profiles` surface: the bulk read (Phase 2b) plus the single-record
 * read and the PATCH write path (Phase 2c).
 *
 * PHASE 2c adds Book's **first write path** — the security-critical floor every
 * later feature stands on:
 *
 *  - `PATCH /api/profiles/{id}` — the general edit path, gated on **two
 *    orthogonal axes** (the object-level predicate and the per-field writable
 *    allowlist, D106), guarded by **optimistic concurrency** (`If-Match` →
 *    `412` on a stale write, D25), validated through the **shared** validation
 *    module plus the dataset-level structural checks (D50/D97), carrying the
 *    **verification side-effect** (D28), and writing an **audit** entry of the
 *    changed field *names* — never values (D61).
 *  - `GET /api/profiles/{id}` — the single-record read with an `ETag`, the
 *    **reconcile/repull seam** a `412` sends the client back to.
 */
export function registerProfileRoutes(app: FastifyInstance, deps: ProfileRouteDeps): void {
  registerBulkRead(app, deps);
  registerRecordRead(app, deps);
  registerPatch(app, deps);
}

/**
 * `GET /api/profiles` — the bulk read, the cornerstone of the app (API-SPEC §3).
 *
 * Serves the precomputed brother-role projection straight from the in-memory
 * cache (D7/D83), content-encoding-negotiated (brotli/gzip/identity) and
 * `no-store`: the payload is real PII that must never persist to a shared
 * machine's disk (D95). The bytes are precompressed off the request path (D84).
 * The read is session-gated and **per-role** (D82): the caller's role selects
 * the projection — the precomputed brother buffer for brothers, a freshly
 * computed manager/admin projection otherwise.
 */
function registerBulkRead(app: FastifyInstance, { cache, gate }: ProfileRouteDeps): void {
  app.get("/api/profiles", { preHandler: gate }, async (request, reply) => {
    // The **effective** role selects the projection, so a "View as" admin actually
    // downloads the lower role's smaller payload — not the full set behind a flag (N31).
    const session = request.session;
    const role = session ? effectiveRole(session) : "brother";
    const payload = await cache.payloadForRole(role);
    const encoding = negotiateEncoding(request.headers["accept-encoding"]);

    reply
      .header("Cache-Control", "no-store")
      .header("Vary", "Accept-Encoding")
      .header("Content-Type", "application/json; charset=utf-8");

    if (encoding === "br") {
      return reply.header("Content-Encoding", "br").send(payload.br);
    }
    if (encoding === "gzip") {
      return reply.header("Content-Encoding", "gzip").send(payload.gzip);
    }
    return reply.send(payload.json);
  });
}

/**
 * `GET /api/profiles/{id}` — a single projected record with an `ETag` (API-SPEC
 * §3). Used for deep-link refresh and as the **repull after a 412** (§1.4): the
 * client re-reads the current record (and its fresh token) to reconcile a
 * conflict by hand. Served `no-store` — it carries the same PII as the bulk read.
 *
 * The owner sees their own record in full ({@link projectSelf}); everyone else
 * sees the role projection. A **brother** asking for a whole-record-hidden record
 * (`unlisted`/`debrothered`, D124/D115) gets `404` — the single-record
 * consequence of the directory hide; managers/admins project it normally.
 */
function registerRecordRead(app: FastifyInstance, { cache, gate }: ProfileRouteDeps): void {
  app.get("/api/profiles/:id", { preHandler: gate }, async (request, reply) => {
    const session = request.session;
    if (!session) {
      return reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
    }
    // Identity (who/own-row) stays real; the **effective** role drives the
    // projection and the brother-hidden 404 — a "View as brother" admin sees the
    // brother projection and 404s on hidden records, exactly as a brother would (N31).
    const actor = session.identity;
    const role = effectiveRole(session);
    const id = parseId(request);
    if (id === null) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid profile id." });
    }

    const stored = cache.getById(id);
    if (!stored) {
      return reply.code(404).send({ error: "not_found", message: "No such brother." });
    }

    const isOwner = actor.profileId === id;
    if (!isOwner && role === "brother" && hiddenFromBrothers(stored)) {
      return reply.code(404).send({ error: "not_found", message: "No such brother." });
    }

    return sendRecord(reply, stored, role, isOwner, cache.concurrencyToken(id) ?? "");
  });
}

/**
 * `PATCH /api/profiles/{id}` — the normal save path (API-SPEC §3; D25/D28/D106).
 * The full guard sequence, in order:
 *
 *  1. **Object-level** predicate (D106): a brother may write only his own
 *     record; managers/admins any. Blocks the IDOR on guessable Constitution IDs.
 *  2. **`If-Match` required** (`428`) — the concurrency token (§1.4).
 *  3. Record **exists** (`404`).
 *  4. **Field-level** allowlist (D106): a field outside the caller's powers is
 *     **rejected** (`403`), never silently dropped.
 *  5. **Validation** (`422`): the shared module over the merged record, plus the
 *     dataset-level structural checks (email uniqueness, big-brother existence /
 *     no cycle) the shared module defers to the write path (D50/D97).
 *  6. The **D28 verification side-effect** and the server-stamped housekeeping.
 *  7. The **conditional write** (`412` on a stale token), then the cache
 *     read-your-writes update and the **audit** entry (names, never values).
 */
function registerPatch(app: FastifyInstance, deps: ProfileRouteDeps): void {
  const { cache, gate, store, audit, clock } = deps;

  app.patch("/api/profiles/:id", { preHandler: gate }, async (request, reply) => {
    const session = request.session;
    if (!session) {
      return reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
    }
    // Identity (the actor's own id, ownership, the verification stamp) stays real;
    // the **effective** role drives the two write gates and the response projection,
    // so a "View as" admin genuinely holds the lower role's powers (N31).
    const actor = session.identity;
    const role = effectiveRole(session);
    const id = parseId(request);
    if (id === null) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid profile id." });
    }
    const now = clock();
    const trace = traceId(request);

    // 1. Object-level predicate — before touching the record (the IDOR guard).
    if (!canActOnProfile(role, actor.profileId, id)) {
      audit.record(
        {
          action: "profile.update",
          actorId: actor.profileId,
          targetId: id,
          outcome: "denied",
          trace,
        },
        now.toISOString(),
      );
      return reply.code(403).send({ error: "forbidden", message: "You may not edit this record." });
    }

    // 2. If-Match required.
    const ifMatch = request.headers["if-match"];
    if (typeof ifMatch !== "string" || ifMatch.length === 0) {
      return reply
        .code(428)
        .send({ error: "precondition_required", message: "This edit requires an If-Match token." });
    }

    // 3. Record must exist.
    const stored = cache.getById(id);
    if (!stored) {
      return reply.code(404).send({ error: "not_found", message: "No such brother." });
    }

    // 4. Body must be a patch object; field-level allowlist rejects out-of-powers fields.
    const patch = request.body;
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "Body must be a profile patch object." });
    }
    const isOwner = actor.profileId === id;
    const patchFields = Object.keys(patch) as (keyof Profile)[];
    const { rejected } = partitionWritableFields(role, isOwner, patchFields);
    if (rejected.length > 0) {
      audit.record(
        {
          action: "profile.update",
          actorId: actor.profileId,
          targetId: id,
          outcome: "denied",
          fields: rejected,
          trace,
        },
        now.toISOString(),
      );
      return reply.code(403).send({
        error: "forbidden",
        message: "Your role may not write one or more of these fields.",
        fields: rejected,
      });
    }

    // 5. Validation — shared rules over the merged record, plus structural checks.
    const typedPatch = patch as Partial<Profile>;
    const merged = { ...stored, ...typedPatch } as Profile;
    const issues = [
      ...validateProfile(merged, { currentYear: now.getUTCFullYear() }).issues,
      ...checkStructural(cache, typedPatch, merged, id),
    ];
    if (issues.length > 0) {
      return reply.code(422).send({ error: "validation_failed", issues });
    }

    // Only fields whose value actually changes count as a content change (D28).
    const changed = patchFields.filter((field) => !deepEqual(stored[field], typedPatch[field]));
    if (changed.length === 0) {
      // A no-op save: nothing changed, so no write, no verification touch, no audit.
      return sendRecord(reply, stored, role, isOwner, cache.concurrencyToken(id) ?? ifMatch);
    }

    // 6. Verification side-effect (D28) + server-stamped housekeeping.
    const { set, remove } = applyServerFields(
      stored,
      typedPatch,
      changed,
      isOwner,
      actor.profileId,
      now,
    );
    const next = mergeNext(stored, set, remove);

    // 7. Conditional write → cache read-your-writes → audit.
    let token: string;
    try {
      token = await store.update(id, { set, remove, precondition: ifMatch });
    } catch (error) {
      if (error instanceof StaleWriteError) {
        return reply
          .code(412)
          .send({ error: "stale_write", message: "This record changed since you loaded it." });
      }
      if (error instanceof MissingProfileError) {
        return reply.code(404).send({ error: "not_found", message: "No such brother." });
      }
      throw error;
    }
    await cache.applyUpdate(next, token);
    audit.record(
      {
        action: "profile.update",
        actorId: actor.profileId,
        targetId: id,
        outcome: "ok",
        fields: changed,
        trace,
      },
      now.toISOString(),
    );

    return sendRecord(reply, next, role, isOwner, token);
  });
}

/** Whether a record is hidden from brothers as a whole (D124 unlisted / D115 de-brothered). */
function hiddenFromBrothers(profile: Profile): boolean {
  return profile.unlisted || profile.debrothered.isDebrothered;
}

/** Parse and validate the `:id` route param as a positive Constitution ID. */
function parseId(request: FastifyRequest): number | null {
  const raw = (request.params as { id?: string }).id;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The dataset-level structural rules the shared validator defers to the write
 * path because they need the whole in-memory dataset (validation.ts header;
 * DATABASE-SCHEMA §8): **email uniqueness** across the one primary+alternate
 * namespace (D97), and **big-brother existence with no cycle**.
 */
function checkStructural(
  cache: ProfileCache,
  patch: Partial<Profile>,
  merged: Profile,
  selfId: number,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Email uniqueness — only the addresses this patch introduces are checked, and
  // an address the record already owns is not a conflict with itself.
  for (const field of ["email", "alternateEmail"] as const) {
    const raw = patch[field];
    if (typeof raw !== "string" || raw === "") {
      continue;
    }
    const resolution = cache.resolveByEmail(raw);
    const claimedByAnother =
      resolution.kind === "ambiguous" ||
      (resolution.kind === "found" && resolution.profile.id !== selfId);
    if (claimedByAnother) {
      issues.push({ field, message: "This email address is already in use." });
    }
  }
  // Primary and alternate must not be the same address (one namespace, D97).
  if (
    typeof merged.email === "string" &&
    merged.email !== "" &&
    typeof merged.alternateEmail === "string" &&
    merged.alternateEmail !== "" &&
    normalizeEmail(merged.email) === normalizeEmail(merged.alternateEmail)
  ) {
    issues.push({
      field: "alternateEmail",
      message: "Alternate email must differ from the primary.",
    });
  }

  // Big-brother existence and cycle freedom (only when the pointer is being set).
  if ("bigBrotherId" in patch && patch.bigBrotherId != null) {
    const bigBrotherId = patch.bigBrotherId;
    if (!cache.getById(bigBrotherId)) {
      issues.push({ field: "bigBrotherId", message: "Big Brother must be an existing brother." });
    } else if (formsCycle(cache, selfId, bigBrotherId)) {
      issues.push({
        field: "bigBrotherId",
        message: "Big Brother relationship would form a cycle.",
      });
    }
  }

  return issues;
}

/** Walk the big-brother chain up from `bigBrotherId`; true if it loops back to `selfId`. */
function formsCycle(cache: ProfileCache, selfId: number, bigBrotherId: number): boolean {
  const seen = new Set<number>();
  let cursor: number | null | undefined = bigBrotherId;
  while (cursor != null) {
    if (cursor === selfId) {
      return true;
    }
    if (seen.has(cursor)) {
      return false; // a pre-existing cycle elsewhere, not involving this record
    }
    seen.add(cursor);
    cursor = cache.getById(cursor)?.bigBrotherId ?? null;
  }
  return false;
}

/**
 * Compute the server-managed fields layered on top of the client patch (D28):
 * the `lastModified` stamp, the `newsletterConsentChangedAt` stamp when newsletter
 * consent changed (D103), and the verification adjustment — the **owner**'s edit
 * auto-(re)verifies; a **manager/admin** edit on another brother clears an
 * existing verification. Deceased records are exempt (verification untouched).
 */
function applyServerFields(
  stored: Profile,
  patch: Partial<Profile>,
  changed: (keyof Profile)[],
  isOwner: boolean,
  actorId: number,
  now: Date,
): { set: Partial<Profile>; remove: (keyof Profile)[] } {
  const set: Partial<Profile> = { ...patch };
  const remove: (keyof Profile)[] = [];

  set.lastModified = now.toISOString();
  if (changed.includes("allowNewsletterEmail")) {
    set.newsletterConsentChangedAt = now.toISOString();
  }

  if (!stored.deceased.isDeceased) {
    if (isOwner) {
      set.lastVerifiedDate = isoDate(now);
      set.verifiedBy = actorId;
    } else if (stored.lastVerifiedDate !== undefined) {
      remove.push("lastVerifiedDate", "verifiedBy");
    }
  }

  return { set, remove };
}

/** The next authoritative record: stored ⊕ set ⊖ remove, for the cache update. */
function mergeNext(stored: Profile, set: Partial<Profile>, remove: (keyof Profile)[]): Profile {
  const next = { ...stored, ...set } as Profile;
  for (const field of remove) {
    delete next[field];
  }
  return next;
}

/** Send a single record at the caller's projection, `no-store`, with its `ETag`. */
function sendRecord(
  reply: FastifyReply,
  profile: Profile,
  role: Role,
  isOwner: boolean,
  token: string,
): FastifyReply {
  const body: ProjectedProfile | SelfProfile = isOwner
    ? projectSelf(profile)
    : projectRecord(profile, role);
  return reply
    .header("Cache-Control", "no-store")
    .header("ETag", token)
    .header("Content-Type", "application/json; charset=utf-8")
    .send(body);
}

/** Today's date as `YYYY-MM-DD` (UTC) — the verification date format (D28). */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Structural deep equality over the JSON-shaped `Profile` values (no-op detection). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    return aKeys.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}
