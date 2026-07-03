/**
 * Author the placeholder image fixtures — a one-time-ish authoring step whose
 * machinery lives in the repo so the fixtures are reproducible, never a manual
 * ritual (run with `npm run author:thumbnails --workspace tools/fake-data`).
 *
 * It draws eight neutral avatar silhouettes (a head-and-shoulders on a tinted
 * field) as SVG and rasterizes each to **both** a 96×96 thumbnail WEBP
 * (`fixtures/thumbnails/`) and a 512×512 headshot WEBP (`fixtures/headshots/`) —
 * the exact dimensions and codec the real Directory thumbnail and Profile headshot
 * use (D98/§6). These are **content, not generation**: they stand in for a
 * brother's photo so the image retrieval / display / lazy-load paths can be tested,
 * and the real crop/encode pipeline (4c-1) writes its output to the very same
 * object keys. The committed WEBP outputs let CI and the seeder run without
 * invoking sharp; this script lets anyone regenerate or restyle them with one
 * command.
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

/**
 * An avatar-silhouette SVG at the given pixel size. The shape coordinates stay in a
 * `0 0 96` viewBox and the SVG's width/height scale them, so a 512² render is crisp
 * vector output (not an upscaled 96² raster).
 */
function silhouetteSvg(tint: string, size: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">`,
    `<rect width="96" height="96" fill="${tint}"/>`,
    `<circle cx="48" cy="39" r="17" fill="${SILHOUETTE}"/>`,
    `<path d="M20 96 C20 68 76 68 76 96 Z" fill="${SILHOUETTE}"/>`,
    "</svg>",
  ].join("");
}

const here = dirname(fileURLToPath(import.meta.url));

/** The two derivatives to author, each into its own fixtures directory. */
const OUTPUTS = [
  { dir: join(here, "..", "fixtures", "thumbnails"), size: 96 },
  { dir: join(here, "..", "fixtures", "headshots"), size: 512 },
] as const;

for (const { dir, size } of OUTPUTS) {
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < TINTS.length; i++) {
    const svg = silhouetteSvg(TINTS[i] as string, size);
    const webp = await sharp(Buffer.from(svg)).resize(size, size).webp({ quality: 80 }).toBuffer();
    const file = join(dir, `placeholder-${i}.webp`);
    await writeFile(file, webp);
    console.log(`wrote ${file} (${webp.length} bytes)`);
  }
  console.log(`Authored ${TINTS.length} placeholder images (${size}²) into ${dir}.`);
}
