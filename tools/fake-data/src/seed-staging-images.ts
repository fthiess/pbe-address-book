/**
 * Seed placeholder THUMBNAILS into the STAGING image bucket so the Directory's
 * image retrieval / display / lazy-load paths can be exercised against the real
 * `/img/*` serving path before the Phase-4 headshot pipeline exists.
 *
 * For every generated brother that carries `hasHeadshot` + `headshotVersion`,
 * this uploads one of the committed placeholder WEBP fixtures
 * (`fixtures/thumbnails/`, authored by `author:thumbnails`) to the brother's
 * thumbnail object key — the shared `thumbnailObjectKey` contract (`@pbe/shared`)
 * the SPA reads and the Phase-4 pipeline will write. The fixtures are **content,
 * not generation**: real generated thumbnails later land at the identical keys,
 * so nothing here is bypassed or thrown away.
 *
 * Guarded exactly like `seed-staging.ts` — staging project only, never the
 * emulator host — plus it needs `IMAGE_BUCKET` (the same env the API reads).
 * It is a **clean replace**: the `thumbnails/` prefix is wiped first, so a re-run
 * is a pure function of the generator + fixtures.
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   GOOGLE_CLOUD_PROJECT=pbe-book-staging IMAGE_BUCKET=pbe-book-staging-images \
 *     npm run seed:staging-images --workspace tools/fake-data
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { thumbnailObjectKey } from "@pbe/shared";
import { initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { generateProfiles } from "./generate.js";

const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
const bucketName = process.env.IMAGE_BUCKET;

if (!projectId) {
  console.error("Refusing to seed images: set GOOGLE_CLOUD_PROJECT to the staging project id.");
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "Refusing to seed images: FIRESTORE_EMULATOR_HOST is set (that targets the emulator).",
  );
  process.exit(1);
}
if (!projectId.endsWith("-staging")) {
  console.error(
    `Refusing to seed images: project "${projectId}" does not end with "-staging". This script only ever writes fake fixtures to a staging bucket (D72); it must never touch production.`,
  );
  process.exit(1);
}
if (!bucketName) {
  console.error("Refusing to seed images: set IMAGE_BUCKET to the staging image bucket name.");
  process.exit(1);
}

// Load the committed placeholder fixtures once; cycle them across brothers so the
// directory shows visible variety (which is what lets a tester confirm the right
// image maps to the right row during lazy-load testing).
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_COUNT = 8;
const fixtures = await Promise.all(
  Array.from({ length: FIXTURE_COUNT }, (_, i) =>
    readFile(join(here, "..", "fixtures", "thumbnails", `placeholder-${i}.webp`)),
  ),
);

initializeApp({ projectId });
const bucket = getStorage().bucket(bucketName);

// Clean replace: wipe the thumbnails/ prefix so a re-run can't leave stale keys.
const [existing] = await bucket.getFiles({ prefix: "thumbnails/" });
if (existing.length > 0) {
  await runPooled(existing, 16, (file) => file.delete().then(() => undefined));
  console.log(`Cleared ${existing.length} existing thumbnail objects.`);
}

const withHeadshot = generateProfiles().filter((p) => p.hasHeadshot && p.headshotVersion);
console.log(`Uploading ${withHeadshot.length} placeholder thumbnails to ${bucketName}…`);

let uploaded = 0;
await runPooled(withHeadshot, 16, async (profile) => {
  const bytes = fixtures[profile.id % FIXTURE_COUNT] as Buffer;
  const key = thumbnailObjectKey(profile.id, profile.headshotVersion as string);
  await bucket.file(key).save(bytes, {
    contentType: "image/webp",
    metadata: { cacheControl: "private, max-age=31536000, immutable" },
  });
  uploaded += 1;
  if (uploaded % 100 === 0) {
    console.log(`  …uploaded ${uploaded}/${withHeadshot.length}`);
  }
});

console.log(`Seeded ${uploaded} placeholder thumbnails into bucket ${bucketName}.`);
process.exit(0);

/** Run `task` over `items` with at most `limit` in flight at once. */
async function runPooled<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await task(items[index] as T);
    }
  });
  await Promise.all(workers);
}
