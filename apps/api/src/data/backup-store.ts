import { getStorage } from "firebase-admin/storage";

/**
 * The **automated** backup object store (D63/D101; ENGINEERING-DESIGN §6.3). The
 * nightly job (`POST /api/internal/backup`, 7b-2) writes one timestamped JSON
 * snapshot per run into a dedicated, ACL-restricted GCS bucket, and reads the
 * bucket back to answer "when did a backup last succeed?" for its pre-flight
 * staleness check.
 *
 * Sibling of {@link ImageStore} by construction — the same seam-plus-doubles shape,
 * the same lazy `getStorage()` bucket handle — so route tests drive the whole job
 * against an in-memory double while a real `GcsBackupStore` talks to the bucket in
 * every deployed environment.
 *
 * TWO PROPERTIES THIS SEAM DELIBERATELY HAS, AND ONE IT DELIBERATELY LACKS:
 *
 * - **Create-only.** {@link BackupStore.write} is a create, never an overwrite: the
 *   GCS call carries `ifGenerationMatch: 0`, so writing a name that already exists
 *   fails instead of silently replacing a snapshot. It pairs with the IAM posture —
 *   the runtime service account holds `objectCreator` + `objectViewer` on this
 *   bucket, never `objectAdmin` — so a compromised API cannot destroy backup
 *   history. Retention is enforced by a GCS lifecycle rule (90 days, P16/D101), not
 *   by anything Book does.
 * - **The bucket is the source of truth for "when was the last backup".** There is
 *   deliberately no Firestore "last backup at" marker: a second record of the same
 *   fact can drift from the artifact it describes, and the artifact is what a
 *   restore actually needs. {@link BackupStore.latest} reads the objects.
 * - **No delete.** Nothing in Book removes a backup; there is no method for it.
 */

/** The object-name prefix every automated snapshot lives under. */
export const BACKUP_OBJECT_PREFIX = "backups/";

/** The object-name suffix (plain JSON — see the module note on gzip in §6.3). */
const BACKUP_OBJECT_SUFFIX = ".json";

/**
 * The object name for a snapshot taken at `at`:
 * `backups/2026-07-25T19-35-05-480Z.json`.
 *
 * The ISO-8601 instant with `:` and `.` replaced by `-`. Colons are legal in GCS
 * object names but are a nuisance in shells, URLs, and `gsutil` arguments, and a
 * restore is an operator typing these names by hand under pressure (D101). The
 * substitution is safe for ordering: every component stays fixed-width, so the
 * names still sort **lexicographically by time** — which is what makes
 * {@link BackupStore.latest} a plain string comparison instead of a `latest.json`
 * pointer that could drift from the snapshot it names.
 */
export function backupObjectName(at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return `${BACKUP_OBJECT_PREFIX}${stamp}${BACKUP_OBJECT_SUFFIX}`;
}

/**
 * The inverse of {@link backupObjectName}: the instant a snapshot object names, or
 * `null` if the name is not one of ours. Returning `null` rather than throwing is
 * deliberate — an unrelated object in the bucket (an operator's scratch file, a
 * future sibling artifact) must not break the staleness check that guards the
 * backup; it is simply not a snapshot.
 */
export function parseBackupObjectName(name: string): Date | null {
  if (!name.startsWith(BACKUP_OBJECT_PREFIX) || !name.endsWith(BACKUP_OBJECT_SUFFIX)) {
    return null;
  }
  const stamp = name.slice(BACKUP_OBJECT_PREFIX.length, -BACKUP_OBJECT_SUFFIX.length);
  // Rebuild the ISO form: date, `T`, hh-mm-ss-mmm`Z` → hh:mm:ss.mmmZ.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(stamp);
  if (!match) {
    return null;
  }
  const [, date, hh, mm, ss, ms] = match;
  const parsed = new Date(`${date}T${hh}:${mm}:${ss}.${ms}Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  // Round-trip, rather than trusting `Date` to have rejected a bad instant. The
  // regex only constrains each component's WIDTH, and `Date` silently ROLLS OVER
  // an impossible-but-well-shaped calendar date instead of refusing it:
  // `new Date("2026-04-31T…")` is May 1, not Invalid Date. Without this check a
  // name Book could never have written would be accepted as a snapshot — and,
  // because `latest()` ranks by exactly this value, a rolled-over date could be
  // crowned "newest" and quietly move the staleness check's reference point.
  // Regenerating the canonical name and demanding an exact match is the cheapest
  // total guard: anything `backupObjectName` would not itself produce is not ours.
  return backupObjectName(parsed) === name ? parsed : null;
}

/** A snapshot that exists in the bucket: its object name and the instant it names. */
export interface BackupSnapshotRef {
  readonly name: string;
  readonly takenAt: Date;
}

/** The automated-backup object store seam (real = GCS; tests = in-memory). */
export interface BackupStore {
  /**
   * Write a snapshot. **Create-only** — rejects if `name` already exists, rather
   * than overwriting a snapshot that is somebody's only copy of a day.
   */
  write(name: string, body: string): Promise<void>;
  /**
   * The most recent snapshot in the bucket, or `null` if there are none (the
   * first-ever run — see the job's bootstrap path). Objects whose names are not
   * snapshot names are ignored.
   */
  latest(): Promise<BackupSnapshotRef | null>;
}

/**
 * Raised when no backup bucket is configured (`BACKUP_BUCKET` unset) — the mirror
 * of {@link ImageBucketUnconfiguredError}. The job route translates it to a `503`
 * rather than letting an undefined bucket name reach the GCS client as a confusing
 * lower-level error.
 */
export class BackupBucketUnconfiguredError extends Error {
  constructor() {
    super("No backup bucket is configured (BACKUP_BUCKET is unset).");
    this.name = "BackupBucketUnconfiguredError";
  }
}

/** The real store: snapshot objects in the GCS bucket named by `BACKUP_BUCKET`. */
export class GcsBackupStore implements BackupStore {
  constructor(private readonly bucketName: string | undefined) {}

  private bucket() {
    if (!this.bucketName) {
      throw new BackupBucketUnconfiguredError();
    }
    return getStorage().bucket(this.bucketName);
  }

  async write(name: string, body: string): Promise<void> {
    await this.bucket()
      .file(name)
      .save(body, {
        contentType: "application/json; charset=utf-8",
        // Create-only (see the module note): fail rather than replace an existing
        // snapshot. Verified against @google-cloud/storage 7.21.0, where `save()`
        // accepts `preconditionOpts` via CreateResumableUploadOptions.
        preconditionOpts: { ifGenerationMatch: 0 },
        resumable: false,
      });
  }

  async latest(): Promise<BackupSnapshotRef | null> {
    const [files] = await this.bucket().getFiles({ prefix: BACKUP_OBJECT_PREFIX });
    return newestSnapshot(files.map((file) => file.name));
  }
}

/** An in-memory {@link BackupStore} double for tests. */
export class InMemoryBackupStore implements BackupStore {
  readonly objects = new Map<string, string>();

  constructor(seed: Iterable<[string, string]> = []) {
    for (const [name, body] of seed) {
      this.objects.set(name, body);
    }
  }

  async write(name: string, body: string): Promise<void> {
    if (this.objects.has(name)) {
      // Mirrors the real store's `ifGenerationMatch: 0` rejection, so a test that
      // writes a duplicate name sees the production failure, not a silent replace.
      throw new Error(`backup object already exists: ${name}`);
    }
    this.objects.set(name, body);
  }

  async latest(): Promise<BackupSnapshotRef | null> {
    return newestSnapshot([...this.objects.keys()]);
  }
}

/**
 * The newest parseable snapshot among `names`, or `null`. Shared by both stores so
 * the in-memory double cannot disagree with GCS about which snapshot is latest.
 */
function newestSnapshot(names: readonly string[]): BackupSnapshotRef | null {
  let newest: BackupSnapshotRef | null = null;
  for (const name of names) {
    const takenAt = parseBackupObjectName(name);
    if (takenAt === null) {
      continue;
    }
    if (newest === null || takenAt.getTime() > newest.takenAt.getTime()) {
      newest = { name, takenAt };
    }
  }
  return newest;
}
