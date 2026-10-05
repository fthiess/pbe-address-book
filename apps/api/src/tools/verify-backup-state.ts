import type { Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { FirestoreBackupSource } from "../data/backup.js";
import { ProfileCache } from "../data/cache.js";
import type { RestoredState } from "./verify-backup-support.js";

/**
 * The integrity check's reads (D102/D151) — what `verify-backup-support.ts`'s pure
 * checks judge. Kept out of the entrypoint so the emulator suite can drive the
 * Firestore half against a real restore; the GCS half has no emulator and is
 * exercised by the integrity job's first real run (PL-6b), which is why it is as
 * small as it can be.
 */

/**
 * Read the restored database back, and hydrate Book's real cache from it. The
 * hydration is the point: `hydrateFromFirestore` is exactly what a Cloud Run cold
 * start runs (D85/D97), so a count that matches here is a roster Book would serve,
 * not merely documents that exist.
 */
export async function readRestoredState(db: Firestore): Promise<RestoredState> {
  const collections = await new FirestoreBackupSource(db).export();
  const cache = new ProfileCache();
  await cache.hydrateFromFirestore(db);
  return { collections, hydratedSize: cache.size, hydratedUsableAdmins: cache.adminCount() };
}

/** The object-key prefixes the image manifest points into (`@pbe/shared` images.ts). */
const IMAGE_PREFIXES = ["headshots/", "thumbnails/"] as const;

/**
 * Every live object key under the manifest's two prefixes — one paged listing each
 * rather than a metadata call per manifest entry (~1,500 at today's roster).
 * `getFiles` auto-paginates by default, the same behaviour `GcsBackupStore.latest`
 * already relies on. Needs only `storage.objects.list`, which the verify project's
 * cross-project `objectViewer` grant (D151 (2)) carries.
 */
export async function listImageKeys(bucketName: string): Promise<Set<string>> {
  const bucket = getStorage().bucket(bucketName);
  const keys = new Set<string>();
  for (const prefix of IMAGE_PREFIXES) {
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files) {
      keys.add(file.name);
    }
  }
  return keys;
}
