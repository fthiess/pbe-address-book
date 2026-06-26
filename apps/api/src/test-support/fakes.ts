import type { NonceService } from "../identity/nonce-store.js";
import type { SessionService } from "../identity/session-store.js";
import type { Session } from "../identity/types.js";

/**
 * In-memory `SessionService`/`NonceService` doubles for fast unit tests that
 * need the gate or the auth routes without standing up the Firestore emulator.
 * The Firestore-backed real stores get their own emulator integration tests.
 */

export class InMemorySessionStore implements SessionService {
  private readonly sessions = new Map<string, Session>();
  private counter = 0;

  async create(session: Session): Promise<string> {
    const id = `test-session-${++this.counter}`;
    this.sessions.set(id, session);
    return id;
  }

  async get(id: string, now: number = Date.now()): Promise<Session | null> {
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }
    if (session.expiresAt <= now) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  async destroy(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}

export class InMemoryNonceStore implements NonceService {
  private readonly nonces = new Map<string, number>();
  private counter = 0;

  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  async issue(now: number = Date.now()): Promise<string> {
    const nonce = `test-nonce-${++this.counter}`;
    this.nonces.set(nonce, now + this.ttlMs);
    return nonce;
  }

  async consume(nonce: string, now: number = Date.now()): Promise<boolean> {
    const expiresAt = this.nonces.get(nonce);
    if (expiresAt === undefined) {
      return false;
    }
    this.nonces.delete(nonce);
    return expiresAt > now;
  }

  /** Test helper: directly seed a nonce so a test can drive `consume`. */
  seed(nonce: string, expiresAt: number): void {
    this.nonces.set(nonce, expiresAt);
  }
}
