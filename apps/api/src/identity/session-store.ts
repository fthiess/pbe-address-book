import { randomBytes } from "node:crypto";
import type { Role } from "@pbe/shared";
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
  /**
   * Set or clear the session's effective ("View as") role in place, keeping the
   * same session id (DECISIONS N31). `null` clears the overlay (stop viewing-as).
   * Persisted so the impersonation survives a scale-to-zero cold start, exactly
   * like the rest of the session record. A no-op if the session is unknown.
   */
  setEffectiveRole(id: string, role: Role | null): Promise<void>;
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

  /**
   * Set or clear the effective ("View as") role on the stored session (N31).
   * Reads the live record, writes the mutated session back to Firestore, and
   * refreshes the in-memory cache so the next request (warm or cold) sees the new
   * projection. The session id is unchanged — impersonation is a state change on
   * the *same* session, not a new one — so the start/stop endpoints never reissue
   * the cookie. Unknown/lapsed session ⇒ no-op (the gate will 401 it anyway).
   *
   * The read-modify-write runs in a **transaction** (OFC-74), matching
   * {@link NonceStore.consume}. Both `POST` and `DELETE /api/me/impersonate`
   * reach this on the same session id, so a stop racing an in-flight start (or a
   * double-clicked "View as") would otherwise both read the pre-mutation document
   * and write divergent states, the second silently clobbering the first (a lost
   * update that could leave the user still impersonating). The transaction makes
   * the second writer re-read and serialize behind the first.
   */
  async setEffectiveRole(id: string, role: Role | null): Promise<void> {
    const ref = this.db.collection(COLLECTION).doc(id);
    const next = await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        return null;
      }
      const stored = snapshot.data() as StoredSession;
      // A lapsed session is treated as absent — never resurrected by a View-as write.
      if (stored.session.expiresAt <= Date.now()) {
        return null;
      }
      // Clearing must *omit* the field, not store `undefined` — the Admin SDK is
      // configured to reject undefined values, and a persisted `undefined` would
      // also defeat the `?? identity.role` fallback on read.
      const { effectiveRole: _drop, ...base } = stored.session;
      const nextSession: Session = role === null ? base : { ...base, effectiveRole: role };
      const record: StoredSession = {
        session: nextSession,
        expiresAt: Timestamp.fromMillis(nextSession.expiresAt),
      };
      tx.set(ref, record);
      return nextSession;
    });
    if (next) {
      this.cache.set(id, next);
    } else {
      // Unknown/lapsed: drop any stale cache entry so a later read falls through.
      this.cache.delete(id);
    }
  }

  /** Invalidate a session (explicit sign-out, or lazy expiry cleanup). */
  async destroy(id: string): Promise<void> {
    this.cache.delete(id);
    await this.db.collection(COLLECTION).doc(id).delete();
  }
}
