/**
 * The logic behind `assert:geo-tables` (OFC-378, D175). Pure functions over text
 * so they can be unit tested; the filesystem walk lives in the CLI.
 *
 * Two failure modes are being guarded, and they are unrelated to each other
 * except that both are silent:
 *
 * 1. **The manifest drifting from the tables.** The tables are served under
 *    content-hashed filenames so Firebase Hosting can cache them immutably, and
 *    the SPA learns those filenames from a *generated* module. Hand-edit either
 *    side — or commit one and not the other — and the app fetches a 404 that
 *    only shows up when somebody actually opens the Near control.
 * 2. **The tables reaching the JS bundle.** D74's ceiling sums brotli over
 *    `dist/assets/*.js` and the build sits close to it; the ZIP table alone is
 *    larger than the headroom, so a stray `import … from "…zips.csv?raw"` would
 *    blow the budget. The ceiling would catch the *size*, eventually and
 *    confusingly; this names the cause, without needing a build.
 */

import { createHash } from "node:crypto";

/** A malformed manifest — reported as a gate failure, not a crash. */
export class GeoTablesError extends Error {}

/** One table, as the generated manifest describes it. */
export interface ManifestEntry {
  url: string;
  rows: number;
}

/** The generated manifest's contents. */
export interface Manifest {
  zips: ManifestEntry;
  cities: ManifestEntry;
}

/** A source file, for the import scan. */
export interface SourceFile {
  path: string;
  text: string;
}

/** The directory the tables are served from, relative to the web app's `public`. */
export const TABLE_URL_PREFIX = "/geo/";

/** Length of the content hash embedded in a table filename. */
const HASH_LENGTH = 8;

/**
 * Read `zips` and `cities` out of the generated manifest module. Deliberately a
 * regex rather than an import: the assertion has to run before any build step,
 * and reading the file as text also catches a hand-edit that would still
 * compile.
 */
export function parseManifest(source: string): Manifest {
  const entry = (name: string): ManifestEntry => {
    const pattern = new RegExp(`${name}\\s*:\\s*\\{\\s*url:\\s*"([^"]+)"\\s*,\\s*rows:\\s*(\\d+)`);
    const match = pattern.exec(source);
    if (match === null) {
      throw new GeoTablesError(
        `the generated manifest has no readable "${name}" entry — regenerate it with \`npm run build:tables --workspace tools/geo-data\``,
      );
    }
    // Non-null: both groups are required by the pattern that just matched.
    return { url: match[1] as string, rows: Number(match[2] as string) };
  };
  return { zips: entry("zips"), cities: entry("cities") };
}

/** The content hash a table's bytes should carry in its filename. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, HASH_LENGTH);
}

/** The filename part of a table URL, or `undefined` if the URL is not one of ours. */
export function tableFilename(url: string): string | undefined {
  if (!url.startsWith(TABLE_URL_PREFIX)) {
    return undefined;
  }
  const name = url.slice(TABLE_URL_PREFIX.length);
  return name.includes("/") || name === "" ? undefined : name;
}

/** The hash embedded in `zips.<hash>.csv`, or `undefined` if it is not shaped that way. */
export function hashFromFilename(filename: string): string | undefined {
  return new RegExp(`^[a-z]+\\.([0-9a-f]{${HASH_LENGTH}})\\.csv$`).exec(filename)?.[1];
}

/** Data rows in a generated table: not the `#` provenance block, not the header. */
export function countDataRows(text: string): number {
  let headerSeen = false;
  let rows = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }
    rows++;
  }
  return rows;
}

/**
 * Source files that pull a table in as a module. Matches a static or dynamic
 * import of any `.csv`, with or without a Vite query suffix (`?raw`, `?url`),
 * which is the only way one of these could reach a JS chunk.
 */
export function findTableImports(files: readonly SourceFile[]): string[] {
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'][^"']*\.csv(?:\?[^"']*)?["']/;
  return files.filter((file) => pattern.test(file.text)).map((file) => file.path);
}

/** What the CLI hands to `checkTables` after reading the filesystem. */
export interface TableInputs {
  manifest: Manifest;
  /** Every file in the served directory, keyed by filename. */
  present: ReadonlyMap<string, string>;
  /** Every source file that could import a table. */
  sources: readonly SourceFile[];
}

/** Every problem found; an empty array means the tables and manifest agree. */
export function checkTables({ manifest, present, sources }: TableInputs): string[] {
  const problems: string[] = [];
  const expected = new Set<string>();

  for (const [name, table] of Object.entries(manifest) as Array<[string, ManifestEntry]>) {
    const filename = tableFilename(table.url);
    if (filename === undefined) {
      problems.push(
        `manifest "${name}" URL ${JSON.stringify(table.url)} is not a ${TABLE_URL_PREFIX} path`,
      );
      continue;
    }
    expected.add(filename);

    const contents = present.get(filename);
    if (contents === undefined) {
      problems.push(`manifest "${name}" names ${filename}, which is not in the served directory`);
      continue;
    }

    const declared = hashFromFilename(filename);
    if (declared === undefined) {
      problems.push(`${filename} does not carry a content hash — it cannot be cached immutably`);
    } else if (declared !== contentHash(contents)) {
      problems.push(
        `${filename} has been edited: its bytes hash to ${contentHash(contents)}, not ${declared}. Regenerate with \`npm run build:tables --workspace tools/geo-data\` rather than editing a table.`,
      );
    }

    const actualRows = countDataRows(contents);
    if (actualRows !== table.rows) {
      problems.push(
        `manifest "${name}" claims ${table.rows} rows, but ${filename} holds ${actualRows}`,
      );
    }
  }

  for (const filename of present.keys()) {
    if (!expected.has(filename)) {
      problems.push(
        `${filename} is served but named by no manifest entry — a stale table left behind by an earlier build. Re-run the generator, which prunes them.`,
      );
    }
  }

  for (const path of findTableImports(sources)) {
    problems.push(
      `${path} imports a .csv as a module. The proximity tables must be fetched at runtime, never bundled (D74's ceiling; D172).`,
    );
  }

  return problems;
}
