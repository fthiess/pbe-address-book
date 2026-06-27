/**
 * Author the placeholder thumbnail fixtures — a one-time-ish authoring step whose
 * machinery lives in the repo so the fixtures are reproducible, never a manual
 * ritual (run with `npm run author:thumbnails --workspace tools/fake-data`).
 *
 * It draws eight neutral avatar silhouettes (a head-and-shoulders on a tinted
 * field) as SVG and rasterizes each to a 96×96 WEBP — the exact dimensions and
 * codec a real Directory thumbnail uses (D98) — writing them to
 * `fixtures/thumbnails/`. These are **content, not generation**: they stand in
 * for a brother's photo so the image retrieval / display / lazy-load paths can be
 * tested in Phase 3, and the Phase-4 headshot pipeline (the real crop/encode
 * step) later writes its output to the very same object keys. The committed WEBP
 * outputs let CI and the seeder run without invoking sharp; this script lets
 * anyone regenerate or restyle them from the repo with one command.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Eight muted fields, deep enough that a near-white silhouette reads against them.
const TINTS = [
  "#5b6b7a",
  "#6b5b73",
  "#4a6b5b",
  "#6b5b4a",
  "#4a5b6b",
  "#6b4a5b",
  "#5b6b4a",
  "#4a4a5b",
];

const SILHOUETTE = "rgba(255,255,255,0.82)";

/** A 96×96 avatar-silhouette SVG over the given background field. */
function silhouetteSvg(tint: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">',
    `<rect width="96" height="96" fill="${tint}"/>`,
    `<circle cx="48" cy="39" r="17" fill="${SILHOUETTE}"/>`,
    `<path d="M20 96 C20 68 76 68 76 96 Z" fill="${SILHOUETTE}"/>`,
    "</svg>",
  ].join("");
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "fixtures", "thumbnails");

await mkdir(outDir, { recursive: true });

for (let i = 0; i < TINTS.length; i++) {
  const svg = silhouetteSvg(TINTS[i] as string);
  const webp = await sharp(Buffer.from(svg)).resize(96, 96).webp({ quality: 80 }).toBuffer();
  const file = join(outDir, `placeholder-${i}.webp`);
  await writeFile(file, webp);
  console.log(`wrote ${file} (${webp.length} bytes)`);
}

console.log(`Authored ${TINTS.length} placeholder thumbnails into ${outDir}.`);
