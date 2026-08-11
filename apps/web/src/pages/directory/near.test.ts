import type { CityOrigin, GeoPoint } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import {
  type LocatedBrother,
  type NearContext,
  type NearOrigin,
  formatNearToken,
  indexCities,
  nearLabel,
  nearOptions,
  parseNearToken,
  resolveNearPoint,
} from "./near.js";

/** A few real places, so the coordinates in the assertions mean something. */
const BROOKLINE: GeoPoint = { lat: 42.32, lon: -71.13 };
const BOSTON: GeoPoint = { lat: 42.34, lon: -71.02 };
const PORTLAND_OR: GeoPoint = { lat: 45.54, lon: -122.65 };
const PORTLAND_ME: GeoPoint = { lat: 43.66, lon: -70.26 };

const CITIES: CityOrigin[] = [
  { name: "Boston", state: "MA", point: BOSTON },
  { name: "Brookline", state: "MA", point: BROOKLINE },
  { name: "New Boston", state: "TX", point: { lat: 33.46, lon: -94.42 } },
  { name: "Portland", state: "ME", point: PORTLAND_ME },
  { name: "Portland", state: "OR", point: PORTLAND_OR },
  { name: "St. Louis", state: "MO", point: { lat: 38.63, lon: -90.24 } },
];

const CENTROIDS = new Map<string, GeoPoint>([
  ["02138", { lat: 42.38, lon: -71.13 }],
  ["02139", { lat: 42.36, lon: -71.1 }],
  ["02445", BROOKLINE],
  ["94041", { lat: 37.39, lon: -122.08 }],
]);

const BROTHERS = new Map<number, LocatedBrother>([
  [5247, { id: 5247, name: "James Smyth '84", point: BROOKLINE, city: "Brookline", state: "MA" }],
  [5311, { id: 5311, name: "Peter Boston '91", point: PORTLAND_OR, city: "Portland", state: "OR" }],
  [5402, { id: 5402, name: "Alan Ward '77", point: BOSTON }],
]);

const CONTEXT: NearContext = { centroids: CENTROIDS, cities: CITIES, brothers: BROTHERS };
const EMPTY_CONTEXT: NearContext = { centroids: null, cities: null, brothers: new Map() };
const CITY_INDEX = indexCities(CITIES);

describe("the near token round-trips", () => {
  it.each<NearOrigin>([
    { kind: "zip", zip: "02445" },
    { kind: "city", name: "Brookline", state: "MA" },
    { kind: "city", name: "St. Louis", state: "MO" },
    { kind: "brother", id: 5247 },
  ])("survives format → parse: %o", (origin) => {
    expect(parseNearToken(formatNearToken(origin))).toEqual(origin);
  });

  it("uses only URL-unreserved characters, so a shared link stays readable", () => {
    const token = formatNearToken({ kind: "city", name: "Brookline", state: "MA" });
    expect(token).toBe("c~Brookline~MA");
    // RFC 3986 leaves `~` unreserved: encoding it must be a no-op.
    expect(encodeURIComponent("~")).toBe("~");
  });

  it.each([
    ["", "empty"],
    ["Brookline", "no kind prefix"],
    ["z~", "no ZIP"],
    ["z~0244", "a four-digit ZIP — never guess the leading zero"],
    ["z~024455", "six digits"],
    ["z~ABCDE", "letters"],
    ["c~Brookline", "no state"],
    ["c~Brookline~Massachusetts", "an unabbreviated state"],
    ["c~~MA", "no city name"],
    ["b~", "no id"],
    ["b~abc", "a non-numeric id"],
    ["x~5", "an unknown kind"],
  ])("rejects %s (%s)", (raw) => {
    expect(parseNearToken(raw)).toBeUndefined();
  });

  it("rejects null and undefined without throwing (a URL may carry neither)", () => {
    expect(parseNearToken(null)).toBeUndefined();
    expect(parseNearToken(undefined)).toBeUndefined();
  });

  it("normalises a lower-case state so a hand-typed link still resolves", () => {
    expect(parseNearToken("c~Brookline~ma")).toEqual({
      kind: "city",
      name: "Brookline",
      state: "MA",
    });
  });
});

describe("resolveNearPoint", () => {
  it("resolves each of the three kinds", () => {
    expect(resolveNearPoint({ kind: "zip", zip: "02445" }, CONTEXT, CITY_INDEX)).toEqual(BROOKLINE);
    expect(
      resolveNearPoint({ kind: "city", name: "Portland", state: "OR" }, CONTEXT, CITY_INDEX),
    ).toEqual(PORTLAND_OR);
    expect(resolveNearPoint({ kind: "brother", id: 5247 }, CONTEXT, CITY_INDEX)).toEqual(BROOKLINE);
  });

  it("keeps the two Portlands apart — the state is part of the key", () => {
    expect(
      resolveNearPoint({ kind: "city", name: "Portland", state: "ME" }, CONTEXT, CITY_INDEX),
    ).toEqual(PORTLAND_ME);
  });

  it("yields undefined — never a fallback point — for a place that is not there", () => {
    // Each of these would be a *confidently wrong* answer if it fell back to
    // anything: the caller's contract is to leave the view unnarrowed instead.
    expect(resolveNearPoint({ kind: "zip", zip: "99999" }, CONTEXT, CITY_INDEX)).toBeUndefined();
    expect(
      resolveNearPoint({ kind: "city", name: "Sunol", state: "CA" }, CONTEXT, CITY_INDEX),
    ).toBeUndefined();
    // A brother outside this viewer's projection, or one with no shared address.
    expect(resolveNearPoint({ kind: "brother", id: 9999 }, CONTEXT, CITY_INDEX)).toBeUndefined();
  });

  it("yields undefined for every kind before the tables load", () => {
    // The deep-link case: the token is valid, the tables are simply not here yet.
    expect(resolveNearPoint({ kind: "zip", zip: "02445" }, EMPTY_CONTEXT, null)).toBeUndefined();
    expect(
      resolveNearPoint({ kind: "city", name: "Boston", state: "MA" }, EMPTY_CONTEXT, null),
    ).toBeUndefined();
    expect(resolveNearPoint({ kind: "brother", id: 5247 }, EMPTY_CONTEXT, null)).toBeUndefined();
  });
});

describe("nearLabel", () => {
  it("labels a city and a ZIP without needing the tables at all", () => {
    // What a brother following a shared proximity link sees while it loads.
    expect(nearLabel({ kind: "city", name: "Brookline", state: "MA" }, EMPTY_CONTEXT)).toBe(
      "Brookline, MA",
    );
    expect(nearLabel({ kind: "zip", zip: "02445" }, EMPTY_CONTEXT)).toBe("ZIP 02445");
  });

  it("falls back to the id for a brother it cannot name", () => {
    expect(nearLabel({ kind: "brother", id: 5247 }, CONTEXT)).toBe("James Smyth '84");
    expect(nearLabel({ kind: "brother", id: 9999 }, CONTEXT)).toBe("#9999");
  });
});

describe("nearOptions", () => {
  it("offers nothing at all for an empty query", () => {
    // The vocabulary is ~45,000 entries; the head of it is not a useful offer.
    expect(nearOptions("", CONTEXT)).toEqual([]);
    expect(nearOptions("   ", CONTEXT)).toEqual([]);
  });

  it("puts prefix matches ahead of interior ones", () => {
    const labels = nearOptions("boston", CONTEXT).map((o) => o.label);
    expect(labels.indexOf("Boston, MA")).toBeLessThan(labels.indexOf("New Boston, TX"));
  });

  it("matches a city typed with or without its comma", () => {
    expect(nearOptions("brookline, ma", CONTEXT).map((o) => o.label)).toContain("Brookline, MA");
    expect(nearOptions("brookline ma", CONTEXT).map((o) => o.label)).toContain("Brookline, MA");
  });

  it("offers both Portlands as separate rows rather than an ambiguity error", () => {
    const cities = nearOptions("portland", CONTEXT).filter((o) => o.hint === "City");
    expect(cities.map((o) => o.label).sort()).toEqual(["Portland, ME", "Portland, OR"]);
  });

  it("offers ZIPs by prefix once the query is digits", () => {
    const zips = nearOptions("021", CONTEXT).filter((o) => o.hint === "ZIP code");
    expect(zips.map((o) => o.label)).toEqual(["02138", "02139"]);
  });

  it("offers no ZIPs for a query that is not purely digits", () => {
    expect(nearOptions("021ab", CONTEXT).filter((o) => o.hint === "ZIP code")).toEqual([]);
  });

  it("offers brothers by name, hinted with where they are", () => {
    const [option] = nearOptions("smyth", CONTEXT);
    expect(option?.label).toBe("James Smyth '84");
    expect(option?.hint).toBe("Brother · Brookline, MA");
    expect(option?.value).toBe("b~5247");
  });

  it("hints a located brother with no written city as just 'Brother'", () => {
    expect(nearOptions("alan ward", CONTEXT)[0]?.hint).toBe("Brother");
  });

  it("mixes kinds for one query — a city and a brother who share a name", () => {
    const hints = nearOptions("boston", CONTEXT).map((o) => o.hint);
    expect(hints).toContain("City");
    expect(hints.some((h) => h?.startsWith("Brother"))).toBe(true);
  });

  it("caps each kind, so one crowded kind cannot squeeze the others out", () => {
    // 40 cities all matching "spring", and one brother who also does. Without a
    // per-kind budget the brother would be pushed off the end of the list — and
    // `Combobox` renders every match into the DOM, so an uncapped list is also a
    // few thousand nodes on a two-character query.
    const many: CityOrigin[] = Array.from({ length: 40 }, (_, i) => ({
      name: `Springfield ${i}`,
      state: "IL",
      point: { lat: 39.8, lon: -89.65 },
    }));
    const options = nearOptions("spring", {
      centroids: CENTROIDS,
      cities: many,
      brothers: new Map([
        [1, { id: 1, name: "Ed Springer '90", point: BOSTON } satisfies LocatedBrother],
      ]),
    });
    expect(options.filter((o) => o.hint === "City")).toHaveLength(10);
    expect(options.filter((o) => o.hint?.startsWith("Brother"))).toHaveLength(1);
  });

  it("every option's value parses back to an origin the resolver accepts", () => {
    // The contract that keeps the dropdown and the URL in step: a row the user
    // can pick must be a row that resolves.
    for (const option of nearOptions("bo", CONTEXT)) {
      const origin = parseNearToken(option.value);
      expect(origin, option.value).toBeDefined();
      expect(resolveNearPoint(origin as NearOrigin, CONTEXT, CITY_INDEX)).toBeDefined();
    }
  });

  it("returns nothing before the tables load, whatever is typed", () => {
    expect(nearOptions("boston", EMPTY_CONTEXT)).toEqual([]);
    expect(nearOptions("02139", EMPTY_CONTEXT)).toEqual([]);
  });
});

describe("indexCities", () => {
  it("is case-insensitive on both name and state", () => {
    const index = indexCities(CITIES);
    expect(index.get("brookline~ma")?.point).toEqual(BROOKLINE);
  });
});
