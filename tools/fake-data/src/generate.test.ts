import { readFileSync } from "node:fs";
import {
  COURSE_FAMILIES,
  type GeoPoint,
  MAJOR_CODES,
  courseFamily,
  haversineMiles,
  isUsAddress,
  parseCityTable,
  parseZipTable,
  resolveCanonicalNames,
  validateProfile,
} from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { PLACES } from "./fixtures.js";
import {
  COLLISION_COUNT,
  COLLISION_IDENTITY,
  DEFAULT_COUNT,
  FAKE_ID_FLOOR,
  FAKE_MAJOR_CODES,
  generateProfiles,
} from "./generate.js";

const VALID_MAJORS = new Set(FAKE_MAJOR_CODES);

// Every code the generator emits must exist in the shared course vocabulary, so
// the Course filter and chips can always resolve a display name (no bare orphan).
describe("course vocabulary coverage", () => {
  it("every generated course code has a name in the shared vocabulary", () => {
    const known = new Set(MAJOR_CODES);
    for (const code of FAKE_MAJOR_CODES) {
      expect(known.has(code)).toBe(true);
    }
  });

  // Staging is where the chip palette gets looked at, and staging reseeds from
  // this generator on every deploy (N18/N90). If a default-sized dataset misses
  // a family, that family's colour is unreviewable — so assert coverage rather
  // than trusting that uniform sampling got there (D165/OFC-320).
  it("a default-sized dataset exercises all 25 chip colour families", () => {
    const profiles = generateProfiles({ count: DEFAULT_COUNT, seed: 7 });
    const seen = new Set(profiles.flatMap((p) => p.majors ?? []).map(courseFamily));
    expect([...seen].sort()).toEqual([...COURSE_FAMILIES].sort());
  });
});

describe("generateProfiles", () => {
  it("is deterministic for a given seed", () => {
    const a = generateProfiles({ count: 200, seed: 123 });
    const b = generateProfiles({ count: 200, seed: 123 });
    expect(a).toEqual(b);
  });

  it("varies with the seed", () => {
    const a = generateProfiles({ count: 50, seed: 1 });
    const b = generateProfiles({ count: 50, seed: 2 });
    expect(a).not.toEqual(b);
  });

  it("produces the requested count, defaulting within D65's 600–2000 range", () => {
    expect(generateProfiles({ count: 700 })).toHaveLength(700);
    const defaults = generateProfiles();
    expect(defaults).toHaveLength(DEFAULT_COUNT);
    expect(defaults.length).toBeGreaterThanOrEqual(600);
    expect(defaults.length).toBeLessThanOrEqual(2000);
  });

  it("emits only obviously-fake data: ids > 5000, unique ids, example.test emails", () => {
    const profiles = generateProfiles({ count: 500, seed: 7 });
    const ids = new Set<number>();
    for (const profile of profiles) {
      expect(profile.id).toBeGreaterThanOrEqual(FAKE_ID_FLOOR);
      expect(profile.id).toBeGreaterThan(5000);
      if (profile.email !== undefined) {
        expect(profile.email.endsWith("@example.test")).toBe(true);
      }
      if (profile.alternateEmail !== undefined) {
        expect(profile.alternateEmail.endsWith("@example.test")).toBe(true);
      }
      ids.add(profile.id);
    }
    expect(ids.size).toBe(profiles.length);
  });

  it("honors the deceased coupling: no live email, consent off, no headshot (D49)", () => {
    const profiles = generateProfiles({ count: 1000, seed: 9 });
    for (const profile of profiles) {
      if (profile.deceased.isDeceased) {
        expect(profile.email).toBeUndefined();
        expect(profile.allowNewsletterEmail).toBe(false);
        expect(profile.hasHeadshot).toBe(false);
        expect(profile.unlisted).toBe(false);
      }
    }
  });

  it("spans the feature space across the full schema", () => {
    const profiles = generateProfiles({ count: 1500, seed: 11 });
    expect(profiles.some((p) => p.deceased.isDeceased)).toBe(true);
    expect(profiles.some((p) => !p.deceased.isDeceased)).toBe(true);
    expect(profiles.some((p) => p.unlisted)).toBe(true);
    expect(profiles.some((p) => p.debrothered.isDebrothered)).toBe(true);
    expect(profiles.some((p) => p.hasHeadshot)).toBe(true);
    expect(profiles.some((p) => p.address?.country !== "US")).toBe(true);
    expect(profiles.some((p) => p.classYear === null)).toBe(true);
    expect(profiles.some((p) => (p.majors?.length ?? 0) === 2)).toBe(true);
    expect(profiles.some((p) => p.alternateEmail !== undefined)).toBe(true);
    expect(profiles.some((p) => p.bigBrotherId !== undefined)).toBe(true);
    // Both death forms appear (D122): some full dates, some year-only.
    const deceased = profiles.filter((p) => p.deceased.isDeceased);
    expect(deceased.some((p) => p.deceased.dateOfDeath !== undefined)).toBe(true);
    expect(deceased.some((p) => p.deceased.deathYear !== undefined)).toBe(true);
  });

  it("plants a guaranteed Canonical Name collision that disambiguates by ID (§5.1)", () => {
    const profiles = generateProfiles({ count: 300, seed: 5 });
    const planted = profiles.slice(0, COLLISION_COUNT);
    expect(planted).toHaveLength(2);
    for (const profile of planted) {
      // All planted records share one displayed identity (first, last, year)...
      expect(profile.firstName).toBe(COLLISION_IDENTITY.firstName);
      expect(profile.lastName).toBe(COLLISION_IDENTITY.lastName);
      expect(profile.classYear).toBe(COLLISION_IDENTITY.classYear);
      // ...and stay visible to every viewing role.
      expect(profile.deceased.isDeceased).toBe(false);
      expect(profile.unlisted).toBe(false);
      expect(profile.debrothered.isDebrothered).toBe(false);
    }
    // ...so each resolves to the disambiguated `(#id)` form, never the bare name.
    const names = resolveCanonicalNames(profiles);
    for (const profile of planted) {
      expect(names.get(profile.id)).toBe(`William Evan '19 (#${profile.id})`);
    }
  });

  it("emits only records that pass the shared validation rules (§8)", () => {
    const profiles = generateProfiles({ count: 1500, seed: 13 });
    for (const profile of profiles) {
      const result = validateProfile(profile, {
        currentYear: 2026,
        validMajorCodes: VALID_MAJORS,
        requireRequired: true,
      });
      // Surface the offending field names (never values) if this ever fails.
      expect(result.issues.map((issue) => `${profile.id}:${issue.field}`)).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });
});

/**
 * Every fake brother must be findable where he says he lives (OFC-378 live
 * test). Proximity search locates by **ZIP**, so a postal code unrelated to the
 * city beside it does not produce a slightly scruffy fixture — it produces a
 * feature that cannot be evaluated at all, while looking comprehensively broken.
 * That is exactly what shipped to staging: `postalCode` was a random integer,
 * and a search near San Francisco returned brothers displayed in Pittsburgh,
 * Washington and Boston.
 *
 * These assertions read the **committed proximity tables** rather than a fixture
 * copy of them, because the question is not "is this string ZIP-shaped" but
 * "does this ZIP resolve, to somewhere near this city, in the data the app will
 * actually use".
 */
describe("PLACES postal codes resolve to their own city (OFC-378)", () => {
  const manifest = readFileSync("apps/web/src/generated/geoTables.ts", "utf8");
  // Literal patterns rather than one built from `name`: a template literal eats
  // the backslashes, which turns `\s` into a plain `s` and the match into a
  // silent miss.
  const TABLE_URL = {
    zips: /zips:\s*\{\s*url:\s*"([^"]+)"/,
    cities: /cities:\s*\{\s*url:\s*"([^"]+)"/,
  } as const;
  const tablePath = (name: "zips" | "cities") => {
    const url = TABLE_URL[name].exec(manifest)?.[1];
    if (url === undefined) {
      throw new Error(`no ${name} entry in the generated geo manifest`);
    }
    return `apps/web/public${url}`;
  };
  const centroids = parseZipTable(readFileSync(tablePath("zips"), "utf8"));
  const cities = parseCityTable(readFileSync(tablePath("cities"), "utf8"));
  const cityPoint = (city: string, state: string) =>
    cities.find((c) => c.name === city && c.state === state)?.point;

  const US_PLACES = PLACES.filter((place) => place.country === "US");

  it("covers every US place, so this test cannot pass by filtering everything out", () => {
    // The guard on the guard: if `PLACES` were ever restructured so that no entry
    // matched, every assertion below would vacuously pass.
    expect(US_PLACES.length).toBeGreaterThanOrEqual(15);
  });

  it.each(US_PLACES.map((place) => [`${place.city}, ${place.state}`, place] as const))(
    "%s — every ZIP resolves, and lands within 15 miles of the city",
    (_label, place) => {
      const origin = cityPoint(place.city, place.state as string);
      expect(origin, `${place.city} is not in the origin vocabulary`).toBeDefined();
      expect(place.postalCodes.length).toBeGreaterThan(0);
      for (const zip of place.postalCodes) {
        const point = centroids.get(zip);
        expect(point, `${zip} is not a real ZIP`).toBeDefined();
        // 15 miles is loose on purpose: a large city's outer ZIPs are genuinely
        // several miles from its centroid. It is tight enough to catch the failure
        // that matters — a ZIP belonging to a different metro altogether.
        expect(
          haversineMiles(origin as GeoPoint, point as GeoPoint),
          `${zip} is nowhere near ${place.city}`,
        ).toBeLessThan(15);
      }
    },
  );

  it("reaches leading-zero ZIPs — the whole of New England was unreachable before", () => {
    // The old `rng.int(10000, 99999)` could not produce one, so no fake brother
    // could ever be found near Boston or Cambridge: the region with the largest
    // share of real brothers, and the first place anyone would search.
    const all = PLACES.flatMap((place) => (place.country === "US" ? place.postalCodes : []));
    expect(all.some((zip) => zip.startsWith("0"))).toBe(true);
  });

  it("gives a generated US brother a ZIP that resolves", () => {
    // End to end through the generator, not just over the fixture table.
    const located = generateProfiles({ count: 200 }).filter(
      (p) => p.address?.country === "US" && centroids.has(p.address.postalCode ?? ""),
    );
    const us = generateProfiles({ count: 200 }).filter((p) => p.address?.country === "US");
    expect(located.length).toBe(us.length);
    expect(us.length).toBeGreaterThan(0);
  });

  it("keeps a non-US brother unlocatable even when his postal code is ZIP-shaped", () => {
    // Munich's 80331 is a live Colorado ZIP; the country is the only thing that
    // keeps a Munich brother out of a search near Denver (D177).
    const munich = PLACES.find((place) => place.city === "Munich");
    expect(munich?.postalCodes.some((code) => centroids.has(code))).toBe(true);
    expect(isUsAddress({ country: munich?.country })).toBe(false);
  });
});
