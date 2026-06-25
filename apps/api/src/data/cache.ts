import { promisify } from "node:util";
import zlib from "node:zlib";
import type { Profile } from "@pbe/shared";
import type { Firestore } from "firebase-admin/firestore";
import { type BrotherProfile, projectForRole } from "../projection/projection.js";

const brotliCompress = promisify(zlib.brotliCompress);
const gzipCompress = promisify(zlib.gzip);

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
  profiles: BrotherProfile[];
  /**
   * The `majors` vocabulary rides this same payload (API-SPEC §3) so the SPA can
   * resolve major codes in memory. It is empty until the `Major` type and its
   * collection land in Phase 2; the field ships now so the wire shape is stable.
   */
  majors: unknown[];
}

async function compress(json: string): Promise<NegotiablePayload> {
  const raw = Buffer.from(json, "utf-8");
  const [br, gzip] = await Promise.all([
    brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }),
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
 * net (D83). Manager/admin payloads (computed fresh per request, D82) likewise
 * arrive with the roles in Phase 1b/2.
 */
export class ProfileCache {
  private payload: NegotiablePayload | null = null;
  private sourceCount = 0;

  /**
   * (Re)load the cache from an in-memory profile set, rebuilding the precomputed
   * payload. Used by tests today; the seed/restore paths reuse it in later phases.
   */
  async load(profiles: readonly Profile[]): Promise<void> {
    const body: ProfilesBody = {
      profiles: projectForRole(profiles, "brother"),
      majors: [],
    };
    this.payload = await compress(JSON.stringify(body));
    this.sourceCount = profiles.length;
  }

  /**
   * Cold-start hydration: read every profile from Firestore and build the
   * payload. Records are ordered by Constitution id so the payload is
   * deterministic across cold starts.
   */
  async hydrateFromFirestore(db: Firestore): Promise<void> {
    const snapshot = await db.collection("profiles").get();
    const profiles = snapshot.docs
      .map((doc) => doc.data() as Profile)
      .sort((a, b) => a.constitutionId - b.constitutionId);
    await this.load(profiles);
  }

  /** The precomputed brother-role payload. Throws if the cache is not hydrated. */
  brotherPayload(): NegotiablePayload {
    if (this.payload === null) {
      throw new Error("ProfileCache.brotherPayload: the cache has not been hydrated yet.");
    }
    return this.payload;
  }

  /** Count of source profiles last loaded — for startup/diagnostic logging. */
  get size(): number {
    return this.sourceCount;
  }
}
