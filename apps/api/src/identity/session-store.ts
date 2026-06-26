import { randomBytes } from "node:crypto";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import type { Session } from "./types.js";

/**
 * Firestore-persisted Book sessions with a read-through in-memory cache
 * (DECISIONS D125; ENGINEERING-DESIGN §2.3).
 *
 * The session record is the **server-side** source of truth: Book's session
 * cookie carries only an opaque, high-entropy identifier, and the 4-hour cap and
 * revocation are enforced here, not trusted from a token the client holds.
 * Persisting in Firestore is load-bearing under scale-to-zero (D83): the single
 * instance shuts down whenever idle — routinely *while a brother is still
 * reading* — so an in-memory-only session table would make every cold start
 * invalidate every session and bounce the next action back through the bridge.
 * The in-memory map is a cache in front of Firestore, so only a cold-start read
 * pays a Firestore round-trip; warm requests are free.
 *
 * `expiresAt` is stored as a Firestore `Timestamp` so a native TTL policy on
 * that field reaps lapsed sessions server-side (the policy is provisioned in
 * infra). Expiry is *also* checked here on every read, so a session is never
 * honored past its cap even in the window before the TTL sweeper runs.
 */

/**
 * The session operations the server depends on. Narrowing to an interface keeps
 * the gate and auth routes testable with an in-memory fake, off the emulator.
 */
export interface SessionService {
  create(session: Session): Promise<string>;
  get(id: string, now?: number): Promise<Session | null>;
  destroy(id: string): Promise<void>;
}

/** 256 bits of entropy — an unguessable, opaque session identifier. */
const SESSION_ID_BYTES = 32;
const COLLECTION = "sessions";

interface StoredSession {
  session: Session;
  /** Mirror of `session.expiresAt` as a Firestore Timestamp — the TTL target. */
  expiresAt: Timestamp;
}

export class SessionStore implements SessionService {
  private readonly cache = new Map<string, Session>();

  constructor(private readonly db: Firestore) {}

  /**
   * Persist a new session and return its opaque id (to be set as the cookie
   * value). The id is generated server-side and never derived from the identity,
   * so it leaks nothing about the user.
   */
  async create(session: Session): Promise<string> {
    const id = randomBytes(SESSION_ID_BYTES).toString("base64url");
    const record: StoredSession = {
      session,
      expiresAt: Timestamp.fromMillis(session.expiresAt),
    };
    await this.db.collection(COLLECTION).doc(id).set(record);
    this.cache.set(id, session);
    return id;
  }

  /**
   * Resolve a session id to its live session, or null if it is unknown or has
   * lapsed. Memory first (warm path); on a miss, Firestore (the cold-start
   * path). A lapsed session is treated as absent and best-effort deleted.
   */
  async get(id: string, now: number = Date.now()): Promise<Session | null> {
    const cached = this.cache.get(id);
    if (cached) {
      if (cached.expiresAt > now) {
        return cached;
      }
      // Lapsed: drop from cache and fall through to clean up the stored record.
      this.cache.delete(id);
      await this.destroy(id);
      return null;
    }

    const snapshot = await this.db.collection(COLLECTION).doc(id).get();
    if (!snapshot.exists) {
      return null;
    }
    const stored = snapshot.data() as StoredSession;
    if (stored.session.expiresAt <= now) {
      await this.destroy(id);
      return null;
    }
    this.cache.set(id, stored.session);
    return stored.session;
  }

  /** Invalidate a session (explicit sign-out, or lazy expiry cleanup). */
  async destroy(id: string): Promise<void> {
    this.cache.delete(id);
    await this.db.collection(COLLECTION).doc(id).delete();
  }
}
