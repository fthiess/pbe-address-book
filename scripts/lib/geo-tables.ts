/**
 * The logic behind `assert:geo-tables` (OFC-378, D177). Pure functions over text
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
 * The row count a table declares in its own `#` provenance block, or `undefined`
 * if it declares none.
 *
 * ⚠ Checked because the **client** trusts it: `useGeoTables.ts` compares its
 * parsed row count against this line to tell a truncated download from a
 * complete one, since the header survives a truncation and the rows do not. That
 * makes the line load-bearing rather than documentation, and this is the only
 * place that can notice it drifting from the rows beneath it.
 */
export function declaredRows(text: string): number | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#")) {
      return undefined;
    }
    const match = /^#\s*rows:\s*(\d+)$/.exec(trimmed);
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
}

/**
 * How many leading columns form each table's key: a ZIP is unique on its own, a
 * city on (name, state) — "Aberdeen" alone is four different towns.
 */
const KEY_COLUMNS: Readonly<Record<string, number>> = { zips: 1, cities: 2 };

/**
 * Keys appearing on more than one data row (at most `limit` of them, since the
 * message only needs to be actionable).
 *
 * ⚠ This exists because the **client** checks its parsed row count against the
 * manifest's, to tell a truncated fetch from a complete one (`useGeoTables.ts`) —
 * and both tables parse into keyed structures, so that comparison is only
 * meaningful while the keys are unique. Nothing else asserts it: the generator
 * merges three sources and a future vintage could introduce a collision without
 * anything noticing. The check belongs at build time, where a data problem is a
 * red build; at runtime the same problem would take the feature dark for everyone.
 */
export function findDuplicateKeys(text: string, columns: number, limit = 5): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let headerSeen = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }
    const key = trimmed.split(",").slice(0, columns).join(",");
    if (seen.has(key)) {
      if (duplicates.length < limit) {
        duplicates.push(key);
      }
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

/**
 * Source files that pull a table in as a module. Matches every import form that
 * can reach a JS chunk — `from "…"`, dynamic `import("…")`, `require("…")` and
 * the **bare side-effect `import "…"`**, which has neither a `from` nor a
 * parenthesis and is the one a `from`-anchored pattern quietly misses. With or
 * without a Vite query suffix (`?raw`, `?url`).
 *
 * ⚠ A *string literal* naming a table must stay legal: fetching one is the whole
 * design, so the pattern is anchored on the import keywords, never on the path.
 */
export function findTableImports(files: readonly SourceFile[]): string[] {
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'][^"']*\.csv(?:\?[^"']*)?["']/;
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

/** Everything checked about one table's *bytes*, once it has been located. */
function checkTableContents(
  name: string,
  filename: string,
  contents: string,
  claimedRows: number,
): string[] {
  const problems: string[] = [];

  const declaredHash = hashFromFilename(filename);
  if (declaredHash === undefined) {
    problems.push(`${filename} does not carry a content hash — it cannot be cached immutably`);
  } else if (declaredHash !== contentHash(contents)) {
    problems.push(
      `${filename} has been edited: its bytes hash to ${contentHash(contents)}, not ${declaredHash}. Regenerate with \`npm run build:tables --workspace tools/geo-data\` rather than editing a table.`,
    );
  }

  const actualRows = countDataRows(contents);
  if (actualRows !== claimedRows) {
    problems.push(
      `manifest "${name}" claims ${claimedRows} rows, but ${filename} holds ${actualRows}`,
    );
  }

  const declaredCount = declaredRows(contents);
  if (declaredCount === undefined) {
    problems.push(
      `${filename} carries no "# rows:" line in its provenance block. The client checks its parsed row count against that line to detect a truncated download, so it must be there.`,
    );
  } else if (declaredCount !== actualRows) {
    problems.push(
      `${filename} declares "# rows: ${declaredCount}" but holds ${actualRows}. Regenerate rather than editing a table.`,
    );
  }

  const keyColumns = KEY_COLUMNS[name];
  if (keyColumns !== undefined) {
    const duplicates = findDuplicateKeys(contents, keyColumns);
    if (duplicates.length > 0) {
      problems.push(
        `${filename} repeats ${duplicates.length === 1 ? "a key" : "keys"}: ${duplicates.join(", ")}. Each row must be uniquely keyed on its first ${keyColumns} column(s) — the client counts parsed entries against the manifest to detect a truncated download, and a duplicate makes that count lie.`,
      );
    }
  }

  return problems;
}

/** Every problem found; an empty array means the tables and manifest agree. */
export function checkTables({ manifest, present, sources }: TableInputs): string[] {
  const problems: string[] = [];
  const expected = new Set<string>();

  // This loop resolves each manifest entry to a file; everything that can then be
  // said about the file itself is `checkTableContents`' business. Split because
  // the two are different questions — "is this table where the manifest says" and
  // "is this table well-formed" — and keeping them in one body put the function
  // over Biome's cognitive-complexity ceiling as the second grew.
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

    problems.push(...checkTableContents(name, filename, contents, table.rows));
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
