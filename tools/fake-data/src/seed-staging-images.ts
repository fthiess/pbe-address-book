/**
 * Seed placeholder IMAGES into the STAGING image bucket so the Directory thumbnail
 * AND the Profile headshot paths can be exercised against the real `/img/*`
 * serving path with fake data.
 *
 * For every generated brother that carries `hasHeadshot` + `headshotVersion`, this
 * uploads one committed placeholder fixture to **both** of the brother's object
 * keys — the 96² `thumbnailObjectKey` (from `fixtures/thumbnails/`) and the 512²
 * `headshotObjectKey` (from `fixtures/headshots/`), the shared `@pbe/shared`
 * contracts the SPA reads and the real 4c-1 pipeline writes. Seeding both is what
 * keeps the Directory thumbnail and the Profile headshot **consistent** (the same
 * tint variant per brother); before this, only thumbnails were seeded, so a
 * `hasHeadshot` record showed a real thumbnail in the Directory but fell back to
 * the generated avatar on its Profile page. The fixtures are **content, not
 * generation**: real cropped images later land at the identical keys.
 *
 * Guarded exactly like `seed-staging.ts` — staging project only, never the
 * emulator host — plus it needs `IMAGE_BUCKET` (the same env the API reads). It is
 * a **clean replace**: the `thumbnails/` and `headshots/` prefixes are wiped first,
 * so a re-run is a pure function of the generator + fixtures.
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   GOOGLE_CLOUD_PROJECT=pbe-book-staging IMAGE_BUCKET=pbe-book-staging-images \
 *     npm run seed:staging-images --workspace tools/fake-data
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { headshotObjectKey, thumbnailObjectKey } from "@pbe/shared";
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
/** Load a fixture set (thumbnails or headshots), one WEBP per tint variant. */
function loadFixtures(kind: "thumbnails" | "headshots"): Promise<Buffer[]> {
  return Promise.all(
    Array.from({ length: FIXTURE_COUNT }, (_, i) =>
      readFile(join(here, "..", "fixtures", kind, `placeholder-${i}.webp`)),
    ),
  );
}
const thumbFixtures = await loadFixtures("thumbnails");
const headshotFixtures = await loadFixtures("headshots");

initializeApp({ projectId });
const bucket = getStorage().bucket(bucketName);

// Clean replace: wipe BOTH prefixes so a re-run can't leave stale keys.
for (const prefix of ["thumbnails/", "headshots/"]) {
  const [existing] = await bucket.getFiles({ prefix });
  if (existing.length > 0) {
    await runPooled(existing, 16, (file) => file.delete().then(() => undefined));
    console.log(`Cleared ${existing.length} existing ${prefix} objects.`);
  }
}

const withHeadshot = generateProfiles().filter((p) => p.hasHeadshot && p.headshotVersion);
console.log(
  `Uploading ${withHeadshot.length} placeholder thumbnails + headshots to ${bucketName}…`,
);

const IMMUTABLE = {
  contentType: "image/webp",
  metadata: { cacheControl: "private, max-age=31536000, immutable" },
};
let uploaded = 0;
await runPooled(withHeadshot, 16, async (profile) => {
  const variant = profile.id % FIXTURE_COUNT;
  const version = profile.headshotVersion as string;
  // Same tint variant to both keys so the Directory thumbnail and the Profile
  // headshot are consistent for a given brother.
  await Promise.all([
    bucket
      .file(thumbnailObjectKey(profile.id, version))
      .save(thumbFixtures[variant] as Buffer, IMMUTABLE),
    bucket
      .file(headshotObjectKey(profile.id, version))
      .save(headshotFixtures[variant] as Buffer, IMMUTABLE),
  ]);
  uploaded += 1;
  if (uploaded % 100 === 0) {
    console.log(`  …uploaded ${uploaded}/${withHeadshot.length}`);
  }
});

console.log(`Seeded ${uploaded} placeholder thumbnails + headshots into bucket ${bucketName}.`);
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
