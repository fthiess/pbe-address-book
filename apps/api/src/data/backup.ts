import type { Firestore } from "firebase-admin/firestore";

/**
 * One document in a backup snapshot: its Firestore document id plus its data. The
 * id is captured explicitly because a `config` singleton's id ("systemBanner")
 * is not a data field, and even for `profiles`/`users` — whose numeric `id` field
 * equals the doc key — keeping the string doc id makes a restore a faithful,
 * key-preserving replay rather than a re-derivation.
 */
export interface CollectionSnapshot {
  id: string;
  data: Record<string, unknown>;
}

/**
 * A complete snapshot of Book's live Firestore collections (D63). The MVP export
 * (Phase 5a-1) is JSON-only; the image-object bundle and the nightly automated job
 * are Phase 7 (ENGINEERING-DESIGN §6.3). `bugReports` (D121) is included as of
 * 5a-2 so an unexpected data-loss window before an admin has transferred pending
 * reports out is covered. `majors` is a bundled vocabulary (N29), not yet a live
 * collection — it is added here when it becomes live data the backup must carry.
 */
export interface BackupData {
  profiles: CollectionSnapshot[];
  users: CollectionSnapshot[];
  config: CollectionSnapshot[];
  bugReports: CollectionSnapshot[];
}

/**
 * The backup read seam. Injected so the download route is unit-testable against an
 * in-memory double. Reads the authoritative on-disk Firestore state (what a restore
 * would reload), not the in-memory projection cache.
 */
export interface BackupSource {
  export(): Promise<BackupData>;
}

/** The real {@link BackupSource}: reads the live collections from Firestore. */
export class FirestoreBackupSource implements BackupSource {
  constructor(private readonly db: Firestore) {}

  async export(): Promise<BackupData> {
    const [profiles, users, config, bugReports] = await Promise.all([
      this.snapshot("profiles"),
      this.snapshot("users"),
      this.snapshot("config"),
      this.snapshot("bugReports"),
    ]);
    return { profiles, users, config, bugReports };
  }

  private async snapshot(name: string): Promise<CollectionSnapshot[]> {
    const snap = await this.db.collection(name).get();
    return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  }
}

/** An in-memory {@link BackupSource} double for tests; defaults to empty collections. */
export class InMemoryBackupSource implements BackupSource {
  constructor(
    private readonly data: BackupData = {
      profiles: [],
      users: [],
      config: [],
      bugReports: [],
    },
  ) {}

  async export(): Promise<BackupData> {
    return this.data;
  }
}
