import { describe, expect, it } from "vitest";

import {
  DEFAULT_RADIUS_MILES,
  RADIUS_OPTIONS,
  haversineMiles,
  isRadiusMiles,
  isUsAddress,
  isWithinRadius,
  makeProximityPredicate,
  memberPoint,
  normalizeZip,
  parseCityTable,
  parseZipTable,
} from "./proximity.js";
import type { Address } from "./types.js";

/** A handful of real centroids, at the precision the generated table carries. */
const CAMBRIDGE_MA = { lat: 42.36, lon: -71.1 };
const BROOKLINE_MA = { lat: 42.33, lon: -71.13 };
const MOUNTAIN_VIEW_CA = { lat: 37.39, lon: -122.08 };
const SANTA_CLARA_CA = { lat: 37.35, lon: -121.95 };
const SAN_RAFAEL_CA = { lat: 37.97, lon: -122.53 };
const NEW_YORK_NY = { lat: 40.75, lon: -73.99 };
const ST_LOUIS_MO = { lat: 38.63, lon: -90.19 };
const EAST_ST_LOUIS_IL = { lat: 38.62, lon: -90.13 };

const TABLE = new Map([
  ["02139", CAMBRIDGE_MA],
  ["02445", BROOKLINE_MA],
  ["94041", MOUNTAIN_VIEW_CA],
  ["95050", SANTA_CLARA_CA],
  ["94901", SAN_RAFAEL_CA],
  ["10001", NEW_YORK_NY],
]);

describe("normalizeZip", () => {
  it("passes a plain five-digit ZIP through", () => {
    expect(normalizeZip("02139")).toBe("02139");
  });

  // §8: about 59% of real member ZIPs are ZIP+4 and some carry trailing
  // whitespace, so skipping either step fails for a majority of the roster.
  it("truncates ZIP+4, with or without the separator", () => {
    expect(normalizeZip("02139-4307")).toBe("02139");
    expect(normalizeZip("021394307")).toBe("02139");
    expect(normalizeZip("02139-")).toBe("02139");
  });

  it("trims surrounding and embedded whitespace", () => {
    expect(normalizeZip("  02139  ")).toBe("02139");
    expect(normalizeZip("02139\t")).toBe("02139");
    expect(normalizeZip("02139 4307")).toBe("02139");
  });

  it("rejects anything that is not a US ZIP", () => {
    expect(normalizeZip("2139")).toBeUndefined();
    expect(normalizeZip("M5V 3A8")).toBeUndefined();
    expect(normalizeZip("SW1A 1AA")).toBeUndefined();
    expect(normalizeZip("")).toBeUndefined();
    expect(normalizeZip("   ")).toBeUndefined();
    expect(normalizeZip(undefined)).toBeUndefined();
    expect(normalizeZip(null)).toBeUndefined();
    expect(normalizeZip(12_139 as unknown as string)).toBeUndefined();
  });

  it("does not invent a leading zero for a four-digit value", () => {
    // "2139" could be a mangled 02139 — but it could also be a typo, and an
    // invented ZIP resolves to a real and wrong place.
    expect(normalizeZip("2139")).toBeUndefined();
  });
});

describe("isUsAddress", () => {
  it("treats an absent or blank country as eligible", () => {
    expect(isUsAddress(undefined)).toBe(true);
    expect(isUsAddress({})).toBe(true);
    expect(isUsAddress({ country: "" })).toBe(true);
    expect(isUsAddress({ country: "  " })).toBe(true);
  });

  it("accepts US in any case, with padding", () => {
    expect(isUsAddress({ country: "US" })).toBe(true);
    expect(isUsAddress({ country: " us " })).toBe(true);
  });

  it("rejects an explicitly foreign country", () => {
    expect(isUsAddress({ country: "CA" })).toBe(false);
    expect(isUsAddress({ country: "GB" })).toBe(false);
  });
});

describe("memberPoint", () => {
  it("locates a member from a ZIP+4 with trailing whitespace", () => {
    const address: Address = { postalCode: "02139-4307   ", country: "US" };
    expect(memberPoint(TABLE, address)).toEqual(CAMBRIDGE_MA);
  });

  it("locates a member whose country is unset", () => {
    expect(memberPoint(TABLE, { postalCode: "02139" })).toEqual(CAMBRIDGE_MA);
  });

  // 75008 is Paris and 10001 is a real Manhattan ZIP; a five-digit postal code
  // is not a ZIP just because it has five digits.
  it("never locates a member with a non-US country, however ZIP-like the code", () => {
    expect(memberPoint(TABLE, { postalCode: "10001", country: "FR" })).toBeUndefined();
    expect(memberPoint(TABLE, { postalCode: "10001", country: "DE" })).toBeUndefined();
  });

  it("returns undefined for a missing address, a missing ZIP, or an unknown ZIP", () => {
    expect(memberPoint(TABLE, undefined)).toBeUndefined();
    expect(memberPoint(TABLE, { city: "Cambridge" })).toBeUndefined();
    expect(memberPoint(TABLE, { postalCode: "99999" })).toBeUndefined();
  });
});

describe("haversineMiles", () => {
  it("is zero for a point against itself", () => {
    expect(haversineMiles(CAMBRIDGE_MA, CAMBRIDGE_MA)).toBe(0);
  });

  it("is symmetric", () => {
    expect(haversineMiles(CAMBRIDGE_MA, NEW_YORK_NY)).toBeCloseTo(
      haversineMiles(NEW_YORK_NY, CAMBRIDGE_MA),
      9,
    );
  });

  it("reproduces known distances", () => {
    // Boston–New York is about 190 miles great-circle.
    expect(haversineMiles(CAMBRIDGE_MA, NEW_YORK_NY)).toBeGreaterThan(180);
    expect(haversineMiles(CAMBRIDGE_MA, NEW_YORK_NY)).toBeLessThan(200);
    // Cambridge–Brookline is a few miles.
    expect(haversineMiles(CAMBRIDGE_MA, BROOKLINE_MA)).toBeLessThan(5);
  });
});

/**
 * D172's first landmine, kept as a standing guard: **ZIP prefixes do not encode
 * proximity.** These two assertions are the counter-example — the near pair
 * shares *fewer* leading digits than the far pair, so any "optimisation" that
 * compares prefixes instead of coordinates fails here rather than in production.
 */
describe("ZIP prefixes are not a proximity signal (D172)", () => {
  const sharedPrefix = (a: string, b: string): number => {
    let shared = 0;
    while (shared < a.length && a[shared] === b[shared]) {
      shared++;
    }
    return shared;
  };

  it("Mountain View → Santa Clara is close but diverges at the second digit", () => {
    expect(haversineMiles(MOUNTAIN_VIEW_CA, SANTA_CLARA_CA)).toBeLessThan(15);
    expect(sharedPrefix("94041", "95050")).toBe(1);
  });

  it("Mountain View → San Rafael is far but shares two digits", () => {
    expect(haversineMiles(MOUNTAIN_VIEW_CA, SAN_RAFAEL_CA)).toBeGreaterThan(25);
    expect(sharedPrefix("94041", "94901")).toBe(2);
  });

  it("St Louis MO → East St Louis IL is three miles across a state line", () => {
    expect(haversineMiles(ST_LOUIS_MO, EAST_ST_LOUIS_IL)).toBeLessThan(10);
    expect(sharedPrefix("63101", "62201")).toBe(1);
  });
});

describe("isWithinRadius", () => {
  it("includes the boundary", () => {
    const miles = haversineMiles(MOUNTAIN_VIEW_CA, SANTA_CLARA_CA);
    expect(isWithinRadius(MOUNTAIN_VIEW_CA, SANTA_CLARA_CA, miles)).toBe(true);
    expect(isWithinRadius(MOUNTAIN_VIEW_CA, SANTA_CLARA_CA, miles - 0.001)).toBe(false);
  });

  it("separates the Bay Area pairs at a 25-mile radius", () => {
    expect(isWithinRadius(MOUNTAIN_VIEW_CA, SANTA_CLARA_CA, 25)).toBe(true);
    expect(isWithinRadius(MOUNTAIN_VIEW_CA, SAN_RAFAEL_CA, 25)).toBe(false);
  });
});

describe("makeProximityPredicate", () => {
  const nearMountainView = makeProximityPredicate(TABLE, MOUNTAIN_VIEW_CA, 25);

  it("keeps a member inside the radius", () => {
    expect(nearMountainView({ postalCode: "95050", country: "US" })).toBe(true);
  });

  it("drops a member outside it", () => {
    expect(nearMountainView({ postalCode: "94901", country: "US" })).toBe(false);
  });

  // Proximity narrows; "we don't know where he is" is not "he is nearby".
  it("drops a member who cannot be located at all", () => {
    expect(nearMountainView(undefined)).toBe(false);
    expect(nearMountainView({ city: "Mountain View" })).toBe(false);
    expect(nearMountainView({ postalCode: "99999" })).toBe(false);
    expect(nearMountainView({ postalCode: "95050", country: "CA" })).toBe(false);
  });

  it("honours ZIP normalisation through the predicate", () => {
    expect(nearMountainView({ postalCode: " 95050-1234 " })).toBe(true);
  });
});

describe("radius options", () => {
  it("offers 25 / 50 / 100 and defaults to 50 (D172 decision 4)", () => {
    expect(RADIUS_OPTIONS).toEqual([25, 50, 100]);
    expect(DEFAULT_RADIUS_MILES).toBe(50);
  });

  it("validates a value arriving from a URL", () => {
    expect(isRadiusMiles(50)).toBe(true);
    expect(isRadiusMiles(30)).toBe(false);
    expect(isRadiusMiles("50")).toBe(false);
    expect(isRadiusMiles(undefined)).toBe(false);
  });
});

describe("parseZipTable", () => {
  const TEXT = [
    "# PBE Book proximity tables — generated by tools/geo-data",
    "# rows: 3",
    "zip,lat,lon",
    "02139,42.36,-71.1",
    "94041,37.39,-122.08",
    "",
    "00501,40.82,-73.05",
    "",
  ].join("\n");

  it("skips the provenance comments, the header and blank lines", () => {
    const table = parseZipTable(TEXT);
    expect(table.size).toBe(3);
    expect(table.get("02139")).toEqual({ lat: 42.36, lon: -71.1 });
    expect(table.get("00501")).toEqual({ lat: 40.82, lon: -73.05 });
  });

  it("skips malformed rows rather than throwing", () => {
    const table = parseZipTable(
      ["zip,lat,lon", "02139,42.36,-71.1", "bogus,1,2", "12345,notanumber,-71", "9999,1,2"].join(
        "\n",
      ),
    );
    expect([...table.keys()]).toEqual(["02139"]);
  });

  it("tolerates CRLF line endings", () => {
    const table = parseZipTable("# note\r\nzip,lat,lon\r\n02139,42.36,-71.1\r\n");
    expect(table.get("02139")).toEqual({ lat: 42.36, lon: -71.1 });
  });
});

describe("parseCityTable", () => {
  const TEXT = [
    "# generated",
    "city,state,lat,lon",
    "Brookline,MA,42.33,-71.13",
    "Mountain View,CA,37.39,-122.08",
    "Bogus,XYZ,1,2",
    ",MA,1,2",
  ].join("\n");

  it("parses the vocabulary in file order and drops malformed rows", () => {
    const cities = parseCityTable(TEXT);
    expect(cities).toEqual([
      { name: "Brookline", state: "MA", point: { lat: 42.33, lon: -71.13 } },
      { name: "Mountain View", state: "CA", point: { lat: 37.39, lon: -122.08 } },
    ]);
  });
});
