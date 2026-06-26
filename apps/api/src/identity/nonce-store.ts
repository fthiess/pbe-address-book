import { randomBytes } from "node:crypto";
import { type Firestore, Timestamp } from "firebase-admin/firestore";

/**
 * The single-use `state` nonce store backing the auth bridge's callback binding
 * (DECISIONS D104; ENGINEERING-DESIGN §2.1/§2.7).
 *
 * A nonce is minted when the SPA initiates sign-in, carried through the Ghost
 * relay, and **consumed once** at `POST /api/auth/session`. It ties the callback
 * to a Book-initiated flow (anti-forgery), composing with the fragment-carried
 * token's anti-leakage. It is persisted in Firestore — not instance memory — so
 * a scale-to-zero cold start landing between sign-in initiation and the callback
 * cannot drop it and fail an honest sign-in (D125). A short TTL (`expiresAt`,
 * reaped by a native Firestore TTL policy provisioned in infra) bounds the
 * window; consumption deletes the record so it can never be replayed.
 */

/** The nonce operations the server depends on (interface so tests can fake it). */
export interface NonceService {
  issue(now?: number): Promise<string>;
  consume(nonce: string, now?: number): Promise<boolean>;
}

const NONCE_BYTES = 32; // 256 bits
const COLLECTION = "authNonces";
const DEFAULT_TTL_MS = 10 * 60 * 1000; // ~10 minutes — a generous magic-link round-trip

interface StoredNonce {
  expiresAt: Timestamp;
}

export class NonceStore implements NonceService {
  constructor(
    private readonly db: Firestore,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  /** Mint and persist a fresh single-use nonce; returns its opaque value. */
  async issue(now: number = Date.now()): Promise<string> {
    const nonce = randomBytes(NONCE_BYTES).toString("base64url");
    const record: StoredNonce = { expiresAt: Timestamp.fromMillis(now + this.ttlMs) };
    await this.db.collection(COLLECTION).doc(nonce).set(record);
    return nonce;
  }

  /**
   * Atomically verify and consume a nonce. Returns true exactly once for a valid,
   * unexpired nonce; every subsequent call (a replay) returns false. The
   * read-delete runs in a transaction, so two concurrent consumes cannot both
   * succeed — the loser re-reads the now-deleted doc and fails closed.
   */
  async consume(nonce: string, now: number = Date.now()): Promise<boolean> {
    const ref = this.db.collection(COLLECTION).doc(nonce);
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        return false;
      }
      tx.delete(ref);
      const stored = snapshot.data() as StoredNonce;
      return stored.expiresAt.toMillis() > now;
    });
  }
}
