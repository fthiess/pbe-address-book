import { headshotObjectKey, thumbnailObjectKey } from "@pbe/shared";
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
 * A complete snapshot of Book's **durable** Firestore collections (D63). The MVP
 * export (Phase 5a-1) is JSON-only; the image-object bundle and the nightly
 * automated job are Phase 7 (ENGINEERING-DESIGN §6.3). `majors` is a bundled
 * vocabulary (N29), not yet a live collection — added here when it becomes live
 * data the backup must carry. `bugReports` (D121) is deliberately **excluded**:
 * it is transient triage data an admin clears (like `sessions`/`authNonces`), not
 * part of the directory a restore reconstructs (DECISIONS N61).
 */
export interface BackupData {
  profiles: CollectionSnapshot[];
  users: CollectionSnapshot[];
  config: CollectionSnapshot[];
}

/**
 * The backup read seam. Injected so the download route is unit-testable against an
 * in-memory double. Reads the authoritative on-disk Firestore state (what a restore
 * would reload), not the in-memory projection cache.
 */
export interface BackupSource {
  export(): Promise<BackupData>;
}

/** The real {@link BackupSource}: reads the durable collections from Firestore. */
export class FirestoreBackupSource implements BackupSource {
  constructor(private readonly db: Firestore) {}

  async export(): Promise<BackupData> {
    const [profiles, users, config] = await Promise.all([
      this.snapshot("profiles"),
      this.snapshot("users"),
      this.snapshot("config"),
    ]);
    return { profiles, users, config };
  }

  private async snapshot(name: string): Promise<CollectionSnapshot[]> {
    const snap = await this.db.collection(name).get();
    return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  }
}

/** An in-memory {@link BackupSource} double for tests; defaults to empty collections. */
export class InMemoryBackupSource implements BackupSource {
  constructor(private readonly data: BackupData = { profiles: [], users: [], config: [] }) {}

  async export(): Promise<BackupData> {
    return this.data;
  }
}

/**
 * One brother's headshot objects, as pinned by a snapshot (D63's "image-version
 * manifest"). Images are **not** re-copied into each backup — GCS object versioning
 * (D8) already preserves their history — so what a restore needs is a pointer to
 * exactly the right object versions, which is what this is.
 */
export interface ImageManifestEntry {
  /** The brother's Constitution ID. */
  id: number;
  /** The opaque `headshotVersion` token live at snapshot time (N42/R16). */
  version: string;
  /** The full-size object key, e.g. `headshots/5247/3.webp`. */
  headshotKey: string;
  /** The 96×96 thumbnail object key. */
  thumbnailKey: string;
}

/**
 * Derive the image-version manifest from an already-taken `profiles` snapshot.
 *
 * WHY THIS IS PURE DERIVATION, AND NOT A BUCKET LISTING (7b-2, Forrest's call).
 * The object key shape is `headshots/{id}/{version}.webp` and `headshotVersion` is
 * already a field on every profile document, so the profiles snapshot *already*
 * pins the exact objects — a manifest built from anything else would be a second,
 * drift-capable statement of the same fact. Making it explicit still earns its
 * place: it hands the offline restore (D101/7b-3) and the integrity job (D102/7b-4)
 * a flat list instead of making each re-derive key construction, and it survives a
 * future change to the key shape as a record of what the keys *were*.
 *
 * It deliberately does **not** consult GCS. Enriching entries with live generation
 * numbers or checksums would make taking a backup depend on a bucket listing
 * succeeding, and verifying that the objects a manifest names actually exist is
 * precisely what D102's integrity job is for: **7b-2 records intent, 7b-4 verifies
 * reality.**
 *
 * As of 7b-3 the restore reads the manifest's *count* and nothing more — it
 * replaces the three Firestore collections and touches no image state, because
 * resurrecting a superseded GCS generation is the other half of the same 7b-4 job
 * (OFC-333). So the manifest is still a record of intent with no consumer that acts
 * on it; the promise above is outstanding, not redeemed.
 *
 * Brothers with no headshot are simply absent (~two thirds of the roster carries
 * no photo). A document missing either flag or the version token is skipped rather
 * than emitted with a half-built key.
 */
export function deriveImageManifest(profiles: readonly CollectionSnapshot[]): ImageManifestEntry[] {
  const manifest: ImageManifestEntry[] = [];
  for (const { data } of profiles) {
    const id = data.id;
    const version = data.headshotVersion;
    if (data.hasHeadshot !== true || typeof id !== "number" || typeof version !== "string") {
      continue;
    }
    manifest.push({
      id,
      version,
      headshotKey: headshotObjectKey(id, version),
      thumbnailKey: thumbnailObjectKey(id, version),
    });
  }
  return manifest;
}

/**
 * The snapshot envelope version: `collections` plus the `images` manifest.
 *
 * Both producers emit it as of 7b-3. It shipped in 7b-2 for the automated job only,
 * with the manual D52 download left at version 1 (`collections` alone) and the
 * unification parked for the session that would first read both (D147). That
 * session built the restore, and it is unified here — see `routes/backup.ts`. The
 * restore still *reads* version 1, so archives downloaded before the change stay
 * restorable; nothing produces one any more.
 */
export const BACKUP_SNAPSHOT_VERSION = 2;

/** A complete automated snapshot, as serialized into one bucket object. */
export interface BackupSnapshot {
  version: typeof BACKUP_SNAPSHOT_VERSION;
  /** When the snapshot was taken — the same instant its object name encodes. */
  generatedAt: string;
  collections: BackupData;
  images: ImageManifestEntry[];
}

/** Build the snapshot envelope for `collections`, taken at `at`. */
export function buildBackupSnapshot(collections: BackupData, at: Date): BackupSnapshot {
  return {
    version: BACKUP_SNAPSHOT_VERSION,
    generatedAt: at.toISOString(),
    collections,
    images: deriveImageManifest(collections.profiles),
  };
}
