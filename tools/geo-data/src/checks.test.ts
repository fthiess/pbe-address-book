import { describe, expect, it } from "vitest";

import { CITY_SPOT_CHECKS, ZIP_SPOT_CHECKS, checkCityTable, checkZipTable } from "./checks.js";
import type { CityRow, ZipCentroid } from "./tables.js";

/**
 * A synthetic table that passes: every spot-checked ZIP at its expected point,
 * padded out to the expected row count with plausible filler.
 */
function healthyZipTable(): Map<string, ZipCentroid> {
  const centroids = new Map<string, ZipCentroid>();
  for (const check of ZIP_SPOT_CHECKS) {
    centroids.set(check.zip, { lat: check.lat, lon: check.lon, source: "census" });
  }
  // The distance spot-checks reach for these four as well.
  const extras: Array<[string, number, number]> = [
    ["95050", 37.35, -121.95],
    ["94901", 37.97, -122.53],
    ["63101", 38.63, -90.19],
    ["62201", 38.62, -90.13],
  ];
  for (const [zip, lat, lon] of extras) {
    centroids.set(zip, { lat, lon, source: "census" });
  }
  for (let index = 0; centroids.size < 39_000; index++) {
    const zip = String(index).padStart(5, "0");
    if (!centroids.has(zip)) {
      centroids.set(zip, { lat: 40 + (index % 100) / 100, lon: -100, source: "geonames" });
    }
  }
  return centroids;
}

/** A synthetic vocabulary that passes, padded to the expected row count. */
function healthyCityTable(): CityRow[] {
  const cities: CityRow[] = CITY_SPOT_CHECKS.map((check) => ({
    name: check.name,
    stateCode: check.state,
    lat: 42,
    lon: -71,
    population: 20_000,
  }));
  // Enough Massachusetts entries to clear the "town-organised state" floor, then
  // filler to reach the expected total.
  for (let index = 0; index < 100; index++) {
    cities.push({ name: `MaTown${index}`, stateCode: "MA", lat: 42, lon: -71, population: 12_000 });
  }
  for (let index = cities.length; index < 2_700; index++) {
    cities.push({ name: `Filler${index}`, stateCode: "TX", lat: 31, lon: -99, population: 11_000 });
  }
  return cities;
}

describe("checkZipTable", () => {
  it("passes a healthy table", () => {
    expect(checkZipTable(healthyZipTable())).toEqual([]);
  });

  it("catches a table far outside the expected size", () => {
    const problems = checkZipTable(
      new Map([["02139", { lat: 42.36, lon: -71.1, source: "census" }]]),
    );
    expect(problems.some((problem) => problem.includes("outside the expected"))).toBe(true);
  });

  // Swapping latitude and longitude is the classic column mistake, and it
  // produces a perfectly well-formed table.
  it("catches transposed coordinates", () => {
    const centroids = healthyZipTable();
    for (const [zip, point] of centroids) {
      centroids.set(zip, { lat: point.lon, lon: point.lat, source: point.source });
    }
    expect(checkZipTable(centroids).length).toBeGreaterThan(0);
  });

  it("catches a 0,0 centroid", () => {
    const centroids = healthyZipTable();
    centroids.set("02139", { lat: 0, lon: 0, source: "census" });
    expect(checkZipTable(centroids).some((problem) => problem.includes("0,0"))).toBe(true);
  });

  it("catches centroids that break the D172 distance relationships", () => {
    const centroids = healthyZipTable();
    // Move San Rafael on top of Mountain View: the "far" pair stops being far.
    centroids.set("94901", { lat: 37.39, lon: -122.08, source: "census" });
    expect(checkZipTable(centroids).some((problem) => problem.includes("94041→94901"))).toBe(true);
  });
});

describe("checkCityTable", () => {
  it("passes a healthy vocabulary", () => {
    expect(checkCityTable(healthyCityTable())).toEqual([]);
  });

  /**
   * ⚠ **This is the test that matters.** It reproduces the D172 join trap — a
   * population join keyed on Census *place* code, which drops every town in a
   * town-organised state — and asserts the build refuses it. Without this, the
   * spot-check list is decoration: it would sit in the source looking like a
   * guard while never having been shown to fail.
   */
  it("refuses a vocabulary with New England's towns missing (the join trap)", () => {
    const newEnglandTowns = new Set(
      CITY_SPOT_CHECKS.filter((check) => check.why.includes("SUMLEV 061")).map(
        (check) => `${check.name}|${check.state}`,
      ),
    );
    expect(newEnglandTowns.size).toBeGreaterThan(5);

    const gutted = healthyCityTable().filter(
      (city) => !newEnglandTowns.has(`${city.name}|${city.stateCode}`),
    );
    const problems = checkCityTable(gutted);
    expect(problems.length).toBeGreaterThanOrEqual(newEnglandTowns.size);
    expect(problems.some((problem) => problem.includes("Brookline, MA is missing"))).toBe(true);
  });

  it("names the join trap when a whole town-organised state goes thin", () => {
    const withoutMassachusetts = healthyCityTable().filter((city) => city.stateCode !== "MA");
    expect(
      checkCityTable(withoutMassachusetts).some((problem) =>
        problem.includes("SUMLEV 061 join trap"),
      ),
    ).toBe(true);
  });

  it("catches a duplicated entry", () => {
    const cities = healthyCityTable();
    const first = cities[0] as CityRow;
    cities.push({ ...first });
    expect(checkCityTable(cities).some((problem) => problem.includes("more than once"))).toBe(true);
  });
});
