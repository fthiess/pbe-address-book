/**
 * Prepare the UAT photo corpus (Stage 1.2; OFC-249) — transcode a directory of
 * AI-generated fake headshots into the exact pair of WEBP derivatives the app
 * serves, once, so the staging image seeder can simply copy bytes.
 *
 * WHY THIS LIVES IN `apps/api`. The whole point of the ticket is that the corpus
 * goes through **the same pipeline as a real upload** — a shortcut here would mean
 * UAT never exercises the real encode path before real headshots land at cutover.
 * `encodeHeadshot` is that pipeline, it lives next door in `../images/encode.js`,
 * and `sharp` is already a dependency here. Putting the tool in `tools/fake-data`
 * instead would have meant either deep-importing across a workspace boundary or
 * extracting the encoder into a new package — plumbing that buys nothing. This
 * follows the precedent `src/tools/restore.ts` already set: a CLI that ships with
 * the API package but never with the API bundle (esbuild only ever entry-points
 * `src/index.ts`).
 *
 * WHY PREPARE ONCE RATHER THAN ENCODE ON EVERY RESEED *(Forrest's call, Stage 1.2)*.
 * The corpus is ~540 MB of 1024² PNGs and the encode is deterministic, so running
 * it inside the deploy would pull half a gigabyte to a GitHub runner and perform
 * ~800 sharp operations on every deploy, forever, to recompute a byte-identical
 * result. Preparing once yields ~15 MB of WEBP that the seeder treats exactly like
 * the eight committed placeholder fixtures. The trade is that the prepared set can
 * go stale if the encode constants change — which is what `manifest.json` records
 * and the seeder checks, rather than leaving it to be noticed by eye.
 *
 * The output is deliberately a LOCAL directory, not a direct GCS write: it keeps
 * this tool's job purely "transcode", leaves the artifact inspectable before it
 * goes anywhere near a bucket, and makes the upload a single documented command
 * (`infra/README.md`). The corpus and its derivatives must **never** enter this
 * repo — it is public, and while these faces are synthetic the fixture prefix is
 * private and shared with the tester roster.
 *
 * Usage (from the repo root):
 *   npm run prepare:uat-photos --workspace apps/api -- \
 *     --source "/path/to/book_fake_headshots" --out ./restore-artifacts/uat-photos
 *
 * Flags: `--help` prints usage; `--dry-run` reports what would be produced without
 * writing anything (CLAUDE.md CLI rule; OFC-79).
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { type UatPhotoManifest, uatPhotoName } from "@pbe/shared";
import { HEADSHOT_SIZE, THUMBNAIL_SIZE, encodeHeadshot } from "../images/encode.js";

/** The extensions `encodeHeadshot` accepts by magic-byte sniff (JPEG/PNG). */
const SOURCE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

function printHelp(): void {
  console.log(
    [
      "prepare:uat-photos — transcode the UAT fake-headshot corpus into the 512² +",
      "                     96² WEBP derivatives the app serves (OFC-249).",
      "",
      "Usage:",
      "  npm run prepare:uat-photos --workspace apps/api -- \\",
      "    --source <dir-of-1024-square-pngs> --out <output-dir> [--dry-run]",
      "",
      "Options:",
      "  --source <dir>  Directory of source headshots (.png/.jpg). Required.",
      "  --out <dir>     Directory to write headshots/, thumbnails/ and manifest.json.",
      "                  Required unless --dry-run.",
      "  --dry-run       Report the count and mapping; write NOTHING.",
      "  --help,-h       Show this help and exit.",
      "",
      "Sources are ordered by FILENAME so the index mapping is deterministic — a",
      "re-run puts the same face on the same profile. Upload the result to the",
      "private UAT fixtures bucket; see infra/README.md. Never commit it: this repo",
      "is PUBLIC.",
    ].join("\n"),
  );
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const DRY_RUN = args.includes("--dry-run");
const sourceDir = argValue(args, "--source");
const outDir = argValue(args, "--out");

if (!sourceDir) {
  console.error("Refusing: --source <dir> is required. See --help.");
  process.exit(1);
}
if (!outDir && !DRY_RUN) {
  console.error("Refusing: --out <dir> is required unless --dry-run. See --help.");
  process.exit(1);
}

// Sorted by filename: the corpus's numbering has gaps (rejected generations were
// deleted), so the numbers are NOT a dense sequence and must not be parsed into
// indices. Sorting the names and assigning positions is what makes the mapping
// deterministic and reproducible across machines.
const entries = await readdir(sourceDir, { withFileTypes: true });
const sources = entries
  .filter((e) => e.isFile() && SOURCE_EXTENSIONS.has(extname(e.name).toLowerCase()))
  .map((e) => e.name)
  .sort();

if (sources.length === 0) {
  console.error(`Refusing: no .png/.jpg files found in ${sourceDir}.`);
  process.exit(1);
}

console.log(
  `Found ${sources.length} source image(s) in ${sourceDir}; encoding to ${HEADSHOT_SIZE}² headshot + ${THUMBNAIL_SIZE}² thumbnail WEBP.`,
);

if (DRY_RUN) {
  console.log(
    `[dry-run] Would write ${sources.length} headshot + thumbnail pair(s) to ${outDir ?? "<--out>"}.`,
  );
  console.log(
    `[dry-run] Index mapping (first 3): ${sources
      .slice(0, 3)
      .map((name, i) => `${uatPhotoName(i)} ← ${basename(name)}`)
      .join(", ")}${sources.length > 3 ? ", …" : ""}`,
  );
  console.log("[dry-run] No files were written.");
  process.exit(0);
}

const out = outDir as string;
await mkdir(join(out, "headshots"), { recursive: true });
await mkdir(join(out, "thumbnails"), { recursive: true });

const photos: { index: number; source: string }[] = [];
let done = 0;
// Serial, not pooled: `encodeHeadshot` decodes a full 1024² image per call and the
// API is memory-bounded around exactly one decode at a time (OFC-123). This is a
// one-off offline run, so the few minutes it costs are worth not diverging from
// the production path's concurrency assumptions.
for (const [index, name] of sources.entries()) {
  const bytes = await readFile(join(sourceDir, name));
  const { headshot, thumbnail } = await encodeHeadshot(bytes);
  const objectName = uatPhotoName(index);
  await writeFile(join(out, "headshots", objectName), headshot);
  await writeFile(join(out, "thumbnails", objectName), thumbnail);
  photos.push({ index, source: name });
  done += 1;
  if (done % 50 === 0) {
    console.log(`  …encoded ${done}/${sources.length}`);
  }
}

const manifest: UatPhotoManifest = {
  version: 1,
  count: photos.length,
  headshotSize: HEADSHOT_SIZE,
  thumbnailSize: THUMBNAIL_SIZE,
  photos,
};
await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Prepared ${photos.length} photo(s) into ${out} (headshots/, thumbnails/, manifest.json). Upload with the command in infra/README.md; do NOT commit these.`,
);
process.exit(0);
