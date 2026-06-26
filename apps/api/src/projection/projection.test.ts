import type { PrivacyFlags } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { makeProfile } from "../test-support/make-profile.js";
import { type BrotherProfile, projectForRole } from "./projection.js";

const brotherView = (profile: Parameters<typeof makeProfile>[0]) =>
  projectForRole([makeProfile(profile)], "brother");

/** Privacy flags with `shareEmail` overridden, the rest at their defaults. */
const withShareEmail = (shareEmail: boolean): PrivacyFlags => ({
  shareEmail,
  sharePhone: true,
  shareAddress: true,
  shareEmergency: false,
  shareSpousePartner: false,
});

describe("projectForRole — brother projection (Phase 2a)", () => {
  it("hides an unlisted record entirely (whole-record, D124)", () => {
    const result = projectForRole(
      [makeProfile({ id: 5001 }), makeProfile({ id: 5002, unlisted: true })],
      "brother",
    );
    expect(result.map((p) => p.id)).toEqual([5001]);
  });

  it("hides a de-brothered record entirely (whole-record, D115)", () => {
    const result = projectForRole(
      [makeProfile({ id: 5001 }), makeProfile({ id: 5002, debrothered: { isDebrothered: true } })],
      "brother",
    );
    expect(result.map((p) => p.id)).toEqual([5001]);
  });

  it("keeps deceased records (In Memoriam is shown, not hidden, D36)", () => {
    const [view] = brotherView({ deceased: { isDeceased: true, deathYear: 2020 } });
    expect(view?.deceased.isDeceased).toBe(true);
  });

  it("includes email only when privacy.shareEmail is on (D45)", () => {
    const [shared] = brotherView({ privacy: withShareEmail(true), email: "on@example.test" });
    expect(shared?.email).toBe("on@example.test");

    const [hidden] = brotherView({ privacy: withShareEmail(false), email: "off@example.test" });
    expect(hidden).not.toHaveProperty("email");

    const [sharedNoAddress] = brotherView({ privacy: withShareEmail(true), email: undefined });
    expect(sharedNoAddress).not.toHaveProperty("email");
  });

  it("strips the privacy/consent/restricted/staff/system fields from the brother view", () => {
    const [view] = brotherView({
      adminNote: "secret staff note",
      ghostMemberId: "ghost-5247",
      lastVerifiedDate: "2026-01-01",
    });
    for (const leaked of [
      "privacy",
      "unlisted",
      "allowNewsletterEmail",
      "allowCommentReplyEmail",
      "allowShareWithMITAA",
      "adminNote",
      "ghostMemberId",
      "lastVerifiedDate",
      "verifiedBy",
      "lastModified",
      "newsletterConsentChangedAt",
      "debrothered",
      "email", // no shared email in this fixture (default email is shared, so check below)
    ]) {
      if (leaked === "email") continue; // covered by the email test
      expect(view).not.toHaveProperty(leaked);
    }
  });

  it("passes through the public fields as a positive allowlist", () => {
    const [view] = brotherView({
      id: 5247,
      classYear: 1984,
      middleName: "Q",
      mugName: "Smitty",
      employerName: "Acme",
      jobTitle: "Engineer",
      majors: ["6-3"],
      hasHeadshot: true,
      headshotVersion: "v2",
    });
    const expected: BrotherProfile = {
      id: 5247,
      firstName: "James",
      lastName: "Smyth",
      classYear: 1984,
      deceased: { isDeceased: false },
      hasHeadshot: true,
      middleName: "Q",
      mugName: "Smitty",
      employerName: "Acme",
      jobTitle: "Engineer",
      majors: ["6-3"],
      headshotVersion: "v2",
      email: "james.smyth@example.test", // default fixture shares email
    };
    expect(view).toEqual(expected);
  });
});

describe("projectForRole — unbuilt roles fail loud (Phase 2b)", () => {
  it.each(["manager", "admin"] as const)("throws for the %s projection", (role) => {
    expect(() => projectForRole([makeProfile({})], role)).toThrow(/Phase 2b/);
  });
});
