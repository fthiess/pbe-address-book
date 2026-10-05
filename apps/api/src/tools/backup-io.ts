import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { GcsBackupStore } from "../data/backup-store.js";
import { LATEST_OBJECT, isDefaultDatabase } from "./restore-support.js";

/**
 * The I/O both backup operator tools share — the restore (D101) and the integrity
 * check that follows it (`verify-backup.ts`, D102/D151). Shared rather than copied
 * because the integrity job's whole claim is "the restore read *this* snapshot from
 * *this* database": two hand-kept copies of how a snapshot is located, or of how a
 * database id becomes a Firestore handle, are exactly the place the two tools could
 * quietly come to mean different things.
 */

/** A snapshot's raw text and a human-readable account of where it came from. */
export interface SnapshotText {
  text: string;
  /** A path on disk or a `gs://` URL — printed and recorded, never parsed. */
  source: string;
  /** The object name `latest` resolved to, when it was used; else null. */
  resolvedLatest: { name: string; takenAt: Date } | null;
}

/**
 * Read the snapshot text from disk or from the backup bucket. `object` may be the
 * literal {@link LATEST_OBJECT}, which picks the newest snapshot by its timestamped
 * name. Throws if the bucket holds none — a caller's error message is better than
 * an empty restore.
 *
 * Requires `initializeApp()` to have run first: `--object` reads the bucket through
 * `getStorage()`, which throws `app/no-app` without it (the failure that killed the
 * restore's first live run, N138).
 */
export async function loadSnapshotText(
  file: string | null,
  object: string | null,
  bucket: string,
): Promise<SnapshotText> {
  if (file !== null) {
    return { text: await readFile(file, "utf-8"), source: resolve(file), resolvedLatest: null };
  }
  const store = new GcsBackupStore(bucket);
  if (object !== LATEST_OBJECT) {
    const name = object ?? "";
    return { text: await store.read(name), source: `gs://${bucket}/${name}`, resolvedLatest: null };
  }
  const latest = await store.latest();
  if (latest === null) {
    throw new Error(`the bucket gs://${bucket} holds no snapshots.`);
  }
  return {
    text: await store.read(latest.name),
    source: `gs://${bucket}/${latest.name}`,
    resolvedLatest: latest,
  };
}

/**
 * The Firestore handle for a `--database` value. The default database goes through
 * the no-argument overload every other path in Book uses, rather than through
 * `getFirestore("(default)")`, so the change that introduced named databases leaves
 * the live-environment path byte-for-byte what it was. `firebase-admin` 14.2
 * declares `getFirestore(databaseId: string)`.
 */
export function openFirestore(database: string | null): Firestore {
  return database === null || isDefaultDatabase(database) ? getFirestore() : getFirestore(database);
}
