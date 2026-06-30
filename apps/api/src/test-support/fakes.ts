import type { Role } from "@pbe/shared";
import {
  INITIAL_CONCURRENCY_TOKEN,
  type ProfileStore,
  type ProfileWrite,
  StaleWriteError,
} from "../data/profiles.js";
import type { NonceService } from "../identity/nonce-store.js";
import type { SessionService } from "../identity/session-store.js";
import type { Session } from "../identity/types.js";

/**
 * In-memory `SessionService`/`NonceService`/`ProfileStore` doubles for fast unit
 * tests that need the gate, the auth routes, or the write path without standing
 * up the Firestore emulator. The Firestore-backed real stores get their own
 * emulator integration tests.
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

  async setEffectiveRole(id: string, role: Role | null): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    const { effectiveRole: _drop, ...base } = session;
    this.sessions.set(id, role === null ? base : { ...base, effectiveRole: role });
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

/**
 * In-memory `ProfileStore` double. Mirrors the Firestore store's optimistic-
 * concurrency contract — a write whose `precondition` no longer matches the
 * record's current token raises {@link StaleWriteError} (the 412 path) — without
 * the emulator, so route tests can drive the whole PATCH flow. A record never
 * written through the store is treated as carrying {@link INITIAL_CONCURRENCY_TOKEN},
 * matching what `ProfileCache.load` assigns, so the cache and store agree on a
 * freshly loaded record exactly as they do via Firestore in production. The real
 * `lastUpdateTime` precondition is proven separately in the emulator suite.
 */
export class InMemoryProfileStore implements ProfileStore {
  private readonly tokens = new Map<number, string>();
  private counter = 0;

  async update(id: number, write: ProfileWrite): Promise<string> {
    const current = this.tokens.get(id) ?? INITIAL_CONCURRENCY_TOKEN;
    if (write.precondition !== current) {
      throw new StaleWriteError();
    }
    const next = `token-${++this.counter}`;
    this.tokens.set(id, next);
    return next;
  }
}
