import type { Profile, Role } from "@pbe/shared";
import type { ImageStore, StoredImage } from "../data/images.js";

// The banner/backup in-memory doubles live beside their real stores; re-exported
// here so route tests import all their server doubles from one place.
export { InMemoryBannerStore } from "../data/banner.js";
export { InMemoryBackupSource } from "../data/backup.js";
export { InMemoryBugReportStore } from "../data/bug-reports.js";
import {
  INITIAL_CONCURRENCY_TOKEN,
  MissingProfileError,
  ProfileExistsError,
  type ProfileStore,
  type ProfileWrite,
  StaleWriteError,
} from "../data/profiles.js";
import type { AdminUserStore } from "../data/users.js";
import {
  type GhostCreateResult,
  GhostDuplicateEmailError,
  type GhostLifecycle,
  type GhostMemberDiff,
} from "../identity/ghost-lifecycle.js";
import type {
  GhostBounceEvent,
  GhostMemberRecord,
  GhostNewsletterEmail,
  GhostNewsletterEvent,
  GhostReader,
} from "../identity/ghost-reader.js";
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

  async create(id: number, _profile: Profile): Promise<string> {
    // Mirror Firestore `create()`: a second create for an id already written
    // through the store fails ALREADY_EXISTS (→ 409). A record only *loaded* into
    // the cache (never written here) is caught by the route's cache pre-check
    // instead; the real atomic guard is proven in the emulator suite.
    if (this.tokens.has(id)) {
      throw new ProfileExistsError();
    }
    this.missing.delete(id);
    const next = `token-${++this.counter}`;
    this.tokens.set(id, next);
    return next;
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
 * In-memory {@link AdminUserStore} double: models the `users` collection's stars
 * enough to drive the delete's reference scrubs and the orphan audit (D98/D99)
 * without the emulator. Seed stars, then assert against the exposed maps. (Role
 * change and the last-admin invariant left this store when `role` moved onto the
 * profile — OFC-139; the invariant is now driven through the ProfileCache in the
 * route tests.) The real store is proven in the emulator suite.
 */
export class InMemoryAdminUserStore implements AdminUserStore {
  readonly stars = new Map<number, Set<number>>();
  readonly deleted = new Set<number>();

  /**
   * Seed a `users` doc — its star list (default empty). An empty-stars entry is a
   * real doc (created at first sign-in), so it still counts for {@link listUserIds},
   * which is what the orphan-detection audit (D99) keys on.
   */
  seedStars(id: number, ids: number[] = []): void {
    this.stars.set(id, new Set(ids));
  }

  async deleteUser(id: number): Promise<void> {
    this.stars.delete(id);
    this.deleted.add(id);
  }

  async removeStarFromAll(id: number): Promise<void> {
    for (const set of this.stars.values()) {
      set.delete(id);
    }
  }

  async listUserIds(): Promise<number[]> {
    // A `users` doc now holds only stars, so its presence is a `stars` key (an
    // empty-stars doc still exists). `deleteUser` removes the key, so deleted docs
    // are already excluded — this reports live user docs for the orphan audit (D99).
    return [...this.stars.keys()];
  }
}

/**
 * A recording {@link GhostLifecycle} double: succeeds and remembers which profile
 * ids it was asked to delete/create and the update diffs it was handed, so a test
 * can assert the Ghost-first step ran (and ran before Book mutated its state).
 * `createMember` returns a deterministic synthetic id the de-brother reversal folds
 * into its write, which a test can assert on the reinstated record.
 */
export class RecordingGhostLifecycle implements GhostLifecycle {
  readonly deleted: number[] = [];
  readonly created: number[] = [];
  /** The full profile each `createMember` was handed — lets a test assert the member
   *  is created with the right newsletter consent (e.g. the RESTORED value on a
   *  deceased/de-brother reverse, not a forced-off one — OFC-232). */
  readonly createdProfiles: Profile[] = [];
  readonly updated: { id: number; ghostMemberId?: string; diff: GhostMemberDiff }[] = [];

  async deleteMember(profile: Profile): Promise<void> {
    this.deleted.push(profile.id);
  }

  async createMember(profile: Profile): Promise<GhostCreateResult> {
    this.created.push(profile.id);
    this.createdProfiles.push(profile);
    return { ghostMemberId: `recreated-${profile.id}` };
  }

  async updateMember(profile: Profile, diff: GhostMemberDiff): Promise<void> {
    this.updated.push({ id: profile.id, ghostMemberId: profile.ghostMemberId, diff });
  }
}

/**
 * A failing {@link GhostLifecycle} double: throws on the selected operation(s) to
 * prove the abort-clean contract (N41/N65) — the endpoint must return `502` with
 * Firestore, GCS, and the cache untouched.
 */
export class FailingGhostLifecycle implements GhostLifecycle {
  constructor(
    private readonly mode: "delete" | "create" | "update" | "both" | "duplicate" = "both",
  ) {}

  async deleteMember(): Promise<void> {
    if (this.mode === "delete" || this.mode === "both") {
      throw new Error("ghost delete failed");
    }
  }

  async createMember(profile: Profile): Promise<GhostCreateResult> {
    // `duplicate` models Ghost rejecting the create because the email already exists
    // (the collision path, OFC-232) — a typed error distinct from a generic outage.
    if (this.mode === "duplicate") {
      throw new GhostDuplicateEmailError(profile.email ?? "");
    }
    if (this.mode === "create" || this.mode === "both") {
      throw new Error("ghost create failed");
    }
    return { ghostMemberId: `recreated-${profile.id}` };
  }

  async updateMember(): Promise<void> {
    if (this.mode === "update" || this.mode === "both") {
      throw new Error("ghost update failed");
    }
  }
}

/**
 * An in-memory {@link GhostReader} double for the admin alignment-audit + bounce-
 * report routes (5b-2). Returns the fixtures it is constructed with; set `fail` to
 * make the three throwing reads reject (proving the route's `502 ghost_read_failed`
 * path) while `listNewsletterEmails` still resolves `[]` (it is best-effort — D120).
 */
export class InMemoryGhostReader implements GhostReader {
  constructor(
    private readonly data: {
      members?: GhostMemberRecord[];
      newsletterEvents?: GhostNewsletterEvent[];
      bounceEvents?: GhostBounceEvent[];
      newsletterEmails?: GhostNewsletterEmail[];
    } = {},
    private readonly fail = false,
  ) {}

  async listMembers(): Promise<GhostMemberRecord[]> {
    if (this.fail) {
      throw new Error("ghost members read failed");
    }
    return this.data.members ?? [];
  }

  async listNewsletterEvents(): Promise<GhostNewsletterEvent[]> {
    if (this.fail) {
      throw new Error("ghost events read failed");
    }
    return this.data.newsletterEvents ?? [];
  }

  async listBounceEvents(): Promise<GhostBounceEvent[]> {
    if (this.fail) {
      throw new Error("ghost bounce read failed");
    }
    return this.data.bounceEvents ?? [];
  }

  async listNewsletterEmails(): Promise<GhostNewsletterEmail[]> {
    return this.data.newsletterEmails ?? [];
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
