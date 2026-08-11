/**
 * Regenerate the proximity search tables (OFC-378, D172/D175).
 *
 *   npm run build:tables --workspace tools/geo-data -- [--refresh] [--threshold N]
 *
 * Downloads the three public sources (cached under `.cache/`, gitignored),
 * merges them into `zips.csv` and `cities.csv`, asserts the results against the
 * spot-check lists in `checks.ts`, and writes the tables into
 * `apps/web/public/geo/` under **content-hashed filenames** plus a generated
 * manifest module the SPA imports for their URLs.
 *
 * ⚠ This script is **never** run by CI or by the verification gate: it needs the
 * network and downloads ~8 MB. The gate instead asserts (in
 * `scripts/assert-geo-tables.ts`) that the committed tables and the manifest
 * still agree. Everything this script orchestrates — the source parsers, the
 * archive reader, the merge and population join, and the spot-check
 * assertions — is unit-tested over fixtures in `src/*.test.ts`; what is not
 * covered is the fetching and the writing, which is all that is left here.
 *
 * Output is deterministic — the same three input files always produce the same
 * bytes, so a rebuild that changes nothing also changes no filename.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

import { checkCityTable, checkZipTable } from "./checks.js";
import { parseGazetteer, parseGeoNames, parseSubEst } from "./sources.js";
import {
  COORDINATE_PRECISION,
  buildCityVocabulary,
  buildPopulationIndex,
  formatCityCsv,
  formatZipCsv,
  mergeZipCentroids,
} from "./tables.js";
import { extractZipEntries, zipEntry } from "./zip.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const CACHE_DIR = join(HERE, "..", ".cache");
const OUTPUT_DIR = join(REPO_ROOT, "apps", "web", "public", "geo");
const MANIFEST_PATH = join(REPO_ROOT, "apps", "web", "src", "generated", "geoTables.ts");

/** The population estimate vintage to read from the sub-county file. */
const POPULATION_COLUMN = "POPESTIMATE2024";

/** Design decision 3 (D172): the origin vocabulary is pruned at 10,000. */
const DEFAULT_POPULATION_THRESHOLD = 10_000;

interface Source {
  /** Cache filename. */
  file: string;
  url: string;
  description: string;
}

const SOURCES = {
  gazetteer: {
    file: "gaz_zcta.zip",
    url: "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip",
    description: "US Census 2020 ZCTA Gazetteer (public domain)",
  },
  geonames: {
    file: "geonames_us.zip",
    url: "https://download.geonames.org/export/zip/US.zip",
    description: "GeoNames US postal codes (CC BY 4.0, https://www.geonames.org/)",
  },
  population: {
    file: "sub-est2024.csv",
    url: "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv",
    description: "US Census sub-county population estimates 2024 (public domain)",
  },
} satisfies Record<string, Source>;

const USAGE = `Regenerate the proximity search tables (OFC-378, D172).

Usage:
  npm run build:tables --workspace tools/geo-data -- [options]

Options:
  --refresh        Re-download the sources even if they are already cached.
  --threshold N    City population cut-off (default ${DEFAULT_POPULATION_THRESHOLD}).
  --dry-run        Build and check everything, but write nothing.
  --help           Show this message.

Writes apps/web/public/geo/{zips,cities}.<hash>.csv and the generated manifest
apps/web/src/generated/geoTables.ts. Sources are cached under tools/geo-data/.cache/.
`;

function fail(message: string): never {
  stderr.write(`\n[geo-data] FAIL: ${message}\n`);
  return exit(1);
}

/** Fetch a source into the cache unless it is already there. */
async function ensureCached(source: Source, refresh: boolean): Promise<Buffer> {
  const path = join(CACHE_DIR, source.file);
  if (!refresh && existsSync(path)) {
    stdout.write(`  cached   ${source.file}\n`);
    return readFileSync(path);
  }
  stdout.write(`  download ${source.url}\n`);
  const response = await fetch(source.url);
  if (!response.ok) {
    fail(`${source.url} returned HTTP ${response.status} ${response.statusText}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(path, body);
  return body;
}

/** Short content hash — the filename suffix and the provenance fingerprint. */
function shortHash(data: Buffer | string, length: number): string {
  return createHash("sha256").update(data).digest("hex").slice(0, length);
}

function brotliKb(text: string): string {
  const size = brotliCompressSync(Buffer.from(text, "utf8"), {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  return `${(size / 1024).toFixed(1)} KB`;
}

/** Delete any table file in the output directory that the manifest no longer names. */
function pruneStaleTables(keep: ReadonlySet<string>): string[] {
  if (!existsSync(OUTPUT_DIR)) {
    return [];
  }
  const removed: string[] = [];
  for (const name of readdirSync(OUTPUT_DIR)) {
    if (!keep.has(name)) {
      rmSync(join(OUTPUT_DIR, name));
      removed.push(name);
    }
  }
  return removed;
}

function manifestModule(
  zips: { url: string; rows: number },
  cities: { url: string; rows: number },
) {
  return `/**
 * GENERATED FILE — do not edit.
 *
 * Written by \`npm run build:tables --workspace tools/geo-data\`; the URLs carry a
 * content hash so the tables can be served immutably (OFC-378, D175). The gate's
 * \`assert:geo-tables\` step fails if this manifest and the files in
 * \`apps/web/public/geo/\` ever disagree.
 *
 * ⚠ These tables must be **fetched**, never imported: D74's bundle ceiling sums
 * every chunk in \`dist/assets\`, and the ZIP table alone is larger than the
 * headroom.
 */

export interface GeoTable {
  /** Absolute path, served by Firebase Hosting from \`apps/web/public\`. */
  readonly url: string;
  /** Data rows, excluding the provenance comments and the column header. */
  readonly rows: number;
}

export const GEO_TABLES: { readonly zips: GeoTable; readonly cities: GeoTable } = {
  zips: { url: ${JSON.stringify(zips.url)}, rows: ${zips.rows} },
  cities: { url: ${JSON.stringify(cities.url)}, rows: ${cities.rows} },
};
`;
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    stdout.write(USAGE);
    return;
  }
  const refresh = args.includes("--refresh");
  const dryRun = args.includes("--dry-run");
  const thresholdAt = args.indexOf("--threshold");
  const threshold =
    thresholdAt < 0 ? DEFAULT_POPULATION_THRESHOLD : Number(args[thresholdAt + 1] ?? Number.NaN);
  if (!Number.isFinite(threshold) || threshold < 0) {
    fail(`--threshold needs a non-negative number, got ${JSON.stringify(args[thresholdAt + 1])}`);
  }

  stdout.write("[geo-data] sources\n");
  const gazetteerZip = await ensureCached(SOURCES.gazetteer, refresh);
  const geonamesZip = await ensureCached(SOURCES.geonames, refresh);
  const populationCsv = await ensureCached(SOURCES.population, refresh);

  stdout.write("\n[geo-data] parsing\n");
  const gazetteer = parseGazetteer(
    zipEntry(extractZipEntries(gazetteerZip), /Gaz_zcta.*\.txt$/i).toString("utf8"),
  );
  const geonames = parseGeoNames(
    zipEntry(extractZipEntries(geonamesZip), /^US\.txt$/i).toString("utf8"),
  );
  // ⚠ latin-1, not UTF-8 — see parseSubEst. Reading it as UTF-8 costs the
  // vocabulary every place whose name carries an accent.
  const population = parseSubEst(populationCsv.toString("latin1"), POPULATION_COLUMN);
  stdout.write(
    `  gazetteer  ${gazetteer.rows.length} ZCTAs (${gazetteer.skipped} skipped)\n` +
      `  geonames   ${geonames.rows.length} postal rows (${geonames.skipped} skipped)\n` +
      `  population ${population.rows.length} estimate rows (${population.skipped} skipped)\n`,
  );
  if (gazetteer.rows.length === 0 || geonames.rows.length === 0 || population.rows.length === 0) {
    fail("a source parsed to zero rows — the upstream format has probably changed");
  }

  stdout.write("\n[geo-data] building\n");
  const centroids = mergeZipCentroids(gazetteer.rows, geonames.rows);
  const fromGeonames = [...centroids.values()].filter((p) => p.source === "geonames").length;
  const cities = buildCityVocabulary(
    geonames.rows,
    centroids,
    buildPopulationIndex(population.rows),
    threshold,
  );
  stdout.write(
    `  zips       ${centroids.size} (${centroids.size - fromGeonames} Census, ${fromGeonames} GeoNames gap-fill)\n` +
      `  cities     ${cities.length} at population >= ${threshold}\n`,
  );

  stdout.write("\n[geo-data] checking\n");
  const problems = [...checkZipTable(centroids), ...checkCityTable(cities)];
  if (problems.length > 0) {
    stderr.write(problems.map((problem) => `  ✗ ${problem}\n`).join(""));
    fail(`${problems.length} check(s) failed — nothing written`);
  }
  stdout.write("  all spot-checks pass\n");

  const sourceFingerprints = [
    `${SOURCES.gazetteer.description} sha256:${shortHash(gazetteerZip, 16)}`,
    `${SOURCES.geonames.description} sha256:${shortHash(geonamesZip, 16)}`,
    `${SOURCES.population.description} column:${POPULATION_COLUMN} sha256:${shortHash(populationCsv, 16)}`,
  ];
  const common = [
    "PBE Book proximity tables — generated by tools/geo-data, do not edit by hand.",
    ...sourceFingerprints,
    `coordinates rounded to ${COORDINATE_PRECISION} decimal places (~1.1 km)`,
  ];

  const zipsCsv = formatZipCsv(centroids, [...common, `rows: ${centroids.size}`]);
  const citiesCsv = formatCityCsv(cities, [
    ...common,
    `population threshold: ${threshold}`,
    `rows: ${cities.length}`,
  ]);

  const zipsName = `zips.${shortHash(zipsCsv, 8)}.csv`;
  const citiesName = `cities.${shortHash(citiesCsv, 8)}.csv`;
  const manifest = manifestModule(
    { url: `/geo/${zipsName}`, rows: centroids.size },
    { url: `/geo/${citiesName}`, rows: cities.length },
  );

  stdout.write(
    `\n[geo-data] output\n  ${zipsName}   ${(zipsCsv.length / 1024).toFixed(1)} KB raw, ${brotliKb(zipsCsv)} brotli-11\n  ${citiesName}   ${(citiesCsv.length / 1024).toFixed(1)} KB raw, ${brotliKb(citiesCsv)} brotli-11\n`,
  );

  if (dryRun) {
    stdout.write("\n[geo-data] --dry-run: nothing written\n");
    return;
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, zipsName), zipsCsv, "utf8");
  writeFileSync(join(OUTPUT_DIR, citiesName), citiesCsv, "utf8");
  writeFileSync(MANIFEST_PATH, manifest, "utf8");
  const removed = pruneStaleTables(new Set([zipsName, citiesName]));
  for (const name of removed) {
    stdout.write(`  removed stale ${name}\n`);
  }
  stdout.write("\n[geo-data] OK — tables and manifest written\n");
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
