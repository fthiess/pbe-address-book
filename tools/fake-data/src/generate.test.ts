import { describe, expect, it } from "vitest";
import { DEFAULT_COUNT, FAKE_ID_FLOOR, generateProfiles } from "./generate.js";

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
    const ids = new Set<string>();
    for (const profile of profiles) {
      expect(profile.constitutionId).toBeGreaterThanOrEqual(FAKE_ID_FLOOR);
      expect(profile.constitutionId).toBeGreaterThan(5000);
      if (profile.email !== null) {
        expect(profile.email.endsWith("@example.test")).toBe(true);
      }
      ids.add(profile.id);
    }
    expect(ids.size).toBe(profiles.length);
  });

  it("honors the deceased coupling: no live email, flags off, no headshot (D49)", () => {
    const profiles = generateProfiles({ count: 1000, seed: 9 });
    for (const profile of profiles) {
      if (profile.deceased) {
        expect(profile.email).toBeNull();
        expect(profile.allowDirectoryEmail).toBe(false);
        expect(profile.headshotVersion).toBeNull();
        expect(profile.unlisted).toBe(false);
      }
    }
  });

  it("spans the feature space (some living, some deceased, some unlisted)", () => {
    const profiles = generateProfiles({ count: 1000, seed: 11 });
    expect(profiles.some((p) => p.deceased)).toBe(true);
    expect(profiles.some((p) => !p.deceased)).toBe(true);
    expect(profiles.some((p) => p.unlisted)).toBe(true);
    expect(profiles.some((p) => p.headshotVersion !== null)).toBe(true);
    expect(profiles.some((p) => p.country !== "US")).toBe(true);
  });
});
