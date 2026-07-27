/**
 * Seed member IMAGES into the STAGING image bucket so the Directory thumbnail AND
 * the Profile headshot paths can be exercised against the real `/img/*` serving
 * path with fake data.
 *
 * For every generated brother that carries `hasHeadshot` + `headshotVersion`, this
 * uploads a WEBP pair to **both** of the brother's object keys — the 96²
 * `thumbnailObjectKey` and the 512² `headshotObjectKey`, the shared `@pbe/shared`
 * contracts the SPA reads and the real 4c-1 pipeline writes. Seeding both is what
 * keeps the Directory thumbnail and the Profile headshot **consistent** for a given
 * brother; before this, only thumbnails were seeded, so a `hasHeadshot` record
 * showed a real thumbnail in the Directory but fell back to the generated avatar on
 * its Profile page. The images are **content, not generation**: real cropped
 * images later land at the identical keys.
 *
 * TWO IMAGE SOURCES (OFC-249).
 *
 *  1. The **UAT photo corpus** — realistic AI-generated fake faces, prepared once by
 *     `prepare:uat-photos` (which runs them through the production `encodeHeadshot`)
 *     and parked in a private GCS fixtures bucket. Opt-in: set `UAT_FIXTURES_BUCKET`.
 *     This exists because eight recycled placeholders across ~1,200 profiles reads
 *     as broken software, and a UAT cohort's impression of a directory that looks
 *     dead colours every other piece of feedback it gives.
 *  2. The **eight committed placeholder fixtures**, cycled by id — the fallback for
 *     every profile the corpus does not reach, and the whole population when no
 *     corpus is configured.
 *
 * The corpus is smaller than the `hasHeadshot` population, so the assignment (see
 * `uat-photos.ts`) gives the real faces to the lowest ids and lets the rest fall
 * back; it never repeats a face to close the gap. If the fixtures bucket is set but
 * unreadable, this **warns loudly and falls back entirely** rather than failing:
 * a deploy must not break because an optional fixture set is missing.
 *
 * Guarded exactly like `seed-staging.ts` — staging project only, never the
 * emulator host — plus it needs `IMAGE_BUCKET` (the same env the API reads). It is
 * a **clean replace**: the `thumbnails/` and `headshots/` prefixes are wiped first,
 * so a re-run is a pure function of the generator + the configured sources.
 *
 * ⚠ It does NOT know about the UAT tester roster, and does not need to: testers get
 * their own ids from `TESTER_ID_FLOOR` (#9001+), which the generator never emits, so
 * they are absent from `hasHeadshot` and are never dressed with a fake face —
 * uploading their own photo is one of their assigned UAT tasks. The one exception is
 * a roster row that deliberately reclaims a generated id (`seed:staging-testers
 * --allow-fixture-overwrite`): that profile is seeded an image here and then has
 * `hasHeadshot` cleared by the roster tool moments later, leaving an unreferenced
 * object in the bucket. Harmless, invisible in the app, and cleared by the next
 * reseed's wipe.
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   GOOGLE_CLOUD_PROJECT=pbe-book-staging IMAGE_BUCKET=pbe-book-staging-images \
 *   UAT_FIXTURES_BUCKET=pbe-book-staging-uat \
 *     npm run seed:staging-images --workspace tools/fake-data
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEADSHOT_SIZE,
  THUMBNAIL_SIZE,
  type UatPhotoManifest,
  headshotObjectKey,
  thumbnailObjectKey,
  uatManifestKey,
  uatPhotoKey,
} from "@pbe/shared";
import { initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { generateProfiles } from "./generate.js";
import { PLACEHOLDER_COUNT, planPhotoAssignments, tallyAssignments } from "./uat-photos.js";

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
/** Load a fixture set (thumbnails or headshots), one WEBP per tint variant. */
function loadFixtures(kind: "thumbnails" | "headshots"): Promise<Buffer[]> {
  return Promise.all(
    Array.from({ length: PLACEHOLDER_COUNT }, (_, i) =>
      readFile(join(here, "..", "fixtures", kind, `placeholder-${i}.webp`)),
    ),
  );
}
const thumbFixtures = await loadFixtures("thumbnails");
const headshotFixtures = await loadFixtures("headshots");

initializeApp({ projectId });
const bucket = getStorage().bucket(bucketName);

// --- The optional UAT photo corpus -------------------------------------------

/** Prepared corpus bytes, indexed the same way `planPhotoAssignments` indexes them. */
interface UatCorpus {
  readonly headshots: readonly Buffer[];
  readonly thumbnails: readonly Buffer[];
}

const uatBucketName = process.env.UAT_FIXTURES_BUCKET;
const uatPrefix = process.env.UAT_PHOTO_PREFIX ?? "uat-photos/prepared";

/**
 * Fetch the prepared corpus, or `null` if none is configured or it cannot be read.
 *
 * Every failure here is non-fatal by design. This is fixture *content*: a deploy
 * that cannot reach it should still produce a working staging environment dressed
 * in placeholders, exactly as it did before the corpus existed. Failing the deploy
 * instead would mean an expired credential or a mistyped bucket name takes staging
 * down, which is a far worse outcome than a directory that looks plain.
 */
async function loadUatCorpus(): Promise<UatCorpus | null> {
  if (!uatBucketName) {
    return null;
  }
  const uatBucket = getStorage().bucket(uatBucketName);
  let manifest: UatPhotoManifest;
  try {
    const [raw] = await uatBucket.file(uatManifestKey(uatPrefix)).download();
    manifest = JSON.parse(raw.toString("utf8")) as UatPhotoManifest;
  } catch (error) {
    console.warn(
      `!! UAT corpus manifest not readable at gs://${uatBucketName}/${uatManifestKey(uatPrefix)} ` +
        `(${(error as Error).message}). Falling back to placeholder fixtures for every profile.`,
    );
    return null;
  }

  if (manifest.version !== 1 || !Number.isInteger(manifest.count) || manifest.count < 1) {
    console.warn(
      `!! UAT corpus manifest is malformed (version=${manifest.version}, count=${manifest.count}). Falling back to placeholders.`,
    );
    return null;
  }
  // The corpus is encoded once and then parked indefinitely, so it can outlive a
  // change to the encoder's output sizes. Warn rather than refuse: wrong-sized
  // fixtures still render, and a staging deploy is not the place to hard-fail —
  // but say it loudly, because nothing else in the system would ever notice.
  if (manifest.headshotSize !== HEADSHOT_SIZE || manifest.thumbnailSize !== THUMBNAIL_SIZE) {
    const prepared = `${manifest.headshotSize}²/${manifest.thumbnailSize}²`;
    const current = `${HEADSHOT_SIZE}²/${THUMBNAIL_SIZE}²`;
    console.warn(
      `!! UAT corpus was prepared at ${prepared} but the encoder now produces ${current}. Re-run \`prepare:uat-photos\` and re-upload; seeding the stale set for now.`,
    );
  }

  const indices = Array.from({ length: manifest.count }, (_, i) => i);
  const headshots: Buffer[] = new Array(manifest.count);
  const thumbnails: Buffer[] = new Array(manifest.count);
  try {
    await runPooled(indices, 16, async (index) => {
      const [headshot] = await uatBucket
        .file(uatPhotoKey(uatPrefix, "headshots", index))
        .download();
      const [thumbnail] = await uatBucket
        .file(uatPhotoKey(uatPrefix, "thumbnails", index))
        .download();
      headshots[index] = headshot;
      thumbnails[index] = thumbnail;
    });
  } catch (error) {
    console.warn(
      `!! UAT corpus download failed (${(error as Error).message}). Falling back to placeholders.`,
    );
    return null;
  }

  console.log(
    `Loaded ${manifest.count} prepared UAT photos from gs://${uatBucketName}/${uatPrefix}.`,
  );
  return { headshots, thumbnails };
}

const corpus = await loadUatCorpus();

// Clean replace: wipe BOTH prefixes so a re-run can't leave stale keys.
for (const prefix of ["thumbnails/", "headshots/"]) {
  const [existing] = await bucket.getFiles({ prefix });
  if (existing.length > 0) {
    await runPooled(existing, 16, (file) => file.delete().then(() => undefined));
    console.log(`Cleared ${existing.length} existing ${prefix} objects.`);
  }
}

const withHeadshot = generateProfiles().filter((p) => p.hasHeadshot && p.headshotVersion);
const versionById = new Map(withHeadshot.map((p) => [p.id, p.headshotVersion as string]));

const corpusSize = corpus?.headshots.length ?? 0;
const assignments = planPhotoAssignments(
  withHeadshot.map((p) => p.id),
  corpusSize,
);
const tally = tallyAssignments(assignments, corpusSize);
console.log(
  `Uploading ${assignments.length} thumbnail + headshot pair(s) to ${bucketName} — ` +
    `${tally.uat} from the UAT corpus, ${tally.placeholder} from the committed placeholders.`,
);
if (tally.unusedPhotos > 0) {
  console.log(
    `  (${tally.unusedPhotos} prepared photo(s) unused: the corpus is larger than the hasHeadshot population.)`,
  );
}

const IMMUTABLE = {
  contentType: "image/webp",
  metadata: { cacheControl: "private, max-age=31536000, immutable" },
};
let uploaded = 0;
await runPooled(assignments, 16, async ({ profileId, source }) => {
  const version = versionById.get(profileId) as string;
  // Both keys get the SAME source so the Directory thumbnail and the Profile
  // headshot show one consistent identity for a given brother.
  const [thumbnail, headshot] =
    source.kind === "uat"
      ? [
          (corpus as UatCorpus).thumbnails[source.index] as Buffer,
          (corpus as UatCorpus).headshots[source.index] as Buffer,
        ]
      : [thumbFixtures[source.variant] as Buffer, headshotFixtures[source.variant] as Buffer];

  await Promise.all([
    bucket.file(thumbnailObjectKey(profileId, version)).save(thumbnail, IMMUTABLE),
    bucket.file(headshotObjectKey(profileId, version)).save(headshot, IMMUTABLE),
  ]);
  uploaded += 1;
  if (uploaded % 100 === 0) {
    console.log(`  …uploaded ${uploaded}/${assignments.length}`);
  }
});

console.log(
  `Seeded ${uploaded} thumbnail + headshot pair(s) into bucket ${bucketName} ` +
    `(${tally.uat} realistic UAT faces, ${tally.placeholder} placeholders).`,
);
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
