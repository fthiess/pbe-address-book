import type { Firestore } from "firebase-admin/firestore";
import type { BackupData, CollectionSnapshot } from "./backup.js";
import { RESTORE_COLLECTIONS, type RestoreCollection } from "./restore.js";

/**
 * The write half of the offline restore (D101; 7b-3) — the only bulk write into
 * Book that exists, and the only one D100 permits, because it happens with the
 * service down rather than alongside a live writer.
 *
 * **Faithful whole-database replacement, not a merge** (D63). Each of the three
 * collections ends holding exactly the documents the snapshot names: every document
 * present in the target but absent from the snapshot is deleted, and every document
 * in the snapshot is written verbatim under its captured key. A `set()`-only
 * restore would leave stale documents behind — the failure `seed-staging.ts`
 * records from the first Phase-2c staging deploy, where an older id keyspace
 * survived a re-seed and broke cache hydration — and "be exactly this snapshot"
 * would quietly become "be this snapshot plus whatever was already there".
 *
 * Deletes run before writes for the same reason the seed wipes first: the result is
 * then a pure function of the snapshot, independent of what the target held.
 *
 * The {@link RestoreTarget} seam exists so the plan/execute logic is unit-testable
 * against an in-memory double, with the emulator suite reserved for what a double
 * cannot honestly prove — that Firestore's batch semantics land the same result.
 */

/** Under Firestore's 500-writes-per-batch ceiling (the `seed-staging.ts` figure). */
export const RESTORE_BATCH_LIMIT = 450;

/** The write seam a restore drives: real = Firestore, tests = in-memory. */
export interface RestoreTarget {
  /** Every document id currently in the collection (to compute the deletions). */
  listDocIds(collection: RestoreCollection): Promise<string[]>;
  deleteDocs(collection: RestoreCollection, ids: readonly string[]): Promise<void>;
  writeDocs(collection: RestoreCollection, docs: readonly CollectionSnapshot[]): Promise<void>;
}

/** What a restore would do to one collection. */
export interface RestoreCollectionPlan {
  collection: RestoreCollection;
  /** Documents present in the target but not in the snapshot — removed. */
  deleteIds: string[];
  /** Documents the snapshot writes (every one of them, verbatim). */
  writeCount: number;
}

export interface RestorePlan {
  collections: RestoreCollectionPlan[];
  totalDeletes: number;
  totalWrites: number;
}

/**
 * Compute the restore plan from the target's current document ids. Pure, so
 * `--dry-run` and the real run report the identical numbers — a dry run that
 * computed its preview differently from the execution would be worse than no
 * preview at all.
 */
export function planRestore(
  current: Readonly<Record<RestoreCollection, readonly string[]>>,
  snapshot: BackupData,
): RestorePlan {
  const collections: RestoreCollectionPlan[] = RESTORE_COLLECTIONS.map((collection) => {
    const keep = new Set(snapshot[collection].map((doc) => doc.id));
    return {
      collection,
      deleteIds: current[collection].filter((id) => !keep.has(id)),
      writeCount: snapshot[collection].length,
    };
  });
  return {
    collections,
    totalDeletes: collections.reduce((sum, plan) => sum + plan.deleteIds.length, 0),
    totalWrites: collections.reduce((sum, plan) => sum + plan.writeCount, 0),
  };
}

/** Progress reporting for the CLI; the executor itself prints nothing. */
export type RestoreProgress = (message: string) => void;

/** Read the current document ids of all three collections. */
export async function readCurrentDocIds(
  target: RestoreTarget,
): Promise<Record<RestoreCollection, string[]>> {
  const [profiles, users, config] = await Promise.all([
    target.listDocIds("profiles"),
    target.listDocIds("users"),
    target.listDocIds("config"),
  ]);
  return { profiles, users, config };
}

/**
 * Replace the three collections with the snapshot's contents, returning the plan
 * that was executed. Collections are processed in order and each finishes its
 * deletes before its writes; nothing here is transactional, because a restore
 * spans far more documents than any Firestore transaction may hold — which is
 * exactly why it runs under hard maintenance (D118) with the service down, and why
 * a failed run is resumed by re-running it rather than rolled back.
 */
export async function executeRestore(
  target: RestoreTarget,
  snapshot: BackupData,
  onProgress: RestoreProgress = () => {},
): Promise<RestorePlan> {
  const plan = planRestore(await readCurrentDocIds(target), snapshot);
  for (const collectionPlan of plan.collections) {
    const { collection, deleteIds } = collectionPlan;
    if (deleteIds.length > 0) {
      await target.deleteDocs(collection, deleteIds);
      onProgress(`  …removed ${deleteIds.length} stale ${collection} doc(s)`);
    }
    const docs = snapshot[collection];
    if (docs.length > 0) {
      await target.writeDocs(collection, docs);
      onProgress(`  …wrote ${docs.length} ${collection} doc(s)`);
    }
  }
  return plan;
}

/** The real target: batched writes against Firestore. */
export class FirestoreRestoreTarget implements RestoreTarget {
  constructor(private readonly db: Firestore) {}

  async listDocIds(collection: RestoreCollection): Promise<string[]> {
    // Reference-only read (no field data) — the plan needs the key set alone.
    const snapshot = await this.db.collection(collection).select().get();
    return snapshot.docs.map((doc) => doc.id);
  }

  async deleteDocs(collection: RestoreCollection, ids: readonly string[]): Promise<void> {
    for (let start = 0; start < ids.length; start += RESTORE_BATCH_LIMIT) {
      const batch = this.db.batch();
      for (const id of ids.slice(start, start + RESTORE_BATCH_LIMIT)) {
        batch.delete(this.db.collection(collection).doc(id));
      }
      await batch.commit();
    }
  }

  async writeDocs(
    collection: RestoreCollection,
    docs: readonly CollectionSnapshot[],
  ): Promise<void> {
    for (let start = 0; start < docs.length; start += RESTORE_BATCH_LIMIT) {
      const batch = this.db.batch();
      for (const doc of docs.slice(start, start + RESTORE_BATCH_LIMIT)) {
        // `set` without merge: the document becomes exactly the snapshot's data,
        // so a field the snapshot omits is *gone*, not inherited from the record
        // that happened to sit under this key (D63's "be exactly this snapshot").
        batch.set(this.db.collection(collection).doc(doc.id), doc.data);
      }
      await batch.commit();
    }
  }
}

/** An in-memory {@link RestoreTarget} double for tests. */
export class InMemoryRestoreTarget implements RestoreTarget {
  readonly collections: Record<RestoreCollection, Map<string, Record<string, unknown>>> = {
    profiles: new Map(),
    users: new Map(),
    config: new Map(),
  };

  constructor(seed?: Partial<Record<RestoreCollection, readonly CollectionSnapshot[]>>) {
    for (const collection of RESTORE_COLLECTIONS) {
      for (const doc of seed?.[collection] ?? []) {
        this.collections[collection].set(doc.id, doc.data);
      }
    }
  }

  async listDocIds(collection: RestoreCollection): Promise<string[]> {
    return [...this.collections[collection].keys()];
  }

  async deleteDocs(collection: RestoreCollection, ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      this.collections[collection].delete(id);
    }
  }

  async writeDocs(
    collection: RestoreCollection,
    docs: readonly CollectionSnapshot[],
  ): Promise<void> {
    for (const doc of docs) {
      this.collections[collection].set(doc.id, doc.data);
    }
  }
}
