import { promisify } from "node:util";
import zlib from "node:zlib";
import { type Profile, type Role, normalizeEmail } from "@pbe/shared";
import type { Firestore } from "firebase-admin/firestore";
import { type ProjectedProfile, projectForRole } from "../projection/projection.js";
import { INITIAL_CONCURRENCY_TOKEN, encodeToken } from "./profiles.js";

/**
 * Outcome of resolving a normalized email against the in-memory index. The
 * `ambiguous` case carries the **claimant ids** (not a bare sentinel) so callers
 * can decide per identity — e.g. the PATCH email-uniqueness check treats an
 * address as a conflict only when a claimant *other than the editor* holds it
 * (OFC-87/OFC-88).
 */
export type EmailResolution =
  | { readonly kind: "found"; readonly profile: Profile }
  | { readonly kind: "ambiguous"; readonly claimantIds: readonly number[] }
  | { readonly kind: "none" };

const brotliCompress = promisify(zlib.brotliCompress);
const gzipCompress = promisify(zlib.gzip);

/**
 * brotli quality by audience (D84). The brother buffer is the ≈700-person hot
 * path precomputed once off the request path, so it earns maximum ratio (11);
 * the manager/admin payloads are computed fresh per request for a handful of
 * callers, so they take a moderate level that keeps request-path CPU modest.
 */
const BROTHER_BROTLI_QUALITY = 11;
const STAFF_BROTLI_QUALITY = 5;

/** A response body precompressed once, ready to serve under content negotiation. */
export interface NegotiablePayload {
  /** The uncompressed JSON text — served to a client that accepts no encoding. */
  readonly json: string;
  /** brotli-11: the maximum-ratio encoding for the slow-connection cohort (D84). */
  readonly br: Buffer;
  /** gzip: the fallback for clients that do not advertise `br`. */
  readonly gzip: Buffer;
}

/** The `GET /api/profiles` envelope (API-SPEC §3). */
interface ProfilesBody {
  profiles: ProjectedProfile[];
  /**
   * The `majors` vocabulary rides this same payload (API-SPEC §3) so the SPA can
   * resolve major codes in memory. It is empty until the `Major` type and its
   * collection land in Phase 2; the field ships now so the wire shape is stable.
   */
  majors: unknown[];
}

/**
 * Build the by-id and by-email lookup indexes from a source record set, as fresh
 * maps (a pure function — it touches no instance state). Returning new maps lets
 * {@link ProfileCache.load}/{@link ProfileCache.applyUpdate} assign every field
 * atomically after their last `await` (OFC-82).
 *
 * Primary and alternate addresses share one namespace (§5.1/D97). The email
 * index maps each normalized address to the **set of profile ids** that claim
 * it, so resolution can distinguish a single profile claiming its own address
 * via both primary+alternate (one id → `found`) from two different profiles
 * genuinely colliding (two ids → `ambiguous`), and can report *which* profiles
 * collide (OFC-87/OFC-88). Empty/whitespace-only addresses are skipped — the old
 * `email !== null` guard implicitly did this before the port to `=== undefined`,
 * and a shared `""` key must never make two records self-ambiguous (OFC-88).
 */
function buildIndexes(profiles: readonly Profile[]): {
  byId: Map<number, Profile>;
  byEmail: Map<string, Set<number>>;
} {
  const byId = new Map<number, Profile>();
  const byEmail = new Map<string, Set<number>>();
  const indexEmail = (email: string | undefined, profile: Profile): void => {
    if (email === undefined || email.trim() === "") {
      return;
    }
    const key = normalizeEmail(email);
    const claimants = byEmail.get(key);
    if (claimants) {
      claimants.add(profile.id);
    } else {
      byEmail.set(key, new Set([profile.id]));
    }
  };
  for (const profile of profiles) {
    byId.set(profile.id, profile);
    indexEmail(profile.email, profile);
    indexEmail(profile.alternateEmail, profile);
  }
  return { byId, byEmail };
}

/**
 * Fill safe defaults for the required sub-objects/flags a record's downstream
 * consumers hard-dereference (`deceased.isDeceased`, `debrothered.isDebrothered`,
 * `privacy[flag]`), returning a well-shaped record — or `null` for a doc with no
 * usable Constitution id, which the caller skips-and-logs.
 *
 * Firestore documents are hydrated with a bare `as Profile` cast (no runtime
 * shape check), so a single pre-Phase-2a or hand-edited doc missing one of these
 * sub-objects would otherwise throw inside the projection and 500 the whole bulk
 * read for the single instance — a global directory outage from one bad record
 * (OFC-91). Normalizing here makes a malformed record degrade gracefully. The
 * privacy toggles fail **closed** (all off) when absent/corrupt, so an
 * unrecoverable record hides its contact fields from peers rather than exposing
 * them. Greenfield seed-on-deploy data never needs this; it is pure defense.
 */
function normalizeHydratedProfile(raw: Profile, log: (message: string) => void): Profile | null {
  if (!Number.isInteger(raw.id) || raw.id <= 0) {
    log("ProfileCache: skipping a Firestore document with no valid Constitution id");
    return null;
  }
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const deceased = isObject(raw.deceased)
    ? { ...raw.deceased, isDeceased: raw.deceased.isDeceased === true }
    : { isDeceased: false };
  const debrothered = isObject(raw.debrothered)
    ? { ...raw.debrothered, isDebrothered: raw.debrothered.isDebrothered === true }
    : { isDebrothered: false };
  const privacy = isObject(raw.privacy)
    ? {
        shareEmail: raw.privacy.shareEmail === true,
        sharePhone: raw.privacy.sharePhone === true,
        shareAddress: raw.privacy.shareAddress === true,
        shareEmergency: raw.privacy.shareEmergency === true,
        shareSpousePartner: raw.privacy.shareSpousePartner === true,
      }
    : {
        shareEmail: false,
        sharePhone: false,
        shareAddress: false,
        shareEmergency: false,
        shareSpousePartner: false,
      };

  if (!isObject(raw.deceased) || !isObject(raw.debrothered) || !isObject(raw.privacy)) {
    log(`ProfileCache: normalized a malformed record (#${raw.id}) with default sub-objects`);
  }

  return {
    ...raw,
    deceased,
    debrothered,
    privacy,
    unlisted: raw.unlisted === true,
    hasHeadshot: raw.hasHeadshot === true,
  };
}

async function compress(json: string, brotliQuality: number): Promise<NegotiablePayload> {
  const raw = Buffer.from(json, "utf-8");
  const [br, gzip] = await Promise.all([
    brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality } }),
    gzipCompress(raw, { level: zlib.constants.Z_BEST_COMPRESSION }),
  ]);
  return { json, br, gzip };
}

/**
 * The single instance's in-memory dataset cache (ENGINEERING-DESIGN §1.5;
 * DECISIONS D83/D7). With Cloud Run capped at one instance, this cache is the
 * authoritative source for reads, so a client bulk-load incurs zero Firestore
 * reads and zero per-request compression.
 *
 * PHASE 1a SCOPE. The cache hydrates once from Firestore on cold start and
 * precomputes the **brother-role** payload (projected + brotli/gzip-compressed)
 * for `GET /api/profiles` to serve straight from memory. The write-driven
 * machinery the full design layers on top is deliberately deferred to Phase 2,
 * because there are no writers yet to drive it: the GCS snapshot object that
 * speeds cold-start hydration (D85), the debounced off-event-loop recompression
 * on each write (D84), and the Firestore snapshot-listener convergence safety
 * net (D83). Phase 2b adds the manager/admin payloads — computed fresh per
 * request (D82), not cached — via {@link payloadForRole}.
 */
export class ProfileCache {
  private payload: NegotiablePayload | null = null;
  private sourceCount = 0;
  /** Raw records by Constitution ID — backs `/api/me` and single-record reads. */
  private byId = new Map<number, Profile>();
  /**
   * Normalized-email → claimant-id-set index for sign-in resolution
   * (ENGINEERING-DESIGN §2.1). A key held by more than one *distinct* profile
   * resolves `ambiguous`, so resolution fails closed (`ambiguous_member`, D97)
   * rather than guess; a key held by one profile (even via both its primary and
   * alternate) resolves to that profile. Primary `email` and `alternateEmail`
   * share this **one namespace** (§5.1/§8, D97).
   */
  private byEmail = new Map<string, Set<number>>();
  /**
   * Per-record optimistic-concurrency token (D25): Firestore's `updateTime`,
   * surfaced to clients as the `ETag` and required back as `If-Match`. Kept in
   * the cache so a single-record read emits the token with zero Firestore reads
   * (D7/D83), and advanced by {@link applyUpdate} after each write so the read
   * model stays consistent with what was just committed (read-your-writes).
   */
  private tokenById = new Map<number, string>();
  /**
   * Per-role memoized manager/admin payloads (OFC-73). The staff projections are
   * computed fresh (D82) but were recomputed *and brotli-compressed on every*
   * `GET /api/profiles` call — unbounded CPU on the single instance (D83). They
   * are now cached here and invalidated together with the brother payload on any
   * write ({@link applyUpdate}) or reload ({@link load}). An **in-flight promise**
   * is stored (not the resolved value) so concurrent first-callers share one
   * computation rather than each starting their own; a rejected computation is
   * evicted so a later request retries.
   */
  private staffPayloads = new Map<Role, Promise<NegotiablePayload>>();

  /**
   * (Re)load the cache from an in-memory profile set, rebuilding the precomputed
   * payload. Used by tests and the seed/restore paths. Each record is assigned
   * the {@link INITIAL_CONCURRENCY_TOKEN}; the Firestore-hydrated path
   * ({@link hydrateFromFirestore}) supplies real `updateTime` tokens instead.
   *
   * Everything is built into locals first and the instance fields are assigned
   * together at the end with **no `await` in between** (OFC-82), so a concurrent
   * reader can never observe a torn state — a fresh `payload` against stale (or,
   * on first load, empty) indexes. This is latent today (loads run only at cold
   * start, before `listen()`), but becomes live the moment a hot "reload cache"
   * path calls `load()` while the server is serving traffic.
   */
  async load(profiles: readonly Profile[], tokens?: ReadonlyMap<number, string>): Promise<void> {
    const payload = await this.projectAndCompress(profiles, "brother", BROTHER_BROTLI_QUALITY);
    const { byId, byEmail } = buildIndexes(profiles);
    const tokenById = new Map(
      profiles.map((p) => [p.id, tokens?.get(p.id) ?? INITIAL_CONCURRENCY_TOKEN]),
    );
    // Atomic swap (OFC-82): all fields together, after the last await.
    this.payload = payload;
    this.sourceCount = profiles.length;
    this.byId = byId;
    this.byEmail = byEmail;
    this.tokenById = tokenById;
    this.staffPayloads.clear();
  }

  /** Project a profile set to a role and precompress the `GET /api/profiles` body. */
  private projectAndCompress(
    profiles: readonly Profile[],
    role: Role,
    brotliQuality: number,
  ): Promise<NegotiablePayload> {
    const body: ProfilesBody = { profiles: projectForRole(profiles, role), majors: [] };
    return compress(JSON.stringify(body), brotliQuality);
  }

  /**
   * Cold-start hydration: read every profile from Firestore and build the
   * payload. Records are ordered by Constitution id so the payload is
   * deterministic across cold starts.
   */
  async hydrateFromFirestore(db: Firestore): Promise<void> {
    const snapshot = await db.collection("profiles").get();
    // Normalize/skip each doc BEFORE sorting or dereferencing: the raw cast is
    // unchecked, so a malformed record must degrade gracefully — filled with
    // defaults, or dropped if it has no usable id — rather than throw and 500 the
    // whole projection (OFC-91). The concurrency token is the document's
    // server-authoritative `updateTime` (D25), captured so reads emit a correct
    // `ETag` without re-reading; it is kept only for records that survive.
    const tokens = new Map<number, string>();
    const profiles: Profile[] = [];
    for (const doc of snapshot.docs) {
      const profile = normalizeHydratedProfile(doc.data() as Profile, (message) =>
        process.stderr.write(`${message}\n`),
      );
      if (profile === null) {
        continue;
      }
      profiles.push(profile);
      if (doc.updateTime) {
        tokens.set(profile.id, encodeToken(doc.updateTime));
      }
    }
    profiles.sort((a, b) => a.id - b.id);
    await this.load(profiles, tokens);
  }

  /** The precomputed brother-role payload. Throws if the cache is not hydrated. */
  brotherPayload(): NegotiablePayload {
    if (this.payload === null) {
      throw new Error("ProfileCache.brotherPayload: the cache has not been hydrated yet.");
    }
    return this.payload;
  }

  /**
   * The `GET /api/profiles` payload for a role (D82). The brother projection is
   * the precomputed, cached buffer (the hot path); the manager and admin
   * projections are **computed fresh per request** — few callers, no caching —
   * so a brother can never receive a staff projection from a shared buffer. The
   * fresh projections see the live dataset; the brother buffer is the snapshot
   * from the last {@link load}.
   */
  async payloadForRole(role: Role): Promise<NegotiablePayload> {
    if (role === "brother") {
      return this.brotherPayload();
    }
    const cached = this.staffPayloads.get(role);
    if (cached) {
      return cached;
    }
    // Snapshot the ordered records synchronously (before the first await) so the
    // memoized payload is consistent with the dataset at call time. Store the
    // pending promise so concurrent callers coalesce onto one compression; evict
    // on failure so a later request can retry rather than cache a rejection.
    const pending = this.projectAndCompress(this.orderedProfiles(), role, STAFF_BROTLI_QUALITY);
    this.staffPayloads.set(role, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.staffPayloads.get(role) === pending) {
        this.staffPayloads.delete(role);
      }
      throw error;
    }
  }

  /** All loaded records, ordered by Constitution id for a deterministic payload. */
  private orderedProfiles(): Profile[] {
    return [...this.byId.values()].sort((a, b) => a.id - b.id);
  }

  /** The caller's own full record by Constitution ID, or null if unknown. */
  getById(id: number): Profile | null {
    return this.byId.get(id) ?? null;
  }

  /**
   * Every loaded record, ordered by Constitution id. Read by the Book/Ghost
   * alignment audit (D99), which joins the whole dataset against Ghost server-side.
   */
  allProfiles(): Profile[] {
    return this.orderedProfiles();
  }

  /** The record's current concurrency token (the `ETag`/`If-Match` value), or null. */
  concurrencyToken(id: number): string | null {
    return this.tokenById.get(id) ?? null;
  }

  /**
   * Apply a committed write to the in-memory model (read-your-writes; D83). The
   * single authoritative instance is the only writer, so after the conditional
   * Firestore write succeeds the cache is updated in lock-step: the record and
   * its new concurrency `token` are stored, the email index is rebuilt, and the
   * precomputed brother payload is recomputed so the next bulk read reflects the
   * edit.
   *
   * The brother-payload recompression runs **synchronously** here. The off-event-
   * loop debounce and the GCS snapshot regeneration (D84/D85) — the machinery
   * that keeps a burst of writes from spiking request-path CPU — are deferred to
   * Phase 7; at this phase writes are rare and the simple synchronous rebuild is
   * correct, which is what the access-control floor needs first.
   */
  async applyUpdate(updated: Profile, token: string): Promise<void> {
    const nextById = new Map(this.byId);
    nextById.set(updated.id, updated);
    await this.rebuildAndSwap(nextById, updated.id, token);
  }

  /**
   * Apply a committed **create** to the in-memory model (read-your-writes, D83;
   * OFC-201) — the insert counterpart to {@link applyUpdate}. Adds the new record
   * and its initial concurrency `token`, so a freshly added brother is visible to
   * the very next bulk read with zero Firestore reads.
   */
  async applyCreate(created: Profile, token: string): Promise<void> {
    const nextById = new Map(this.byId);
    nextById.set(created.id, created);
    await this.rebuildAndSwap(nextById, created.id, token);
  }

  /**
   * Reproject and atomically swap in a mutated record set (the shared body of
   * {@link applyUpdate} and {@link applyCreate}). Everything is built into locals
   * first and the instance fields are assigned together with **no `await` in
   * between** (OFC-82), so a concurrent reader can never observe a torn state — a
   * fresh `payload` against stale indexes. `sourceCount` is set to the new size,
   * which is a no-op for an in-place update and the count bump for an insert.
   */
  private async rebuildAndSwap(
    nextById: Map<number, Profile>,
    changedId: number,
    token: string,
  ): Promise<void> {
    const profiles = [...nextById.values()].sort((a, b) => a.id - b.id);
    const payload = await this.projectAndCompress(profiles, "brother", BROTHER_BROTLI_QUALITY);
    const { byId, byEmail } = buildIndexes(profiles);
    const tokenById = new Map(this.tokenById);
    tokenById.set(changedId, token);
    // Atomic swap, after the last await.
    this.byId = byId;
    this.byEmail = byEmail;
    this.tokenById = tokenById;
    this.payload = payload;
    this.sourceCount = profiles.length;
    // Invalidate the memoized staff payloads so the next staff read reprojects.
    this.staffPayloads.clear();
  }

  /**
   * The records that name `id` as their Big Brother — the inbound references the
   * admin delete must scrub before removing `id` (API-SPEC §4; D98). Returned as
   * live records so the route can clear each in Firestore and hand the scrubbed
   * copies (with their fresh tokens) to {@link applyDelete}.
   */
  referrersOf(id: number): Profile[] {
    return [...this.byId.values()].filter((profile) => profile.bigBrotherId === id);
  }

  /**
   * Apply a committed **delete** to the in-memory model (D83 read-your-writes),
   * the counterpart to {@link applyUpdate}. Removes `deletedId` and, in the same
   * atomic swap, replaces each reference-scrubbed referrer with the copy the route
   * already wrote through the store (its `bigBrotherId` cleared) plus that write's
   * fresh concurrency `token` — so a later PATCH to a scrubbed referrer does not
   * carry a stale token and spuriously `412`. The brother payload and indexes are
   * rebuilt once for the whole batch. Star references live in the `users`
   * collection, not the profile cache, so they are scrubbed by the route directly
   * and need no cache update here.
   */
  async applyDelete(
    deletedId: number,
    scrubbed: readonly { profile: Profile; token: string }[],
  ): Promise<void> {
    const nextById = new Map(this.byId);
    nextById.delete(deletedId);
    for (const { profile } of scrubbed) {
      nextById.set(profile.id, profile);
    }
    const profiles = [...nextById.values()].sort((a, b) => a.id - b.id);
    const payload = await this.projectAndCompress(profiles, "brother", BROTHER_BROTLI_QUALITY);
    const { byId, byEmail } = buildIndexes(profiles);
    const tokenById = new Map(this.tokenById);
    tokenById.delete(deletedId);
    for (const { profile, token } of scrubbed) {
      tokenById.set(profile.id, token);
    }
    // Atomic swap, after the last await (OFC-82).
    this.byId = byId;
    this.byEmail = byEmail;
    this.tokenById = tokenById;
    this.payload = payload;
    this.sourceCount = profiles.length;
    this.staffPayloads.clear();
  }

  /**
   * Resolve a raw email (e.g. a JWT `sub`) to a profile. The address is
   * normalized here (D97) so callers pass the value as received. Fails closed:
   * an address claimed by multiple profiles resolves to `ambiguous`, never a
   * guess (ENGINEERING-DESIGN §2.1).
   */
  resolveByEmail(email: string): EmailResolution {
    const claimants = this.byEmail.get(normalizeEmail(email));
    if (claimants === undefined || claimants.size === 0) {
      return { kind: "none" };
    }
    if (claimants.size > 1) {
      return { kind: "ambiguous", claimantIds: [...claimants] };
    }
    const [onlyId] = claimants;
    const profile = onlyId === undefined ? undefined : this.byId.get(onlyId);
    return profile ? { kind: "found", profile } : { kind: "none" };
  }

  /** Count of source profiles last loaded — for startup/diagnostic logging. */
  get size(): number {
    return this.sourceCount;
  }
}
