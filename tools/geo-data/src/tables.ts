/**
 * Building the two proximity tables from the parsed sources (D172,
 * `PROXIMITY-SEARCH-DESIGN.md` §3–§4). Pure functions: text in, text out, no
 * filesystem and no network, so the whole pipeline is unit-testable.
 *
 * Two things here are load-bearing and both are documented at their function:
 * the population join (which silently deletes New England if keyed on place
 * code) and the emitted CSV's freedom from quoting (the browser-side parser is
 * a `split(",")` by design, so a name carrying a comma must fail the build here
 * rather than corrupt a row there).
 */

import type { GazetteerRow, GeoNamesRow, PopulationRow } from "./sources.js";

/** Coordinates are emitted at 2 dp — ~1.1 km, far finer than a 25-mile radius needs. */
export const COORDINATE_PRECISION = 2;

/** A point on the merged ZIP table, with the source that supplied it. */
export interface ZipCentroid {
  lat: number;
  lon: number;
  source: "census" | "geonames";
}

/** A city in the origin vocabulary. */
export interface CityRow {
  name: string;
  stateCode: string;
  lat: number;
  lon: number;
  population: number;
}

/** Round to the emitted precision, normalising `-0` to `0` so it prints as "0". */
export function round(value: number): number {
  const factor = 10 ** COORDINATE_PRECISION;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Merge the two ZIP sources into one centroid table.
 *
 * Census ZCTAs are authoritative and win wherever they exist. GeoNames fills the
 * ~8,500 PO-box and point ZIPs that have no delivery area and therefore no ZCTA
 * (§3). Where GeoNames lists a ZIP more than once — the same code serving
 * several named places — the first row wins; the alternatives are within the
 * same delivery area, so at 2 dp the choice is immaterial.
 */
export function mergeZipCentroids(
  gazetteer: readonly GazetteerRow[],
  geonames: readonly GeoNamesRow[],
): Map<string, ZipCentroid> {
  const merged = new Map<string, ZipCentroid>();
  for (const row of gazetteer) {
    merged.set(row.zcta, { lat: round(row.lat), lon: round(row.lon), source: "census" });
  }
  for (const row of geonames) {
    if (!merged.has(row.zip)) {
      merged.set(row.zip, { lat: round(row.lat), lon: round(row.lon), source: "geonames" });
    }
  }
  return merged;
}

/**
 * The Census entity-type words that follow a place name: "Brookline **town**",
 * "Boston **city**", "Bethesda **CDP**". They are part of the Census name and
 * absent from the GeoNames name, so they have to come off before the two can be
 * compared. Longest-first, because "charter township" must be stripped whole
 * rather than leaving "charter" behind.
 */
const ENTITY_SUFFIXES = [
  "consolidated government",
  "metropolitan government",
  "metro government",
  "unified government",
  "city and borough",
  "charter township",
  "urban county",
  "municipality",
  "reservation",
  "corporation",
  "plantation",
  "township",
  "village",
  "borough",
  "purchase",
  "location",
  "district",
  "county",
  "grant",
  "town",
  "city",
  "gore",
  "cdp",
];

/**
 * Abbreviations the two sources spell differently. Census writes "St. Louis
 * city" where GeoNames writes "Saint Louis", and the same split runs through
 * Mount/Mt., Fort/Ft. and Sainte/Ste. Expanding rather than contracting keeps
 * one spelling for names that are already written out.
 */
const ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bst\b/g, "saint"],
  [/\bste\b/g, "sainte"],
  [/\bmt\b/g, "mount"],
  [/\bft\b/g, "fort"],
];

/**
 * Reduce a place name to a join key: case-folded, diacritic-folded, punctuation
 * removed, abbreviations expanded, Census entity-type words and parenthetical
 * qualifiers ("(balance)", "(pt.)") stripped.
 *
 * Diacritic folding is what lets "La Cañada Flintridge" match across the two
 * sources — but only if the latin-1 file was decoded as latin-1 first (see
 * `parseSubEst`); a U+FFFD does not fold to anything.
 */
export function normalizePlaceName(name: string): string {
  let key = name
    .normalize("NFD")
    // Combining marks left behind by the NFD decomposition — the `M` category
    // rather than a hand-written range, so the source stays plain ASCII.
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  for (const [pattern, replacement] of ABBREVIATIONS) {
    key = key.replace(pattern, replacement);
  }
  // Strip entity-type words from the end, repeatedly: "Nashville-Davidson
  // metropolitan government (balance)" and "Butte-Silver Bow (balance)" both
  // shed two.
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of ENTITY_SUFFIXES) {
      if (key.endsWith(` ${suffix}`)) {
        key = key.slice(0, -suffix.length - 1).trim();
        changed = true;
        break;
      }
    }
  }
  return key.replace(/\s+/g, " ").trim();
}

/**
 * The summary levels that supply a place's own population: 162 incorporated
 * place, 157 place part, 061 county subdivision, 170 consolidated city.
 */
export const POPULATION_SUMMARY_LEVELS: ReadonlySet<string> = new Set(["162", "157", "061", "170"]);

/** Counties, used only to fill gaps — see `buildPopulationIndex`. */
export const COUNTY_SUMMARY_LEVEL = "050";

/** Join key for the population index: state name and normalised place name. */
export function populationKey(stateName: string, placeName: string): string {
  return `${stateName.trim().toLowerCase()}|${normalizePlaceName(placeName)}`;
}

/** Parenthetical qualifiers that are not an alias: "(balance)", "(pt.)". */
const PARENTHETICAL_QUALIFIERS: ReadonlySet<string> = new Set(["balance", "pt", "part"]);

/**
 * Extra names a Census entity is also known by, so the join can find the name a
 * user would actually type. Two patterns, both drawn from the real file:
 *
 * - **A parenthetical alias.** "San Buenaventura (Ventura) city" is universally
 *   called Ventura, and Ventura is what GeoNames calls its ZIPs.
 * - **A merged jurisdiction's leading name.** "Louisville/Jefferson County metro
 *   government (balance)", "Lexington-Fayette urban county", "Macon-Bibb
 *   County", "Butte-Silver Bow (balance)" — the city is Louisville, Lexington,
 *   Macon, Butte. Between them these cover 200-odd ZIPs, so leaving them
 *   unmatched drops several genuinely large cities from the vocabulary.
 *
 * The merged-jurisdiction split fires only when the text after the separator
 * signals a merger ("county", "government", "(balance)"), so ordinary
 * hyphenated names — Winston-Salem, Wilkes-Barre — are left alone.
 */
export function alternatePlaceNames(rawName: string): string[] {
  const alternates: string[] = [];
  for (const match of rawName.matchAll(/\(([^)]*)\)/g)) {
    const key = normalizePlaceName(match[1] ?? "");
    if (key !== "" && !PARENTHETICAL_QUALIFIERS.has(key)) {
      alternates.push(key);
    }
  }
  const separatorAt = rawName.search(/[-/]/);
  if (separatorAt > 0) {
    const tail = rawName.slice(separatorAt + 1).toLowerCase();
    if (/\bcounty\b|\bgovernment\b|\(balance\)/.test(tail)) {
      const key = normalizePlaceName(rawName.slice(0, separatorAt));
      if (key !== "") {
        alternates.push(key);
      }
    }
  }
  return alternates;
}

/**
 * Index populations by (state, normalised name) across summary levels 162
 * (incorporated place), 157 (place part) and 061 (county subdivision).
 *
 * ⚠ **Keying on the Census place code instead silently deletes New England**
 * (§4, D172). Town-organised states record their towns as county subdivisions —
 * SUMLEV 061 — not as places, so Brookline, Lexington, Arlington and Belmont all
 * vanish from a place-code join while California looks perfect. The town
 * spot-check in `checks.ts` exists because no naturally-written unit test catches
 * this: the pipeline succeeds, the table is well-formed, and a quarter of the
 * membership's home towns are simply absent.
 *
 * Where several rows share a key — a village inside a like-named township, or a
 * place counted both as 162 and as a 157 part — the **largest** population wins.
 * The number is only ever compared against a threshold and never reaches the
 * emitted table, so the question it stands in for is "would a user plausibly
 * type this place?", for which the generous reading is the right one.
 *
 * The index is built in three tiers, each filling only what the tier above left
 * empty, so a real place always beats an alias and an alias always beats a
 * county:
 *
 * 1. **Places**, keyed on their own name.
 * 2. **Aliases** of those places (`alternatePlaceNames`) — Ventura, Louisville.
 * 3. **Counties** (SUMLEV 050), which recover the handful of large *unincorporated*
 *    places that share their county's name: Honolulu (the Census entity is
 *    "Urban Honolulu CDP", absent from the estimates) and Arlington, VA. A county
 *    entry can only ever matter for a name GeoNames already uses for a postal
 *    place, so this does not scatter county names through the vocabulary.
 */
export function buildPopulationIndex(rows: readonly PopulationRow[]): Map<string, number> {
  const index = new Map<string, number>();
  const remember = (key: string, population: number, overwrite: boolean): void => {
    const existing = index.get(key);
    if (existing === undefined || (overwrite && population > existing)) {
      index.set(key, population);
    }
  };

  for (const row of rows) {
    if (POPULATION_SUMMARY_LEVELS.has(row.sumlev)) {
      remember(populationKey(row.stateName, row.name), row.population, true);
    }
  }
  for (const row of rows) {
    if (POPULATION_SUMMARY_LEVELS.has(row.sumlev)) {
      for (const alternate of alternatePlaceNames(row.name)) {
        remember(`${row.stateName.trim().toLowerCase()}|${alternate}`, row.population, false);
      }
    }
  }
  for (const row of rows) {
    if (row.sumlev === COUNTY_SUMMARY_LEVEL) {
      remember(populationKey(row.stateName, row.name), row.population, false);
    }
  }
  return index;
}

/**
 * Build the origin city vocabulary: every GeoNames place whose population meets
 * the threshold, at the mean of its own ZIP centroids.
 *
 * The coordinate is averaged over the place's ZIPs (taken from the merged table,
 * so Census centroids are used wherever they exist) rather than read from a
 * separate city gazetteer. For a radius filter that is the more useful point
 * anyway: it is the centre of the place's *postal* extent, which is what the
 * members being matched against are located by.
 *
 * A place with no population match is dropped. That is the intended behaviour
 * for postal-station names — "Needham Heights" has no Census entity, while
 * "Needham" does — and it is why the vocabulary is smaller than the set of
 * distinct GeoNames place names.
 */
export function buildCityVocabulary(
  geonames: readonly GeoNamesRow[],
  centroids: ReadonlyMap<string, ZipCentroid>,
  populations: ReadonlyMap<string, number>,
  threshold: number,
): CityRow[] {
  interface Accumulator {
    name: string;
    stateCode: string;
    stateName: string;
    latSum: number;
    lonSum: number;
    count: number;
  }
  const places = new Map<string, Accumulator>();
  for (const row of geonames) {
    const point = centroids.get(row.zip);
    if (point === undefined) {
      continue;
    }
    const key = `${row.stateCode}|${normalizePlaceName(row.place)}`;
    const existing = places.get(key);
    if (existing === undefined) {
      places.set(key, {
        name: row.place,
        stateCode: row.stateCode,
        stateName: row.stateName,
        latSum: point.lat,
        lonSum: point.lon,
        count: 1,
      });
    } else {
      existing.latSum += point.lat;
      existing.lonSum += point.lon;
      existing.count++;
    }
  }

  const cities: CityRow[] = [];
  for (const place of places.values()) {
    const population = populations.get(populationKey(place.stateName, place.name));
    if (population === undefined || population < threshold) {
      continue;
    }
    cities.push({
      name: place.name,
      stateCode: place.stateCode,
      lat: round(place.latSum / place.count),
      lon: round(place.lonSum / place.count),
      population,
    });
  }

  cities.sort(
    (a, b) => a.name.localeCompare(b.name, "en") || a.stateCode.localeCompare(b.stateCode),
  );
  return cities;
}

/**
 * Provenance lines emitted at the head of each table, one `#` comment per line.
 * No timestamp: the same inputs must produce a byte-identical file, so that a
 * regeneration that changes nothing also changes no content hash and therefore
 * no filename.
 */
export function provenanceHeader(lines: readonly string[]): string {
  return lines.map((line) => `# ${line}\n`).join("");
}

/**
 * A field is safe to emit unquoted. The consumer splits on commas, so anything
 * carrying a comma, a quote or a newline has to fail the build — see
 * `assertEmittable`.
 */
export function isEmittableField(value: string): boolean {
  return !/[",\r\n]/.test(value);
}

/** Throw on any city name the flat-CSV format cannot carry unquoted. */
export function assertEmittable(cities: readonly CityRow[]): void {
  const bad = cities.filter((city) => !isEmittableField(city.name));
  if (bad.length > 0) {
    throw new Error(
      `city names unrepresentable in unquoted CSV (${bad.length}): ${bad
        .slice(0, 5)
        .map((city) => `${city.name} (${city.stateCode})`)
        .join(", ")}`,
    );
  }
}

/** Emit `zip,lat,lon`, ZIP-ascending, behind the provenance comment block. */
export function formatZipCsv(
  centroids: ReadonlyMap<string, ZipCentroid>,
  header: readonly string[],
): string {
  const zips = [...centroids.keys()].sort();
  const body = zips
    .map((zip) => {
      // Non-null: every key came from this map.
      const point = centroids.get(zip) as ZipCentroid;
      return `${zip},${point.lat},${point.lon}\n`;
    })
    .join("");
  return `${provenanceHeader(header)}zip,lat,lon\n${body}`;
}

/** Emit `city,state,lat,lon`, name-ascending, behind the provenance comment block. */
export function formatCityCsv(cities: readonly CityRow[], header: readonly string[]): string {
  assertEmittable(cities);
  const body = cities
    .map((city) => `${city.name},${city.stateCode},${city.lat},${city.lon}\n`)
    .join("");
  return `${provenanceHeader(header)}city,state,lat,lon\n${body}`;
}
