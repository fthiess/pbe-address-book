/**
 * Proximity search: the pure half (OFC-378, D172/D175;
 * `docs/initial-build/PROXIMITY-SEARCH-DESIGN.md` is authoritative for the
 * design). Everything here is a pure function over plain data — no React, no
 * fetch, no module state — so the Directory's "Near" filter is exercisable
 * entirely by unit test.
 *
 * The model is deliberately dull (§5). A member is located by the centroid of
 * his **ZIP**, an origin is a point the user picked from a controlled
 * vocabulary, and the filter is a haversine comparison against a radius. There
 * is no index, no k-d tree and no bounding-box prefilter: ~1,200 records against
 * one origin is sub-millisecond, and every structure that would speed it up
 * would also have to be kept correct.
 *
 * Two things are load-bearing and easy to get wrong:
 *
 * ⚠ **ZIP normalisation.** About 59% of real member ZIPs are in ZIP+4 form and
 * some carry trailing whitespace (§8). A lookup that skips either step fails for
 * a *majority* of the roster while working perfectly on hand-picked examples.
 *
 * ⚠ **Country.** A five-digit postal code is not a US ZIP just because it has
 * five digits — 75008 is Paris and 10115 is Berlin, and both collide with real
 * US ZIPs. A member whose country says he is elsewhere is never located, even
 * if his postal code would resolve.
 *
 * ⚠ And the standing one from D172: **ZIP prefixes do not encode proximity.**
 * From 94041, Santa Clara is ~7 miles away and diverges at the second digit,
 * while San Rafael at ~35 miles shares two. Nothing here may be "optimised" into
 * a prefix comparison; `proximity.test.ts` keeps both pairs as guards.
 */

import type { Address } from "./types.js";

/** A coordinate pair in degrees. */
export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
}

/** ZIP code → centroid, as parsed from the generated `zips.csv`. */
export type ZipCentroids = ReadonlyMap<string, GeoPoint>;

/** A city in the origin vocabulary, as parsed from the generated `cities.csv`. */
export interface CityOrigin {
  /** The place name as the source writes it, e.g. "Brookline". */
  readonly name: string;
  /** Two-letter state or territory code, e.g. "MA". */
  readonly state: string;
  readonly point: GeoPoint;
}

/** The radii offered by the Near control (D172 decision 4). */
export const RADIUS_OPTIONS = [25, 50, 100] as const;

/** One of the offered radii, in miles. */
export type RadiusMiles = (typeof RADIUS_OPTIONS)[number];

/** The radius a Near filter starts at (D172 decision 4). */
export const DEFAULT_RADIUS_MILES: RadiusMiles = 50;

/** True if `value` is one of the offered radii — for validating a URL parameter. */
export function isRadiusMiles(value: unknown): value is RadiusMiles {
  return typeof value === "number" && (RADIUS_OPTIONS as readonly number[]).includes(value);
}

/**
 * Reduce a written postal code to the five-digit ZIP the tables are keyed on, or
 * `undefined` if it is not a US ZIP at all.
 *
 * Accepts `02139`, `02139-4307`, `021394307` and any of them padded with
 * whitespace; rejects a four-digit value rather than guessing a leading zero,
 * because an invented ZIP resolves to a real and wrong place.
 */
export function normalizeZip(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const compact = raw.replace(/\s+/g, "");
  const match = /^(\d{5})(?:-?\d{0,4})?$/.exec(compact);
  return match?.[1];
}

/**
 * Whether a member's address is eligible for US proximity search at all.
 *
 * An **absent** country is treated as eligible: the country field is optional
 * and a blank one is far more likely to be an unfilled US record than a foreign
 * one, and the postal code still has to look like a ZIP and resolve. An
 * explicitly non-US country is not, whatever the postal code looks like.
 */
export function isUsAddress(address: Address | undefined): boolean {
  const country = address?.country?.trim().toUpperCase();
  return country === undefined || country === "" || country === "US";
}

/**
 * Locate a member: his ZIP's centroid, or `undefined` when he has no address, no
 * usable ZIP, a non-US country, or a ZIP absent from the table.
 */
export function memberPoint(
  centroids: ZipCentroids,
  address: Address | undefined,
): GeoPoint | undefined {
  if (!isUsAddress(address)) {
    return undefined;
  }
  const zip = normalizeZip(address?.postalCode);
  return zip === undefined ? undefined : centroids.get(zip);
}

/** Mean radius of the Earth in miles (IUGG), the usual constant for haversine. */
const EARTH_RADIUS_MILES = 3958.7613;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in miles. Haversine rather than the equirectangular
 * approximation: at a 100-mile radius the cheap version is off by enough to
 * matter at high latitudes, and this costs nothing at roster scale.
 */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  // `min(1, …)` guards the floating-point case where a point compared with
  // itself yields a hair over 1 and `asin` returns NaN.
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True if `target` is within `radiusMiles` of `origin`, inclusive of the boundary. */
export function isWithinRadius(origin: GeoPoint, target: GeoPoint, radiusMiles: number): boolean {
  return haversineMiles(origin, target) <= radiusMiles;
}

/**
 * Build the predicate the Directory filter chain applies to each member.
 *
 * Closes over the table and the origin so the per-row cost is one `Map` lookup
 * and one haversine. A member who cannot be located is **excluded** — proximity
 * is a narrowing filter, and "we don't know where he is" is not "he is nearby".
 */
export function makeProximityPredicate(
  centroids: ZipCentroids,
  origin: GeoPoint,
  radiusMiles: number,
): (address: Address | undefined) => boolean {
  return (address) => {
    const point = memberPoint(centroids, address);
    return point !== undefined && isWithinRadius(origin, point, radiusMiles);
  };
}

/**
 * Iterate the data rows of a generated table: comment lines (`#`, the provenance
 * block) and the column header are skipped, and so is any blank line. The
 * generator asserts that no field needs quoting, which is what lets this be a
 * `split(",")` rather than a CSV parser.
 */
function* dataRows(text: string): Generator<string[]> {
  let headerSeen = false;
  for (const line of text.split("\n")) {
    const row = line.trim();
    if (row === "" || row.startsWith("#")) {
      continue;
    }
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }
    yield row.split(",");
  }
}

/** Parse a coordinate field; `undefined` for anything that is not a finite number. */
function coordinate(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Parse the generated `zips.csv` into a lookup table. Malformed rows are skipped
 * rather than thrown on: a partially-fetched table should degrade to a smaller
 * one, not break the Directory.
 */
export function parseZipTable(text: string): ZipCentroids {
  const centroids = new Map<string, GeoPoint>();
  for (const [zip, lat, lon] of dataRows(text)) {
    const key = zip?.trim();
    const latitude = coordinate(lat);
    const longitude = coordinate(lon);
    if (
      key === undefined ||
      !/^\d{5}$/.test(key) ||
      latitude === undefined ||
      longitude === undefined
    ) {
      continue;
    }
    centroids.set(key, { lat: latitude, lon: longitude });
  }
  return centroids;
}

/** Parse the generated `cities.csv` into the origin vocabulary, order preserved. */
export function parseCityTable(text: string): CityOrigin[] {
  const cities: CityOrigin[] = [];
  for (const [name, state, lat, lon] of dataRows(text)) {
    const cityName = name?.trim();
    const stateCode = state?.trim().toUpperCase();
    const latitude = coordinate(lat);
    const longitude = coordinate(lon);
    if (
      cityName === undefined ||
      cityName === "" ||
      stateCode === undefined ||
      !/^[A-Z]{2}$/.test(stateCode) ||
      latitude === undefined ||
      longitude === undefined
    ) {
      continue;
    }
    cities.push({ name: cityName, state: stateCode, point: { lat: latitude, lon: longitude } });
  }
  return cities;
}
