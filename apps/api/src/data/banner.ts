import type { Firestore } from "firebase-admin/firestore";

/**
 * The admin-set, site-wide **system banner** (D117; DATABASE-SCHEMA §6.3) — a
 * singleton document at `config/systemBanner`. Written only by an administrator
 * through the one live instance (a single authenticated write, never a bulk
 * operation — D83/D100) and read by every client on load, so the active message
 * renders across the top of every page for all roles until an admin clears it
 * (it is not per-user dismissible). Independent of Ghost's announcement bar.
 */
export interface StoredBanner {
  /** When true, the banner shows on every page; `active: false` is a cleared banner. */
  active: boolean;
  /** The banner text (plain text; trimmed; length-capped by the write route). */
  message: string;
  severity: "info" | "warning";
  /** The admin who last set it (Constitution ID). */
  updatedBy: number;
  /** ISO 8601 timestamp; server-set on each change. */
  updatedAt: string;
}

const COLLECTION = "config";
const BANNER_DOC = "systemBanner";

/**
 * The banner persistence seam. Injected (not a direct Firestore dependency) so the
 * banner routes are unit-testable against an in-memory double, mirroring
 * {@link ProfileStore}/{@link AdminUserStore}. The `config` collection can host
 * further admin-set singletons later without a schema migration (DATABASE-SCHEMA §6.3).
 */
export interface BannerStore {
  /** The current banner document, or null if none has ever been set. */
  get(): Promise<StoredBanner | null>;
  /** Replace the banner document (an admin set-or-clear). */
  set(banner: StoredBanner): Promise<void>;
}

/** The real {@link BannerStore}: the `config/systemBanner` singleton over Firestore. */
export class FirestoreBannerStore implements BannerStore {
  constructor(private readonly db: Firestore) {}

  async get(): Promise<StoredBanner | null> {
    const doc = await this.db.collection(COLLECTION).doc(BANNER_DOC).get();
    return doc.exists ? (doc.data() as StoredBanner) : null;
  }

  async set(banner: StoredBanner): Promise<void> {
    // A full `set()` (replace, not merge): a clear must overwrite the prior message
    // rather than leave it behind under `active: false`.
    await this.db.collection(COLLECTION).doc(BANNER_DOC).set(banner);
  }
}

/** An in-memory {@link BannerStore} double for tests. */
export class InMemoryBannerStore implements BannerStore {
  constructor(private banner: StoredBanner | null = null) {}

  async get(): Promise<StoredBanner | null> {
    return this.banner;
  }

  async set(banner: StoredBanner): Promise<void> {
    this.banner = banner;
  }
}
