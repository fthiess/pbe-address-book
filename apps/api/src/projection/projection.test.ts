import {
  FIELD_VISIBILITY,
  type FieldVisibility,
  type PrivacyFlags,
  type Profile,
  type Role,
} from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { makeProfile } from "../test-support/make-profile.js";
import { projectForRole, projectSelf } from "./projection.js";

const ROLES: Role[] = ["brother", "manager", "admin"];

const SHARED: PrivacyFlags = {
  shareEmail: true,
  sharePhone: true,
  shareAddress: true,
  shareEmergency: true,
  shareSpousePartner: true,
};
const HIDDEN: PrivacyFlags = {
  shareEmail: false,
  sharePhone: false,
  shareAddress: false,
  shareEmergency: false,
  shareSpousePartner: false,
};

/**
 * A profile with **every** field populated, so a field absent from a projection
 * is absent because the projection withheld it — not because it was undefined.
 * `unlisted`/`debrothered` are left *off* so the record itself survives into
 * every role's view and we can test the field-level visibility of those flags.
 */
function fullProfile(privacy: PrivacyFlags): Profile {
  return makeProfile({
    id: 5247,
    firstName: "James",
    middleName: "Q",
    lastName: "Smyth",
    fullLegalName: "James Quincy Smyth III",
    mugName: "Smitty",
    classYear: 1984,
    email: "james@example.test",
    alternateEmail: "jq@example.test",
    phone: "+1 617 555 0100",
    address: { city: "Cambridge", stateProvince: "MA", country: "US" },
    emergencyContacts: [{ name: "Kin", phone: "555" }],
    employerName: "Acme",
    jobTitle: "Engineer",
    spousePartnerName: "Pat",
    majors: ["6-3"],
    links: [{ label: "Site", url: "https://example.test" }],
    bigBrotherId: 5000,
    deceased: { isDeceased: false },
    debrothered: { isDebrothered: false },
    hasHeadshot: true,
    headshotVersion: "v2",
    privacy,
    unlisted: false,
    allowNewsletterEmail: true,
    allowShareWithMITAA: true,
    lastVerifiedDate: "2026-01-01",
    verifiedBy: 5000,
    lastModified: "2026-06-03T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
    adminNote: "staff eyes only",
    ghostMemberId: "ghost-5247",
  });
}

/**
 * The independent expectation: visibility of a field of each class to each role,
 * with its owner toggle SHARED vs HIDDEN. Hand-written from DATABASE-SCHEMA §9,
 * deliberately not derived from the projection's own predicate.
 */
const EXPECTED: Record<
  FieldVisibility["cls"],
  { shared: Record<Role, boolean>; hidden: Record<Role, boolean> }
> = {
  public: {
    shared: { brother: true, manager: true, admin: true },
    hidden: { brother: true, manager: true, admin: true },
  },
  toggle: {
    shared: { brother: true, manager: true, admin: true },
    hidden: { brother: false, manager: false, admin: true },
  },
  restricted: {
    shared: { brother: false, manager: true, admin: true },
    hidden: { brother: false, manager: true, admin: true },
  },
  "staff-internal": {
    shared: { brother: false, manager: true, admin: true },
    hidden: { brother: false, manager: true, admin: true },
  },
  "system-internal": {
    shared: { brother: false, manager: false, admin: false },
    hidden: { brother: false, manager: false, admin: false },
  },
};

describe("projectForRole — the exhaustive role × field matrix (§9)", () => {
  for (const [label, privacy] of [
    ["all toggles shared", SHARED],
    ["all toggles hidden", HIDDEN],
  ] as const) {
    for (const role of ROLES) {
      it(`${role}, ${label}: every field appears iff §9 permits`, () => {
        const profile = fullProfile(privacy);
        const [view] = projectForRole([profile], role);
        const tier = privacy === SHARED ? "shared" : "hidden";
        for (const field of Object.keys(FIELD_VISIBILITY) as (keyof Profile)[]) {
          const cls = FIELD_VISIBILITY[field].cls;
          const shouldSee = EXPECTED[cls][tier][role];
          expect(
            Object.hasOwn(view ?? {}, field),
            `${role} should ${shouldSee ? "" : "not "}see ${field} (${cls}, ${tier})`,
          ).toBe(shouldSee);
        }
      });
    }
  }

  it("never carries undefined-valued keys (omission, not null) — id is the only guaranteed key", () => {
    const sparse = makeProfile({ id: 5001, middleName: undefined, email: undefined });
    const [view] = projectForRole([sparse], "admin");
    expect(view).not.toHaveProperty("middleName");
    expect(view).not.toHaveProperty("email");
    expect(view?.id).toBe(5001);
  });
});

describe("projectForRole — verification is public (OFC-207, amends D28)", () => {
  it("delivers lastVerifiedDate and verifiedBy to a brother, while lastModified stays restricted", () => {
    const [view] = projectForRole([fullProfile(SHARED)], "brother");
    expect(view?.lastVerifiedDate).toBe("2026-01-01");
    expect(view?.verifiedBy).toBe(5000);
    // The reclassification is scoped to the two verification fields; the other
    // housekeeping timestamps remain owner/manager/admin only.
    expect(view).not.toHaveProperty("lastModified");
    expect(view).not.toHaveProperty("newsletterConsentChangedAt");
  });
});

describe("projectForRole — whole-record hides (D124/D115)", () => {
  const roster = () => [
    makeProfile({ id: 5001 }),
    makeProfile({ id: 5002, unlisted: true }),
    makeProfile({ id: 5003, debrothered: { isDebrothered: true, debrotheredAt: "2026-01-01" } }),
  ];

  it("drops unlisted and de-brothered records from the brother view entirely", () => {
    const view = projectForRole(roster(), "brother");
    expect(view.map((p) => p.id)).toEqual([5001]);
  });

  for (const role of ["manager", "admin"] as const) {
    it(`keeps unlisted and de-brothered records for ${role}, flags set so the UI can mark them`, () => {
      const view = projectForRole(roster(), role);
      expect(view.map((p) => p.id)).toEqual([5001, 5002, 5003]);
      expect(view.find((p) => p.id === 5002)?.unlisted).toBe(true);
      expect(view.find((p) => p.id === 5003)?.debrothered).toEqual({
        isDebrothered: true,
        debrotheredAt: "2026-01-01",
      });
    });
  }

  it("keeps deceased records (In Memoriam is shown, not hidden — D36)", () => {
    const [view] = projectForRole(
      [makeProfile({ deceased: { isDeceased: true, deathYear: 2020 } })],
      "brother",
    );
    expect(view?.deceased?.isDeceased).toBe(true);
  });
});

describe("projectForRole — toggle behaviour by role (D16/D19)", () => {
  it("hides an off-toggle value from brothers and managers, but admins see through", () => {
    const profile = makeProfile({ email: "off@example.test", privacy: HIDDEN });
    expect(projectForRole([profile], "brother")[0]).not.toHaveProperty("email");
    expect(projectForRole([profile], "manager")[0]).not.toHaveProperty("email");
    expect(projectForRole([profile], "admin")[0]?.email).toBe("off@example.test");
  });

  it("shows an on-toggle value to all three roles", () => {
    const profile = makeProfile({ email: "on@example.test", privacy: SHARED });
    for (const role of ROLES) {
      expect(projectForRole([profile], role)[0]?.email).toBe("on@example.test");
    }
  });

  it("lets a manager see the restricted privacy flags even while the value stays hidden", () => {
    const profile = makeProfile({ email: "off@example.test", privacy: HIDDEN });
    const [view] = projectForRole([profile], "manager");
    expect(view).not.toHaveProperty("email"); // value hidden
    expect(view?.privacy).toEqual(HIDDEN); // but the flag is visible (restricted)
  });
});

describe("projectForRole — cross-caller isolation (S1 / D82)", () => {
  it("is a pure function of (profiles, role): two calls are byte-identical", () => {
    const profiles = [makeProfile({ id: 5001 }), makeProfile({ id: 5002, privacy: HIDDEN })];
    expect(JSON.stringify(projectForRole(profiles, "brother"))).toBe(
      JSON.stringify(projectForRole(profiles, "brother")),
    );
  });

  it("the bulk brother view of a record never carries that record's off-toggle values", () => {
    // No caller-identity path exists that would re-include an owner's hidden value
    // in the uniform bulk projection — that arrives only via projectSelf.
    const profile = makeProfile({ id: 5001, phone: "secret", privacy: HIDDEN });
    const [view] = projectForRole([profile], "brother");
    expect(view).not.toHaveProperty("phone");
  });
});

describe("projectSelf — the owner's own full record (§9 / D82)", () => {
  it("includes the owner's own off-toggle values and restricted settings", () => {
    const self = projectSelf(fullProfile(HIDDEN));
    expect(self.email).toBe("james@example.test"); // own value despite shareEmail=false
    expect(self.phone).toBe("+1 617 555 0100");
    expect(self.privacy).toEqual(HIDDEN);
    expect(self.allowNewsletterEmail).toBe(true);
    expect(self.lastVerifiedDate).toBe("2026-01-01");
    expect(self.unlisted).toBe(false); // owner sees/sets his own listing state
  });

  it("excludes adminNote and ghostMemberId", () => {
    const self = projectSelf(fullProfile(SHARED)) as Record<string, unknown>;
    expect(self).not.toHaveProperty("adminNote");
    expect(self).not.toHaveProperty("ghostMemberId");
  });

  it("excludes every system-internal field (guard against a future leak)", () => {
    // Driven from the table, so a new system-internal field that projectSelf
    // forgets to drop fails here rather than silently shipping to the client.
    const self = projectSelf(fullProfile(SHARED)) as Record<string, unknown>;
    for (const [field, vis] of Object.entries(FIELD_VISIBILITY)) {
      if (vis.cls === "system-internal") {
        expect(self).not.toHaveProperty(field);
      }
    }
  });

  it("hides staff-internal fields except the allow-listed unlisted/debrothered (OFC-97)", () => {
    // projectSelf is now table-driven, so the safe default is inverted: a
    // staff-internal field is owner-hidden unless explicitly owner-visible. adminNote
    // stays hidden; unlisted/debrothered (the owner's own status) stay visible. A
    // FUTURE staff-internal field would be caught here — hidden until opted in.
    const self = projectSelf(fullProfile(SHARED)) as Record<string, unknown>;
    for (const [field, vis] of Object.entries(FIELD_VISIBILITY)) {
      if (vis.cls === "staff-internal") {
        const ownerVisible = field === "unlisted" || field === "debrothered";
        expect(Object.hasOwn(self, field), `${field} owner-visible=${ownerVisible}`).toBe(
          ownerVisible,
        );
      }
    }
  });
});
