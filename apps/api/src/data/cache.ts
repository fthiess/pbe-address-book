import { promisify } from "node:util";
import zlib from "node:zlib";
import { type Profile, type Role, normalizeEmail } from "@pbe/shared";
import type { Firestore } from "firebase-admin/firestore";
import { type ProjectedProfile, projectForRole } from "../projection/projection.js";
import { INITIAL_CONCURRENCY_TOKEN, encodeToken } from "./profiles.js";

/** The sentinel an email index entry carries when more than one profile claims it. */
const AMBIGUOUS = Symbol("ambiguous-email");

/** Outcome of resolving a normalized email against the in-memory index. */
export type EmailResolution =
  | { readonly kind: "found"; readonly profile: Profile }
  | { readonly kind: "ambiguous" }
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
   * Normalized-email → record index for sign-in resolution (ENGINEERING-DESIGN
   * §2.1). A value of {@link AMBIGUOUS} marks an address claimed by more than one
   * profile, so resolution can fail closed (`ambiguous_member`, D97) rather than
   * guess. Primary `email` and `alternateEmail` share this **one namespace**
   * (§5.1/§8, D97) — no address appears twice anywhere in Book.
   */
  private byEmail = new Map<string, Profile | typeof AMBIGUOUS>();
  /**
   * Per-record optimistic-concurrency token (D25): Firestore's `updateTime`,
   * surfaced to clients as the `ETag` and required back as `If-Match`. Kept in
   * the cache so a single-record read emits the token with zero Firestore reads
   * (D7/D83), and advanced by {@link applyUpdate} after each write so the read
   * model stays consistent with what was just committed (read-your-writes).
   */
  private tokenById = new Map<number, string>();

  /**
   * (Re)load the cache from an in-memory profile set, rebuilding the precomputed
   * payload. Used by tests and the seed/restore paths. Each record is assigned
   * the {@link INITIAL_CONCURRENCY_TOKEN}; the Firestore-hydrated path
   * ({@link hydrateFromFirestore}) supplies real `updateTime` tokens instead.
   */
  async load(profiles: readonly Profile[], tokens?: ReadonlyMap<number, string>): Promise<void> {
    this.payload = await this.projectAndCompress(profiles, "brother", BROTHER_BROTLI_QUALITY);
    this.sourceCount = profiles.length;
    this.rebuildIndexes(profiles);
    this.tokenById = new Map(
      profiles.map((p) => [p.id, tokens?.get(p.id) ?? INITIAL_CONCURRENCY_TOKEN]),
    );
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

  /** Rebuild the by-id and by-email lookup indexes from the source records. */
  private rebuildIndexes(profiles: readonly Profile[]): void {
    this.byId = new Map();
    this.byEmail = new Map();
    for (const profile of profiles) {
      this.byId.set(profile.id, profile);
      // Primary and alternate addresses share one namespace (§5.1/D97).
      this.indexEmail(profile.email, profile);
      this.indexEmail(profile.alternateEmail, profile);
    }
  }

  /** Add one address to the email index, marking it ambiguous on a second claim. */
  private indexEmail(email: string | undefined, profile: Profile): void {
    if (email === undefined) {
      return;
    }
    const key = normalizeEmail(email);
    this.byEmail.set(key, this.byEmail.has(key) ? AMBIGUOUS : profile);
  }

  /**
   * Cold-start hydration: read every profile from Firestore and build the
   * payload. Records are ordered by Constitution id so the payload is
   * deterministic across cold starts.
   */
  async hydrateFromFirestore(db: Firestore): Promise<void> {
    const snapshot = await db.collection("profiles").get();
    const docs = [...snapshot.docs].sort(
      (a, b) => (a.data() as Profile).id - (b.data() as Profile).id,
    );
    const profiles = docs.map((doc) => doc.data() as Profile);
    // The concurrency token is the document's server-authoritative `updateTime`
    // (D25), captured here so reads can emit a correct `ETag` without re-reading.
    const tokens = new Map<number, string>();
    for (const doc of docs) {
      if (doc.updateTime) {
        tokens.set((doc.data() as Profile).id, encodeToken(doc.updateTime));
      }
    }
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
    return this.projectAndCompress(this.orderedProfiles(), role, STAFF_BROTLI_QUALITY);
  }

  /** All loaded records, ordered by Constitution id for a deterministic payload. */
  private orderedProfiles(): Profile[] {
    return [...this.byId.values()].sort((a, b) => a.id - b.id);
  }

  /** The caller's own full record by Constitution ID, or null if unknown. */
  getById(id: number): Profile | null {
    return this.byId.get(id) ?? null;
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
    this.byId.set(updated.id, updated);
    this.tokenById.set(updated.id, token);
    const profiles = this.orderedProfiles();
    this.rebuildIndexes(profiles);
    this.payload = await this.projectAndCompress(profiles, "brother", BROTHER_BROTLI_QUALITY);
  }

  /**
   * Resolve a raw email (e.g. a JWT `sub`) to a profile. The address is
   * normalized here (D97) so callers pass the value as received. Fails closed:
   * an address claimed by multiple profiles resolves to `ambiguous`, never a
   * guess (ENGINEERING-DESIGN §2.1).
   */
  resolveByEmail(email: string): EmailResolution {
    const hit = this.byEmail.get(normalizeEmail(email));
    if (hit === undefined) {
      return { kind: "none" };
    }
    if (hit === AMBIGUOUS) {
      return { kind: "ambiguous" };
    }
    return { kind: "found", profile: hit };
  }

  /** Count of source profiles last loaded — for startup/diagnostic logging. */
  get size(): number {
    return this.sourceCount;
  }
}
