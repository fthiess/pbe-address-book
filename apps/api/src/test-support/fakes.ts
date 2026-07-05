import type { Profile, Role } from "@pbe/shared";
import type { ImageStore, StoredImage } from "../data/images.js";

// The banner/backup in-memory doubles live beside their real stores; re-exported
// here so route tests import all their server doubles from one place.
export { InMemoryBannerStore } from "../data/banner.js";
export { InMemoryBackupSource } from "../data/backup.js";
import {
  INITIAL_CONCURRENCY_TOKEN,
  MissingProfileError,
  type ProfileStore,
  type ProfileWrite,
  StaleWriteError,
} from "../data/profiles.js";
import { type AdminUserStore, LastAdminError, type RoleChangeResult } from "../data/users.js";
import type { GhostLifecycle } from "../identity/ghost-lifecycle.js";
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

  async destroyAllForProfile(profileId: number): Promise<number> {
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.identity.profileId === profileId) {
        this.sessions.delete(id);
        removed++;
      }
    }
    return removed;
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
  private readonly missing = new Set<number>();
  private counter = 0;

  /**
   * Test helper: make `id` behave as a deleted document, so a write to it throws
   * {@link MissingProfileError} — the real `FirestoreProfileStore` maps a Firestore
   * NOT_FOUND to that, and the headshot route's undo-purge + 404 branch depends on
   * it (OFC-129).
   */
  markMissing(id: number): void {
    this.missing.add(id);
  }

  async update(id: number, write: ProfileWrite): Promise<string> {
    if (this.missing.has(id)) {
      throw new MissingProfileError();
    }
    const current = this.tokens.get(id) ?? INITIAL_CONCURRENCY_TOKEN;
    if (write.precondition !== current) {
      throw new StaleWriteError();
    }
    const next = `token-${++this.counter}`;
    this.tokens.set(id, next);
    return next;
  }

  async updateUnconditional(id: number): Promise<string> {
    // No precondition (the headshot pointer, N42): advance and return the new token
    // so the route's `cache.applyUpdate` gets a fresh ETag exactly as it would from
    // Firestore — unless the id was marked missing, mirroring a NOT_FOUND.
    if (this.missing.has(id)) {
      throw new MissingProfileError();
    }
    const next = `token-${++this.counter}`;
    this.tokens.set(id, next);
    return next;
  }

  async delete(id: number): Promise<void> {
    // Idempotent, like Firestore's delete(): drop the token and mark the id gone so
    // a subsequent write to it throws MissingProfileError, mirroring NOT_FOUND.
    this.tokens.delete(id);
    this.missing.add(id);
  }
}

/**
 * In-memory {@link AdminUserStore} double: models the `users` collection's roles
 * and stars enough to drive the Change-role invariant and the delete's reference
 * scrubs (N44/D98) without the emulator. Seed roles/stars, then assert against the
 * exposed maps. The real transactional store is proven in the emulator suite.
 */
export class InMemoryAdminUserStore implements AdminUserStore {
  readonly roles = new Map<number, Role>();
  readonly stars = new Map<number, Set<number>>();
  readonly deleted = new Set<number>();

  /** Seed an existing `users` doc's role (absent → treated as `brother`, N44). */
  seedRole(id: number, role: Role): void {
    this.roles.set(id, role);
  }

  /** Seed a user's star list so a delete's `removeStarFromAll` scrub can be asserted. */
  seedStars(id: number, ids: number[]): void {
    this.stars.set(id, new Set(ids));
  }

  async setRole(id: number, role: Role): Promise<RoleChangeResult> {
    const before: Role = this.roles.get(id) ?? "brother";
    if (before === "admin" && role !== "admin") {
      const admins = [...this.roles.values()].filter((r) => r === "admin").length;
      if (admins <= 1) {
        throw new LastAdminError();
      }
    }
    this.roles.set(id, role);
    return { before };
  }

  async getRole(id: number): Promise<Role> {
    return this.roles.get(id) ?? "brother";
  }

  async isLastAdmin(id: number): Promise<boolean> {
    if (this.roles.get(id) !== "admin") {
      return false;
    }
    const admins = [...this.roles.values()].filter((role) => role === "admin").length;
    return admins <= 1;
  }

  async deleteUser(id: number): Promise<void> {
    this.roles.delete(id);
    this.stars.delete(id);
    this.deleted.add(id);
  }

  async removeStarFromAll(id: number): Promise<void> {
    for (const set of this.stars.values()) {
      set.delete(id);
    }
  }
}

/**
 * A recording {@link GhostLifecycle} double: succeeds and remembers which profile
 * ids it was asked to delete/create, so a test can assert the Ghost-first step
 * ran (and ran before Book mutated its state).
 */
export class RecordingGhostLifecycle implements GhostLifecycle {
  readonly deleted: number[] = [];
  readonly created: number[] = [];

  async deleteMember(profile: Profile): Promise<void> {
    this.deleted.push(profile.id);
  }

  async createMember(profile: Profile): Promise<void> {
    this.created.push(profile.id);
  }
}

/**
 * A failing {@link GhostLifecycle} double: throws on the selected operation(s) to
 * prove the abort-clean contract (N41) — the endpoint must return `502` with
 * Firestore, GCS, and the cache untouched.
 */
export class FailingGhostLifecycle implements GhostLifecycle {
  constructor(private readonly mode: "delete" | "create" | "both" = "both") {}

  async deleteMember(): Promise<void> {
    if (this.mode !== "create") {
      throw new Error("ghost delete failed");
    }
  }

  async createMember(): Promise<void> {
    if (this.mode !== "delete") {
      throw new Error("ghost create failed");
    }
  }
}

/**
 * In-memory {@link ImageStore} double: a `Map` of object key → bytes+contentType.
 * Lets the headshot route and the `/img/*` route be driven end-to-end without a
 * GCS emulator (there is no local GCS in the test rig). Exposes `has`/`keys` so a
 * test can assert the D94 purge deleted the superseded objects and the D98
 * objects-first ordering wrote the new ones.
 */
export class InMemoryImageStore implements ImageStore {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async read(key: string): Promise<StoredImage | null> {
    const object = this.objects.get(key);
    return object ? { contentType: object.contentType, body: object.body } : null;
  }

  /** Test helper: whether an object key currently exists in the store. */
  has(key: string): boolean {
    return this.objects.has(key);
  }

  /** Test helper: all currently-stored object keys. */
  keys(): string[] {
    return [...this.objects.keys()];
  }

  /** Test helper: seed an object directly (e.g. to stand in for a prior version). */
  seed(key: string, body: Buffer, contentType = "image/webp"): void {
    this.objects.set(key, { body, contentType });
  }
}
