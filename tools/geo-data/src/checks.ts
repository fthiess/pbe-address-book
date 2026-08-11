/**
 * The build-time assertions over the generated tables (D172; design §4, §12).
 *
 * These exist because the failure mode this pipeline is prone to is **silent**:
 * a mis-keyed population join produces a well-formed table of the right rough
 * size that is simply missing New England, and no naturally-written unit test
 * over synthetic fixtures notices. So the real data is checked against a list of
 * places we know must be there, and the build refuses to write on a miss.
 *
 * Every check returns problem strings rather than throwing, so one run reports
 * everything wrong at once instead of one thing per iteration.
 */

// Deliberately the *shipped* haversine, not a copy: the distance assertions below
// are only meaningful if they measure what the client will measure.
import { haversineMiles } from "@pbe/shared";

import type { CityRow, ZipCentroid } from "./tables.js";

/**
 * ZIPs whose centroid must land within `tolerance` miles of a known location.
 * Chosen to span the awkward geography: a New England metro, the Bay Area, a
 * Manhattan ZIP, Puerto Rico, Alaska and Hawaii. A column-order mistake in the
 * gazetteer parser fails every one of them at once.
 */
export const ZIP_SPOT_CHECKS: ReadonlyArray<{
  zip: string;
  lat: number;
  lon: number;
  where: string;
}> = [
  { zip: "02139", lat: 42.36, lon: -71.1, where: "Cambridge MA" },
  { zip: "02445", lat: 42.33, lon: -71.13, where: "Brookline MA" },
  { zip: "10001", lat: 40.75, lon: -73.99, where: "New York NY" },
  { zip: "94041", lat: 37.39, lon: -122.08, where: "Mountain View CA" },
  { zip: "60601", lat: 41.89, lon: -87.62, where: "Chicago IL" },
  { zip: "20001", lat: 38.91, lon: -77.02, where: "Washington DC" },
  { zip: "00901", lat: 18.47, lon: -66.1, where: "San Juan PR" },
  { zip: "99801", lat: 58.38, lon: -134.18, where: "Juneau AK" },
  { zip: "96813", lat: 21.31, lon: -157.85, where: "Honolulu HI" },
];

/**
 * The pairs from D172's first landmine, kept as a **data** assertion rather than
 * only a code one: 94041→95050 is a short hop that diverges at the second ZIP
 * digit, 94041→94901 is a long one that shares two. If the table ever stops
 * reproducing that relationship, the centroids are wrong — and the assertion
 * also stands as the standing counter-example to anyone re-proposing prefix
 * arithmetic.
 */
export const DISTANCE_SPOT_CHECKS: ReadonlyArray<{
  from: string;
  to: string;
  maxMiles?: number;
  minMiles?: number;
  note: string;
}> = [
  { from: "94041", to: "95050", maxMiles: 15, note: "Mountain View → Santa Clara is a short hop" },
  { from: "94041", to: "94901", minMiles: 25, note: "Mountain View → San Rafael is not" },
  {
    from: "63101",
    to: "62201",
    maxMiles: 10,
    note: "St Louis MO → East St Louis IL, across the river",
  },
  { from: "02139", to: "02445", maxMiles: 10, note: "Cambridge → Brookline" },
];

/**
 * Places that must appear in the city vocabulary.
 *
 * ⚠ The New England block is the whole point (design §4): every one of these is
 * a **county subdivision** in the Census files, not a place, so a join keyed on
 * place code drops all of them while leaving California untouched. They carry a
 * large share of the membership. The rest are controls, one per tier of
 * `buildPopulationIndex` and one per branch of `normalizePlaceName`.
 *
 * ⚠ Two kinds of place are **knowingly absent** and must not be added here:
 *
 * - **Territories.** The GeoNames US postal export covers the 50 states and DC
 *   only, so there is no Puerto Rico, Guam or USVI place name to offer as an
 *   origin. Their ZIPs still resolve, from the Census gazetteer, so members
 *   there are located normally — see `ZIP_SPOT_CHECKS` for 00901.
 * - **Unincorporated communities.** The population estimates cover incorporated
 *   places and minor civil divisions, not CDPs, so Bethesda, Silver Spring,
 *   Reston and McLean have no population to test against a threshold — as do the
 *   New York borough names and the Los Angeles neighbourhood names, which are
 *   postal conveniences with no Census entity at all. ZIP entry is the
 *   documented backstop (design §8, §12).
 */
export const CITY_SPOT_CHECKS: ReadonlyArray<{ name: string; state: string; why: string }> = [
  // Town-organised New England: SUMLEV 061, the join trap.
  { name: "Brookline", state: "MA", why: "MA town (SUMLEV 061)" },
  { name: "Lexington", state: "MA", why: "MA town (SUMLEV 061)" },
  { name: "Arlington", state: "MA", why: "MA town (SUMLEV 061)" },
  { name: "Belmont", state: "MA", why: "MA town (SUMLEV 061)" },
  { name: "Needham", state: "MA", why: "MA town (SUMLEV 061)" },
  { name: "Wellesley", state: "MA", why: "MA town (SUMLEV 061)" },
  { name: "Greenwich", state: "CT", why: "CT town (SUMLEV 061)" },
  { name: "Nashua", state: "NH", why: "NH city in a town-organised state" },
  { name: "Scarborough", state: "ME", why: "ME town (SUMLEV 061)" },
  { name: "Westerly", state: "RI", why: "RI town (SUMLEV 061)" },
  { name: "Burlington", state: "VT", why: "VT city in a town-organised state" },
  // Ordinary incorporated places, and the metros the design measured against.
  { name: "Boston", state: "MA", why: "control: large city" },
  { name: "Cambridge", state: "MA", why: "control: large city" },
  { name: "New York", state: "NY", why: "control: largest city" },
  { name: "Palo Alto", state: "CA", why: "control: CA place" },
  // One per branch of the name normalisation and the population index.
  { name: "Saint Louis", state: "MO", why: 'abbreviation: Census writes "St. Louis city"' },
  { name: "Nashville", state: "TN", why: "merged government: Nashville-Davidson (balance)" },
  { name: "Louisville", state: "KY", why: "merged government with a slash: Louisville/Jefferson" },
  { name: "Ventura", state: "CA", why: 'parenthetical alias: "San Buenaventura (Ventura) city"' },
  {
    name: "Honolulu",
    state: "HI",
    why: "county fallback: the place is a CDP, absent from estimates",
  },
  { name: "Arlington", state: "VA", why: "county fallback: Arlington is a county, not a place" },
];

/** Acceptable row-count bands. A table far outside these has a broken source. */
export const ZIP_COUNT_RANGE = { min: 38_000, max: 46_000 } as const;
export const CITY_COUNT_RANGE = { min: 2_600, max: 4_400 } as const;

/** How far a spot-checked ZIP centroid may sit from its expected location. */
const ZIP_TOLERANCE_MILES = 6;

/** Shape and size of the table as a whole: row count, key format, live coordinates. */
function checkZipShape(centroids: ReadonlyMap<string, ZipCentroid>): string[] {
  const problems: string[] = [];
  if (centroids.size < ZIP_COUNT_RANGE.min || centroids.size > ZIP_COUNT_RANGE.max) {
    problems.push(
      `ZIP table has ${centroids.size} rows, outside the expected ${ZIP_COUNT_RANGE.min}–${ZIP_COUNT_RANGE.max} band`,
    );
  }
  // One report per kind of malformation, not one per row: a systematic fault
  // would otherwise print forty thousand lines.
  for (const zip of centroids.keys()) {
    if (!/^\d{5}$/.test(zip)) {
      problems.push(`ZIP table has a malformed key: ${JSON.stringify(zip)}`);
      break;
    }
  }
  for (const [zip, point] of centroids) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
      problems.push(`ZIP ${zip} has a non-finite centroid`);
      break;
    }
    if (point.lat === 0 && point.lon === 0) {
      problems.push(`ZIP ${zip} sits at 0,0 — a failed parse, not a location`);
      break;
    }
  }
  return problems;
}

/** Known ZIPs must land near where they really are. */
function checkZipLocations(centroids: ReadonlyMap<string, ZipCentroid>): string[] {
  const problems: string[] = [];
  for (const check of ZIP_SPOT_CHECKS) {
    const point = centroids.get(check.zip);
    if (point === undefined) {
      problems.push(`ZIP ${check.zip} (${check.where}) is missing from the table`);
      continue;
    }
    const miles = haversineMiles(point, { lat: check.lat, lon: check.lon });
    if (miles > ZIP_TOLERANCE_MILES) {
      problems.push(
        `ZIP ${check.zip} (${check.where}) resolves ${miles.toFixed(1)} mi from where it should, at ${point.lat},${point.lon}`,
      );
    }
  }
  return problems;
}

/** The D172 pairs: near ones must stay near, far ones far. */
function checkZipDistances(centroids: ReadonlyMap<string, ZipCentroid>): string[] {
  const problems: string[] = [];
  for (const check of DISTANCE_SPOT_CHECKS) {
    const from = centroids.get(check.from);
    const to = centroids.get(check.to);
    if (from === undefined || to === undefined) {
      problems.push(`distance check ${check.from}→${check.to}: a ZIP is missing`);
      continue;
    }
    const miles = haversineMiles(from, to);
    if (check.maxMiles !== undefined && miles > check.maxMiles) {
      problems.push(
        `${check.from}→${check.to} is ${miles.toFixed(1)} mi, expected under ${check.maxMiles} (${check.note})`,
      );
    }
    if (check.minMiles !== undefined && miles < check.minMiles) {
      problems.push(
        `${check.from}→${check.to} is ${miles.toFixed(1)} mi, expected over ${check.minMiles} (${check.note})`,
      );
    }
  }
  return problems;
}

/** Check the merged ZIP table. Returns one string per problem; empty means clean. */
export function checkZipTable(centroids: ReadonlyMap<string, ZipCentroid>): string[] {
  return [
    ...checkZipShape(centroids),
    ...checkZipLocations(centroids),
    ...checkZipDistances(centroids),
  ];
}

/** Check the city vocabulary. Returns one string per problem; empty means clean. */
export function checkCityTable(cities: readonly CityRow[]): string[] {
  const problems: string[] = [];

  if (cities.length < CITY_COUNT_RANGE.min || cities.length > CITY_COUNT_RANGE.max) {
    problems.push(
      `city table has ${cities.length} rows, outside the expected ` +
        `${CITY_COUNT_RANGE.min}–${CITY_COUNT_RANGE.max} band`,
    );
  }

  const seen = new Set<string>();
  for (const city of cities) {
    const key = `${city.name.toLowerCase()}|${city.stateCode}`;
    if (seen.has(key)) {
      problems.push(`city table lists ${city.name}, ${city.stateCode} more than once`);
    }
    seen.add(key);
  }

  for (const check of CITY_SPOT_CHECKS) {
    if (!seen.has(`${check.name.toLowerCase()}|${check.state}`)) {
      problems.push(
        `${check.name}, ${check.state} is missing from the city vocabulary — ${check.why}`,
      );
    }
  }

  // The join trap fails in bulk, not one town at a time, so say so plainly when
  // a whole region is thin: a place-code join leaves Massachusetts with only its
  // handful of *cities* (Boston, Cambridge, Worcester…) and none of its towns.
  const massachusetts = cities.filter((city) => city.stateCode === "MA").length;
  if (massachusetts < 60) {
    problems.push(
      `only ${massachusetts} Massachusetts entries — a town-organised state should have far more. This is the SUMLEV 061 join trap (D172); check buildPopulationIndex.`,
    );
  }

  return problems;
}
