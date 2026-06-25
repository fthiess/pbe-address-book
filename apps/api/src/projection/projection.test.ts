import { describe, expect, it } from "vitest";
import { makeProfile } from "../test-support/make-profile.js";
import { type BrotherProfile, projectForRole } from "./projection.js";

const brotherView = (profile: Parameters<typeof makeProfile>[0]) =>
  projectForRole([makeProfile(profile)], "brother");

describe("projectForRole — brother projection", () => {
  it("hides an unlisted record entirely (whole-record, D124)", () => {
    const result = projectForRole(
      [
        makeProfile({ constitutionId: 5001, unlisted: false }),
        makeProfile({ constitutionId: 5002, unlisted: true }),
      ],
      "brother",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.constitutionId).toBe(5001);
  });

  it("keeps deceased records (In Memoriam is shown, not hidden, D36)", () => {
    const [view] = brotherView({ deceased: true, allowDirectoryEmail: false, email: null });
    expect(view?.deceased).toBe(true);
  });

  it("includes email only when the consent toggle is on (D45)", () => {
    const [withConsent] = brotherView({ allowDirectoryEmail: true, email: "on@example.test" });
    expect(withConsent?.email).toBe("on@example.test");

    const [withoutConsent] = brotherView({ allowDirectoryEmail: false, email: "off@example.test" });
    expect(withoutConsent).not.toHaveProperty("email");

    const [consentButNoAddress] = brotherView({ allowDirectoryEmail: true, email: null });
    expect(consentButNoAddress).not.toHaveProperty("email");
  });

  it("strips the privacy/consent flags from the brother view", () => {
    const [view] = brotherView({});
    expect(view).not.toHaveProperty("unlisted");
    expect(view).not.toHaveProperty("allowDirectoryEmail");
  });

  it("passes through the public fields", () => {
    const [view] = brotherView({
      constitutionId: 5247,
      canonicalName: "James Smyth",
      classYear: 1984,
      city: "Cambridge",
      headshotVersion: 3,
    });
    // Spelled out so a leak shows up as an unexpected key on a positive allowlist.
    const expected: BrotherProfile = {
      id: "fake-5247",
      constitutionId: 5247,
      canonicalName: "James Smyth",
      firstName: "James",
      lastName: "Smyth",
      classYear: 1984,
      city: "Cambridge",
      state: "MA",
      country: "USA",
      deceased: false,
      headshotVersion: 3,
      email: "james.smyth@example.test",
    };
    expect(view).toEqual(expected);
  });
});

describe("projectForRole — unbuilt roles fail loud (Phase 2)", () => {
  it.each(["manager", "admin"] as const)("throws for the %s projection", (role) => {
    expect(() => projectForRole([makeProfile({})], role)).toThrow(/Phase 2/);
  });
});
