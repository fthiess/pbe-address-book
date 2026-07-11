import {
  type PrivacyFlags,
  type Profile,
  type Role,
  type ValidationIssue,
  WRITE_RULE,
  canActOnProfile,
  normalizeEmail,
  normalizePhone,
  partitionWritableFields,
  validateProfile,
} from "@pbe/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { ProfileCache } from "../data/cache.js";
import { ProfileExistsError, type ProfileStore, StaleWriteError } from "../data/profiles.js";
import type { GhostCreateResult, GhostLifecycle } from "../identity/ghost-lifecycle.js";
import { effectiveRole } from "../identity/types.js";
import {
  type ProjectedProfile,
  type SelfProfile,
  hiddenFromBrothers,
  projectRecord,
  projectSelf,
} from "../projection/projection.js";
import { readRateLimit, writeRateLimit } from "../security/rate-limit.js";
import { negotiateEncoding } from "./encoding.js";
import {
  GhostStepError,
  computeGhostUpdateDiff,
  hasUsableEmail,
  pushGhostUpdate,
} from "./ghost-push.js";
import type { RecordLock } from "./record-lock.js";
import { replyWriteError, runRecordWrite } from "./record-write.js";
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
  /**
   * The Ghost member-lifecycle seam (N41/N65). PATCH uses its `updateMember` for
   * the Ghost-first-gated push of a changed pushed field; a succeed-and-log stub
   * until an Admin key is configured.
   */
  ghostLifecycle: GhostLifecycle;
  /**
   * The per-record write serializer (N65): the Ghost push and the Firestore write
   * run one-at-a-time per record so no concurrent edit commits between them.
   */
  recordLock: RecordLock;
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
  registerCreate(app, deps);
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
  app.get(
    "/api/profiles",
    { preHandler: gate, config: readRateLimit() },
    async (request, reply) => {
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
    },
  );
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
    // `no-store` on **every** branch, set before any reply — not just the success
    // path (OFC-192). This read's visibility is per-role: the *same* URL is a `404`
    // for a brother (an unlisted/de-brothered record, D124/D115) and a `200` for an
    // admin. If the `404` is cacheable, a shared cache layer (Firebase Hosting's CDN
    // fronting Cloud Run, D126) can store the brother's `404` and then replay it to
    // the admin's later request for the same id — the record "disappears" for the
    // admin and stays gone across a hard reload and a new tab (the shared-cache
    // signature). The success path was already `no-store` (D95); the error paths
    // (401/400/404) were not, so this hoists it to cover them all.
    reply.header("Cache-Control", "no-store");
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
 * `POST /api/profiles` — create a brother in one atomic write (API-SPEC §3;
 * OFC-201). The Add-Brother path, admin-only. The full guard sequence:
 *
 *  1. **Admin only** — a non-admin is `403`ed and audited before any work.
 *  2. The body must be an object carrying a valid, positive Constitution **`id`**
 *     — the caller supplies it (it is the physical signature number, never
 *     auto-assigned); an invalid or missing id is a `422` on `id`.
 *  3. **Conflict** — an id already in the dataset is `409`; the atomic Firestore
 *     `create()` is the authoritative backstop for the same race.
 *  4. The candidate record is assembled **server-side**: the admin-settable fields
 *     from the body, the server-managed housekeeping (`lastModified`,
 *     `newsletterConsentChangedAt`), the safe status defaults (`deceased`/
 *     `debrothered` off, `hasHeadshot: false`), and a **well-formed `privacy`
 *     block** — so the one un-hydrated insert path can never seed a malformed
 *     record the projection would later crash on.
 *  5. **Validation** — the shared module in create mode (`requireRequired`) plus
 *     the dataset-level structural checks (email uniqueness, big-brother existence
 *     / no cycle), `422` on failure.
 *  6. The **Ghost-first-gated** create (`createMember` mints the member and
 *     returns the fresh `ghostMemberId`, folded into the write; a failure aborts
 *     clean with `502 ghost_create_failed`, Book untouched — N65), then the atomic
 *     Firestore `create`, the cache insert (read-your-writes), and the
 *     `profile.create` audit entry (names, never values). `201` + `ETag`.
 */
function registerCreate(app: FastifyInstance, deps: ProfileRouteDeps): void {
  const { cache, gate, store, audit, clock, ghostLifecycle, recordLock } = deps;

  app.post(
    "/api/profiles",
    { preHandler: gate, config: writeRateLimit() },
    async (request, reply) => {
      const session = request.session;
      if (!session) {
        return reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
      }
      const actor = session.identity;
      const role = effectiveRole(session);
      const now = clock();
      const trace = traceId(request);

      // 1. Admin only (API-SPEC §3). Audited denial before any work.
      if (role !== "admin") {
        audit.record(
          { action: "profile.create", actorId: actor.profileId, outcome: "denied", trace },
          now.toISOString(),
        );
        return reply
          .code(403)
          .send({ error: "forbidden", message: "Only administrators may add a brother." });
      }

      // 2. Body must be an object carrying a valid Constitution id.
      const body = request.body;
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "Body must be a complete profile object." });
      }
      const rawId = (body as { id?: unknown }).id;
      if (typeof rawId !== "number" || !Number.isInteger(rawId) || rawId <= 0) {
        return reply.code(422).send({
          error: "validation_failed",
          issues: [{ field: "id", message: "A valid Constitution id is required." }],
        });
      }
      const id = rawId;

      // 3. Conflict — a fast in-memory pre-check (the atomic `store.create` below is
      //    the authoritative backstop for the create race).
      if (cache.getById(id) !== null) {
        audit.record(
          {
            action: "profile.create",
            actorId: actor.profileId,
            targetId: id,
            outcome: "denied",
            trace,
          },
          now.toISOString(),
        );
        return reply.code(409).send({
          error: "conflict",
          message: "A brother with that Constitution id already exists.",
        });
      }

      // 4. Assemble the candidate server-side (admin body ⊕ server-managed fields).
      const candidate = assembleNewProfile(body as Record<string, unknown>, id, now);
      canonicalizePhones(candidate);

      // 5. Validation — shared rules (required fields on) + dataset structural checks.
      const issues = [
        ...validateProfile(candidate, { currentYear: now.getUTCFullYear(), requireRequired: true })
          .issues,
        ...checkStructural(cache, candidate, candidate, id),
      ];
      if (issues.length > 0) {
        return reply.code(422).send({ error: "validation_failed", issues });
      }

      // 6. Ghost-first create → atomic Firestore create → cache insert → audit, under
      //    the shared per-record lock (N65) keyed by the new id. `createMember` mints
      //    the Ghost member first and its returned id is folded into the stored record;
      //    a Ghost failure aborts clean (502, nothing written). The Firestore `create`
      //    fails `409` if the id was taken between the pre-check and the write.
      interface CreatePrepared {
        created?: GhostCreateResult;
      }
      let token: string;
      let stored: Profile = candidate;
      try {
        token = await runRecordWrite<CreatePrepared, string>(recordLock, id, {
          // Re-check existence **inside the lock**, mirroring the PATCH path's in-lock
          // If-Match preflight (OFC review): the outside-the-lock conflict check can
          // pass for a second same-id create whose sibling has not yet committed, and
          // without this the doomed create would still mint a Ghost member in the
          // ghostStep below before `store.create` rejected it (a `409` that orphans a
          // real Ghost member). Aborting here — before any Ghost call — closes that.
          prepare: () => {
            if (cache.getById(id) !== null) {
              throw new ProfileExistsError();
            }
            return {};
          },
          ghostStep: async (p) => {
            // A Ghost member is email-keyed (the magic-link identity), so a new
            // brother with no usable email is created **Book-only** — no member, no
            // `ghostMemberId` — exactly as the PATCH path treats a record without one;
            // the reconciliation audit reports it as `missingGhostMember` (D99). With
            // an email, create the member first and fold its fresh id into the write.
            if (!hasUsableEmail(candidate.email)) {
              return;
            }
            try {
              p.created = await ghostLifecycle.createMember(candidate);
            } catch (cause) {
              throw new GhostStepError("ghost_create_failed", cause);
            }
          },
          commit: async (p) => {
            stored = p.created
              ? { ...candidate, ghostMemberId: p.created.ghostMemberId }
              : candidate;
            const t = await store.create(id, stored);
            await cache.applyCreate(stored, t);
            return t;
          },
        });
      } catch (error) {
        if (error instanceof ProfileExistsError) {
          return reply.code(409).send({
            error: "conflict",
            message: "A brother with that Constitution id already exists.",
          });
        }
        return replyWriteError(error, reply);
      }

      audit.record(
        { action: "profile.create", actorId: actor.profileId, targetId: id, outcome: "ok", trace },
        now.toISOString(),
      );
      return sendRecord(reply.code(201), stored, role, false, token);
    },
  );
}

/**
 * The schema privacy defaults for a new brother (DATABASE-SCHEMA §3.3, D93): the
 * reachability toggles on, the two third-party-data toggles off. Overlaid by any
 * boolean the admin actually sent, so an omitted flag never lands `undefined`.
 */
const DEFAULT_PRIVACY: PrivacyFlags = {
  shareEmail: true,
  sharePhone: true,
  shareAddress: true,
  shareEmergency: false,
  shareSpousePartner: false,
};

/**
 * Build a well-formed new `Profile` from the admin's create body (OFC-201). The
 * body's **admin-settable** fields (everything not `protected` in `WRITE_RULE`)
 * are taken as-is; the server owns the rest — the immutable `id`, the housekeeping
 * stamps, the status flags (`deceased`/`debrothered` off, `hasHeadshot: false`),
 * and a complete `privacy` block (schema defaults overlaid by the client's
 * booleans). Building the required sub-objects here — rather than trusting the
 * body — is what keeps this one un-hydrated insert from seeding a record the
 * projection later hard-dereferences into a 500 (the guarantee `normalizeHydrated
 * Profile` gives the Firestore-hydrated path).
 */
function assembleNewProfile(body: Record<string, unknown>, id: number, now: Date): Profile {
  const settable: Partial<Profile> = {};
  for (const [key, value] of Object.entries(body)) {
    const field = key as keyof Profile;
    // `Object.hasOwn`, not `WRITE_RULE[field] !== undefined` (OFC review): a body
    // key that names an `Object.prototype` member (`toString`, `hasOwnProperty`, …)
    // would resolve up the prototype chain to a function — passing a bare
    // `!== undefined`/`!== "protected"` test — and get copied in and stored as a junk
    // field (and could shadow a method on the record object). Only genuine own,
    // non-`protected` `Profile` fields are settable.
    if (key !== "id" && Object.hasOwn(WRITE_RULE, key) && WRITE_RULE[field] !== "protected") {
      (settable as Record<string, unknown>)[key] = value;
    }
  }

  const privacy: PrivacyFlags = { ...DEFAULT_PRIVACY };
  const rawPrivacy = body.privacy;
  if (rawPrivacy !== null && typeof rawPrivacy === "object" && !Array.isArray(rawPrivacy)) {
    for (const flag of Object.keys(privacy) as (keyof PrivacyFlags)[]) {
      const value = (rawPrivacy as Record<string, unknown>)[flag];
      if (typeof value === "boolean") {
        privacy[flag] = value;
      }
    }
  }

  return {
    ...settable,
    id,
    privacy,
    // The three consent booleans coerced to a real boolean (never left undefined
    // or a stray non-boolean), the status flags forced to their new-brother values,
    // and the server-managed housekeeping stamped. A new brother defaults to
    // **subscribed** to PBE News (the D45 pro-sharing/opt-out default, and what an
    // admin adding a member expects); `allowShareWithMITAA` stays opt-out (D56/D93).
    unlisted: (settable.unlisted ?? false) === true,
    allowNewsletterEmail: (settable.allowNewsletterEmail ?? true) === true,
    allowShareWithMITAA: (settable.allowShareWithMITAA ?? false) === true,
    deceased: { isDeceased: false },
    debrothered: { isDebrothered: false },
    hasHeadshot: false,
    lastModified: now.toISOString(),
    newsletterConsentChangedAt: now.toISOString(),
  } as Profile;
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
 *  7. The **Ghost-first-gated push** of any changed pushed field (`502` on a Ghost
 *     failure, Book untouched — N65), then the **conditional write** (`412` on a
 *     stale token), the cache read-your-writes update, and the **audit** entry
 *     (names, never values). Steps from the If-Match preflight through the write
 *     run under the {@link RecordLock} so no concurrent same-record edit commits
 *     between the Ghost push and the Firestore write.
 */
function registerPatch(app: FastifyInstance, deps: ProfileRouteDeps): void {
  const { cache, gate, store, audit, clock, ghostLifecycle, recordLock } = deps;

  app.patch(
    "/api/profiles/:id",
    { preHandler: gate, config: writeRateLimit() },
    async (request, reply) => {
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
        return reply
          .code(403)
          .send({ error: "forbidden", message: "You may not edit this record." });
      }

      // 2. If-Match required. Normalize the header before use: an intermediary
      //    (Firebase Hosting fronting Cloud Run, D126) or the browser may quote or
      //    weak-prefix the tag we emit, so we strip an optional `W/` and the
      //    surrounding quotes back to the raw `<sec>.<nanos>` token we compare and
      //    decode against (OFC-92). Everything downstream deals in the raw token.
      const ifMatchHeader = request.headers["if-match"];
      if (typeof ifMatchHeader !== "string" || ifMatchHeader.length === 0) {
        return reply.code(428).send({
          error: "precondition_required",
          message: "This edit requires an If-Match token.",
        });
      }
      const ifMatch = normalizeIfMatch(ifMatchHeader);

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
      // Partition against **this record's** privacy flags (N70): a toggle field the
      // owner has hidden is unwritable by a non-owner manager, who cannot see it and
      // so must not blind-overwrite it. The stored flags are authoritative here — the
      // only gated role (manager) cannot write `privacy` itself, so no in-flight
      // privacy change can widen its own powers within the same request.
      const { rejected } = partitionWritableFields(role, isOwner, patchFields, stored.privacy);
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
      // Canonicalize phone numbers to the one stored form before validation and
      // write (N35): the primary phone and each emergency contact's phone. An
      // unparseable value is left as-is so the shared validator reports it inline.
      canonicalizePhones(typedPatch);

      // Complete a well-formed `privacy` patch over the stored flags so a
      // hand-crafted partial object can never drop a switch the projection then
      // reads as undefined (OFC-111). A malformed `privacy` (non-object) is left
      // for the shared validator to reject below.
      if (
        typedPatch.privacy !== null &&
        typeof typedPatch.privacy === "object" &&
        !Array.isArray(typedPatch.privacy)
      ) {
        typedPatch.privacy = { ...stored.privacy, ...typedPatch.privacy };
      }

      // A `null` on a *clearable* field is the explicit "clear this field"
      // sentinel (OFC-107): the client cannot express a removal through JSON
      // `undefined` (JSON.stringify drops it). Split those keys out so they funnel
      // into the write path's remove set and never appear in the merged record we
      // validate, compare, or store. A `null` on a null-typed field (`classYear`,
      // `bigBrotherId`) is a genuine value, not a clear, so it stays in `merged`;
      // a `null` on a required field is neither clearable nor valid and is left in
      // `merged` for the validator to reject (preserving the OFC-89 no-500 path).
      const cleared = patchFields.filter(
        (field) => typedPatch[field] === null && CLEARABLE_ON_NULL.has(field),
      );
      const merged = { ...stored, ...typedPatch } as Profile;
      for (const field of cleared) {
        delete merged[field];
      }

      const issues = [
        ...validateProfile(merged, { currentYear: now.getUTCFullYear() }).issues,
        ...checkStructural(cache, typedPatch, merged, id),
      ].filter((issue) => surfaceIssue(issue, patchFields));
      if (issues.length > 0) {
        return reply.code(422).send({ error: "validation_failed", issues });
      }

      // Only fields whose value actually changes count as a content change (D28).
      // A clear counts only when the stored field was actually present; other
      // fields compare in canonical form so re-formatting a legacy phone — or a
      // no-op save over one — is not mistaken for an edit (OFC-112).
      const changed = patchFields.filter((field) =>
        cleared.includes(field)
          ? stored[field] !== undefined
          : !deepEqual(canonicalizeForCompare(field, stored[field]), typedPatch[field]),
      );
      if (changed.length === 0) {
        // A no-op save: nothing changed, so no write, no verification touch, no audit.
        return sendRecord(reply, stored, role, isOwner, cache.concurrencyToken(id) ?? ifMatch);
      }

      // 6. Verification side-effect (D28) + server-stamped housekeeping.
      const { set, remove } = applyServerFields(
        stored,
        typedPatch,
        changed,
        cleared,
        isOwner,
        actor.profileId,
        now,
      );
      const next = mergeNext(stored, set, remove);
      const changedSet = new Set(changed);

      // 7. Ghost-first-gated push → conditional write → cache read-your-writes →
      //    audit, all under the shared per-record lock (N65; OFC-220/226) so no
      //    concurrent token-advancing write can commit between the Ghost push and
      //    the Firestore write.
      let token: string;
      try {
        token = await runRecordWrite(recordLock, id, {
          // Preflight the If-Match INSIDE the lock: if the record already moved
          // past the caller's token, the write is doomed to 412 — abort now, before
          // an ultimately-pointless Ghost push (N65). (The conditional write below
          // is the authoritative check; this only spares a wasted Ghost call.)
          prepare: () => {
            const currentToken = cache.concurrencyToken(id);
            if (currentToken !== undefined && currentToken !== ifMatch) {
              throw new StaleWriteError();
            }
          },
          // Push any changed pushed field before committing; a clear failure throws
          // GhostStepError → 502, Book untouched.
          ghostStep: () =>
            pushGhostUpdate(ghostLifecycle, stored, computeGhostUpdateDiff(next, changedSet)).then(
              () => undefined,
            ),
          commit: async () => {
            const t = await store.update(id, { set, remove, precondition: ifMatch });
            await cache.applyUpdate(next, t);
            return t;
          },
        });
      } catch (error) {
        return replyWriteError(error, reply);
      }
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
    },
  );
}

/**
 * Reduce an `If-Match` header to the raw concurrency token: strip an optional
 * weak-validator `W/` prefix and the surrounding double quotes a spec-compliant
 * entity-tag carries. A value that is neither (e.g. the bare token our own
 * `app.inject` tests send) passes through unchanged (OFC-92).
 */
function normalizeIfMatch(value: string): string {
  let token = value.trim();
  if (token.startsWith("W/")) {
    token = token.slice(2).trim();
  }
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    token = token.slice(1, -1);
  }
  return token;
}

/** Parse and validate the `:id` route param as a positive Constitution ID. */
function parseId(request: FastifyRequest): number | null {
  const raw = (request.params as { id?: string }).id;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Rewrite a patch's phone fields to the one canonical stored form (N35): the
 * primary `phone` and each `emergencyContacts[].phone`. Applied server-side so
 * the stored representation is authoritative regardless of the client. A value
 * that `normalizePhone` can't parse is left untouched, so the shared validator
 * still reports it as the field's inline error rather than silently dropping it;
 * an empty string (a cleared field) is left alone for the same reason.
 */
function canonicalizePhones(patch: Partial<Profile>): void {
  if (typeof patch.phone === "string" && patch.phone !== "") {
    patch.phone = normalizePhone(patch.phone) ?? patch.phone;
  }
  if (Array.isArray(patch.emergencyContacts)) {
    patch.emergencyContacts = patch.emergencyContacts.map((contact) =>
      typeof contact.phone === "string" && contact.phone !== ""
        ? { ...contact, phone: normalizePhone(contact.phone) ?? contact.phone }
        : contact,
    );
  }
}

/**
 * The optional fields a client may **clear** by sending `null` (OFC-107). These
 * are exactly the fields whose type does not already include `null`: the optional
 * text fields, the address block, the two repeatable lists, and the staff note.
 * A `null` on any other field is *not* a clear — `classYear`/`bigBrotherId` accept
 * `null` as a genuine value, and a `null` on a required field falls through to the
 * validator as an invalid value.
 */
const CLEARABLE_ON_NULL: ReadonlySet<keyof Profile> = new Set<keyof Profile>([
  "middleName",
  "fullLegalName",
  "mugName",
  "email",
  "alternateEmail",
  "phone",
  "address",
  "emergencyContacts",
  "employerName",
  "jobTitle",
  "spousePartnerName",
  "majors",
  "links",
  "adminNote",
]);

/**
 * Whether a validation issue from the merged-record check should surface on this
 * PATCH. The merged record includes untouched stored fields, so a legacy
 * non-canonical stored phone — valid before the N35 narrowing, with no migration
 * behind it — would otherwise 422-block an edit to an unrelated field (OFC-110).
 * Phone validation is purely single-field, so a phone issue is reported only when
 * the patch actually writes the phone (or the emergency contacts that carry one);
 * every other issue passes through unchanged.
 */
function surfaceIssue(issue: ValidationIssue, patchFields: (keyof Profile)[]): boolean {
  if (issue.field === "phone") {
    return patchFields.includes("phone");
  }
  if (issue.field.startsWith("emergencyContacts")) {
    return patchFields.includes("emergencyContacts");
  }
  return true;
}

/**
 * Canonicalize a stored value the same way the patch was canonicalized, for the
 * no-op comparison only (OFC-112). The patch's phones were rewritten to the N35
 * form before the diff; a *stored* legacy phone must be reduced the same way, or
 * `deepEqual(legacyStored, canonicalPatch)` is always false and a save that only
 * re-formats an unchanged number spuriously writes, re-verifies, and audits.
 */
function canonicalizeForCompare(field: keyof Profile, value: unknown): unknown {
  const canon = (v: unknown): unknown =>
    typeof v === "string" && v !== "" ? (normalizePhone(v) ?? v) : v;
  if (field === "phone") {
    return canon(value);
  }
  if (field === "emergencyContacts" && Array.isArray(value)) {
    return value.map((contact) =>
      contact !== null && typeof contact === "object" && !Array.isArray(contact)
        ? {
            ...(contact as Record<string, unknown>),
            phone: canon((contact as { phone?: unknown }).phone),
          }
        : contact,
    );
  }
  return value;
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
    // A conflict is an address held by *someone other than this record*. The
    // ownership exemption must apply to the ambiguous branch too, or a brother
    // whose own address is part of an ambiguous key (e.g. re-submitting his
    // unchanged email) is locked out of editing his own record (OFC-87). With the
    // claimant-id resolver, "ambiguous" carries the ids, so we exempt self in
    // both cases.
    const resolution = cache.resolveByEmail(raw);
    const claimedByAnother =
      (resolution.kind === "found" && resolution.profile.id !== selfId) ||
      (resolution.kind === "ambiguous" && resolution.claimantIds.some((cid) => cid !== selfId));
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
  cleared: (keyof Profile)[],
  isOwner: boolean,
  actorId: number,
  now: Date,
): { set: Partial<Profile>; remove: (keyof Profile)[] } {
  const set: Partial<Profile> = { ...patch };
  const remove: (keyof Profile)[] = [];

  // A cleared field (client sent `null`) is a removal, not a stored `null`
  // (OFC-107): drop it from the write's `set` and route it to `remove`, so
  // `mergeNext` and the Firestore write delete the stored key.
  for (const field of cleared) {
    delete set[field];
    remove.push(field);
  }

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
  return (
    reply
      .header("Cache-Control", "no-store")
      // A spec-compliant quoted entity-tag (RFC 9110 §8.8.3). The raw token is
      // digits-and-a-dot, which an intermediary may quote/normalize; emitting the
      // quotes ourselves and stripping them on the way back in keeps the round-trip
      // stable (OFC-92). `normalizeIfMatch` reverses this on the next PATCH.
      .header("ETag", `"${token}"`)
      .header("Content-Type", "application/json; charset=utf-8")
      .send(body)
  );
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
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    // Ignore keys whose value is `undefined` so an absent key and a present-but-
    // `undefined` key compare equal. A sub-object (address/privacy/deceased)
    // re-sent identically but for one optional key omitted on one side is then a
    // no-op, not a spurious change that forces a write, a verification re-stamp or
    // clear, and an audit entry (OFC-94).
    const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined);
    const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    return aKeys.every((key) => deepEqual(aRecord[key], bRecord[key]));
  }
  return false;
}
