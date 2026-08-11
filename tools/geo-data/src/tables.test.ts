import { describe, expect, it } from "vitest";

import type { GazetteerRow, GeoNamesRow, PopulationRow } from "./sources.js";
import {
  alternatePlaceNames,
  assertEmittable,
  buildCityVocabulary,
  buildPopulationIndex,
  formatCityCsv,
  formatZipCsv,
  isEmittableField,
  mergeZipCentroids,
  normalizePlaceName,
  populationKey,
  round,
} from "./tables.js";

const geoNamesRow = (
  zip: string,
  place: string,
  stateCode: string,
  stateName: string,
  lat: number,
  lon: number,
): GeoNamesRow => ({ zip, place, stateCode, stateName, lat, lon });

const populationRow = (
  sumlev: string,
  name: string,
  stateName: string,
  population: number,
): PopulationRow => ({ sumlev, name, stateName, population });

describe("round", () => {
  it("keeps two decimal places and normalises negative zero", () => {
    expect(round(42.363152)).toBe(42.36);
    expect(round(-71.101661)).toBe(-71.1);
    expect(round(-0.001)).toBe(0);
    expect(Object.is(round(-0.001), -0)).toBe(false);
  });
});

describe("mergeZipCentroids", () => {
  const gazetteer: GazetteerRow[] = [{ zcta: "02139", lat: 42.363152, lon: -71.101661 }];
  const geonames = [
    // Same ZIP as the gazetteer, deliberately different coordinates.
    geoNamesRow("02139", "Cambridge", "MA", "Massachusetts", 40, -70),
    // A PO-box ZIP with no ZCTA — the gap GeoNames exists to fill.
    geoNamesRow("02241", "Boston", "MA", "Massachusetts", 42.35, -71.06),
    geoNamesRow("02241", "Boston Alt", "MA", "Massachusetts", 1, 1),
  ];

  it("prefers the Census centroid where one exists", () => {
    const merged = mergeZipCentroids(gazetteer, geonames);
    expect(merged.get("02139")).toEqual({ lat: 42.36, lon: -71.1, source: "census" });
  });

  it("fills ZIPs with no ZCTA from GeoNames, first row winning", () => {
    const merged = mergeZipCentroids(gazetteer, geonames);
    expect(merged.get("02241")).toEqual({ lat: 42.35, lon: -71.06, source: "geonames" });
  });
});

describe("normalizePlaceName", () => {
  it("strips the Census entity-type word", () => {
    expect(normalizePlaceName("Brookline town")).toBe("brookline");
    expect(normalizePlaceName("Boston city")).toBe("boston");
    expect(normalizePlaceName("Bethesda CDP")).toBe("bethesda");
    expect(normalizePlaceName("Scio township")).toBe("scio");
  });

  it("strips repeated entity words and parenthetical qualifiers", () => {
    expect(normalizePlaceName("Lexington-Fayette urban county")).toBe("lexington fayette");
    expect(normalizePlaceName("Butte-Silver Bow (balance)")).toBe("butte silver bow");
  });

  it("expands the abbreviations the two sources spell differently", () => {
    expect(normalizePlaceName("St. Louis city")).toBe("saint louis");
    expect(normalizePlaceName("Saint Louis")).toBe("saint louis");
    expect(normalizePlaceName("Mt. Vernon city")).toBe("mount vernon");
    expect(normalizePlaceName("Ft. Worth city")).toBe("fort worth");
  });

  it("folds diacritics and case", () => {
    expect(normalizePlaceName("La Cañada Flintridge city")).toBe("la canada flintridge");
    expect(normalizePlaceName("Española city")).toBe("espanola");
  });

  it("leaves an ordinary hyphenated name intact apart from the separator", () => {
    expect(normalizePlaceName("Winston-Salem city")).toBe("winston salem");
  });
});

describe("alternatePlaceNames", () => {
  it("takes the leading name of a merged jurisdiction", () => {
    expect(alternatePlaceNames("Louisville/Jefferson County metro government (balance)")).toContain(
      "louisville",
    );
    expect(alternatePlaceNames("Lexington-Fayette urban county")).toContain("lexington");
    expect(alternatePlaceNames("Macon-Bibb County")).toContain("macon");
    expect(alternatePlaceNames("Butte-Silver Bow (balance)")).toContain("butte");
  });

  it("takes a parenthetical alias but not a qualifier", () => {
    expect(alternatePlaceNames("San Buenaventura (Ventura) city")).toEqual(["ventura"]);
    expect(alternatePlaceNames("Athens-Clarke County unified government (balance)")).toEqual([
      "athens",
    ]);
  });

  // The guard that keeps ordinary hyphenated cities out of the alias tier: a
  // "winston" alias would quietly hand Winston-Salem's population to any place
  // called Winston in the same state.
  it("leaves an ordinary hyphenated name alone", () => {
    expect(alternatePlaceNames("Winston-Salem city")).toEqual([]);
    expect(alternatePlaceNames("Wilkes-Barre city")).toEqual([]);
  });
});

describe("buildPopulationIndex", () => {
  /**
   * ⚠ The join trap in miniature (D172, design §4). A Massachusetts town is a
   * **county subdivision**, SUMLEV 061 — if the index reads only place rows,
   * every one of these disappears while California is untouched.
   */
  it("indexes town-organised New England from SUMLEV 061", () => {
    const index = buildPopulationIndex([
      populationRow("061", "Brookline town", "Massachusetts", 63_925),
      populationRow("061", "Lexington town", "Massachusetts", 34_000),
      populationRow("162", "Palo Alto city", "California", 68_000),
    ]);
    expect(index.get(populationKey("Massachusetts", "Brookline"))).toBe(63_925);
    expect(index.get(populationKey("Massachusetts", "Lexington"))).toBe(34_000);
    expect(index.get(populationKey("California", "Palo Alto"))).toBe(68_000);
  });

  it("takes the largest population when rows collide", () => {
    const index = buildPopulationIndex([
      populationRow("162", "Springfield city", "Ohio", 58_000),
      populationRow("157", "Springfield city", "Ohio", 59_500),
    ]);
    expect(index.get(populationKey("Ohio", "Springfield"))).toBe(59_500);
  });

  it("adds an alias only where no real place claims the name", () => {
    const index = buildPopulationIndex([
      populationRow(
        "162",
        "Nashville-Davidson metropolitan government (balance)",
        "Tennessee",
        704_963,
      ),
      populationRow("162", "Athens city", "Tennessee", 14_000),
      populationRow("162", "Athens-Clarke County unified government (balance)", "Georgia", 128_691),
    ]);
    expect(index.get(populationKey("Tennessee", "Nashville"))).toBe(704_963);
    // The real Athens, TN keeps its own number; the Georgia alias stands alone.
    expect(index.get(populationKey("Tennessee", "Athens"))).toBe(14_000);
    expect(index.get(populationKey("Georgia", "Athens"))).toBe(128_691);
  });

  it("falls back to a county only for a name no place already carries", () => {
    const index = buildPopulationIndex([
      populationRow("162", "Urban Honolulu CDP", "Hawaii", 344_967),
      populationRow("050", "Honolulu County", "Hawaii", 998_747),
      populationRow("162", "Arlington city", "Texas", 400_000),
      populationRow("050", "Arlington County", "Virginia", 240_000),
    ]);
    expect(index.get(populationKey("Hawaii", "Honolulu"))).toBe(998_747);
    expect(index.get(populationKey("Virginia", "Arlington"))).toBe(240_000);
    expect(index.get(populationKey("Texas", "Arlington"))).toBe(400_000);
  });
});

describe("buildCityVocabulary", () => {
  const geonames = [
    geoNamesRow("02445", "Brookline", "MA", "Massachusetts", 42.33, -71.13),
    geoNamesRow("02446", "Brookline", "MA", "Massachusetts", 42.35, -71.12),
    geoNamesRow("02494", "Needham Heights", "MA", "Massachusetts", 42.3, -71.23),
    geoNamesRow("59701", "Butte", "MT", "Montana", 46.0, -112.53),
  ];
  const centroids = mergeZipCentroids([], geonames);
  const populations = buildPopulationIndex([
    populationRow("061", "Brookline town", "Massachusetts", 63_925),
    populationRow("162", "Butte-Silver Bow (balance)", "Montana", 35_480),
    populationRow("061", "Needham town", "Massachusetts", 32_000),
  ]);

  it("places a city at the mean of its own ZIP centroids", () => {
    const cities = buildCityVocabulary(geonames, centroids, populations, 10_000);
    expect(cities.find((city) => city.name === "Brookline")).toEqual({
      name: "Brookline",
      stateCode: "MA",
      lat: 42.34,
      // (-71.13 + -71.12) / 2 = -71.125, and `Math.round` breaks the tie
      // upward — immaterial at a 1.1 km quantisation, pinned so it is a
      // decision rather than a surprise.
      lon: -71.12,
      population: 63_925,
    });
  });

  it("resolves a place through its alias", () => {
    const cities = buildCityVocabulary(geonames, centroids, populations, 10_000);
    expect(cities.map((city) => city.name)).toContain("Butte");
  });

  // A postal-station name has no Census entity of its own, so it drops out and
  // the user finds the municipality instead — the intended behaviour, not a gap.
  it("drops a postal-station name with no population match", () => {
    const cities = buildCityVocabulary(geonames, centroids, populations, 10_000);
    expect(cities.map((city) => city.name)).not.toContain("Needham Heights");
  });

  it("applies the population threshold", () => {
    const cities = buildCityVocabulary(geonames, centroids, populations, 50_000);
    expect(cities.map((city) => city.name)).toEqual(["Brookline"]);
  });

  it("sorts by name then state", () => {
    const cities = buildCityVocabulary(geonames, centroids, populations, 10_000);
    expect(cities.map((city) => city.name)).toEqual(["Brookline", "Butte"]);
  });
});

describe("CSV emission", () => {
  it("emits the provenance block, a header row, and sorted data", () => {
    const centroids = mergeZipCentroids(
      [
        { zcta: "94041", lat: 37.39, lon: -122.08 },
        { zcta: "02139", lat: 42.36, lon: -71.1 },
      ],
      [],
    );
    expect(formatZipCsv(centroids, ["generated by a test", "rows: 2"])).toBe(
      "# generated by a test\n# rows: 2\nzip,lat,lon\n02139,42.36,-71.1\n94041,37.39,-122.08\n",
    );
  });

  it("emits the city table with its state column", () => {
    const csv = formatCityCsv(
      [{ name: "Brookline", stateCode: "MA", lat: 42.34, lon: -71.13, population: 63_925 }],
      ["generated by a test"],
    );
    expect(csv).toBe("# generated by a test\ncity,state,lat,lon\nBrookline,MA,42.34,-71.13\n");
  });

  // The browser-side parser is a `split(",")` by design (D172: flat CSV, no
  // decoder to test), so a name that would need quoting has to fail here.
  it("refuses a name the unquoted format cannot carry", () => {
    expect(isEmittableField("Brookline")).toBe(true);
    expect(isEmittableField("Winchester town, city of")).toBe(false);
    expect(() =>
      assertEmittable([
        { name: "Winchester, city of", stateCode: "MA", lat: 1, lon: 2, population: 20_000 },
      ]),
    ).toThrow(/unrepresentable/);
  });
});
