import { MAJOR_CODES, resolveCanonicalNames, validateProfile } from "@pbe/shared";
import { describe, expect, it } from "vitest";
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
