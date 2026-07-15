import { describe, expect, it } from "vitest";
import {
  WRITE_RULE,
  type WriteRule,
  canActOnProfile,
  canImpersonate,
  canWriteField,
  canWriteFieldOnRecord,
  hasUsableEmail,
  impersonatableRoles,
  isRoleDowngrade,
  isRoleEligible,
  isUsableAdmin,
  partitionWritableFields,
  shouldHaveGhostMember,
} from "./capabilities.js";
import type { PrivacyFlags, Profile, Role } from "./types.js";

const ROLES: Role[] = ["brother", "manager", "admin"];

/** All share-toggles on — the permissive baseline for the field-rule truth table. */
const ALL_SHARED: PrivacyFlags = {
  shareEmail: true,
  sharePhone: true,
  shareAddress: true,
  shareEmergency: true,
  shareSpousePartner: true,
};
/** All share-toggles off — the record whose contact/spouse fields are hidden. */
const NONE_SHARED: PrivacyFlags = {
  shareEmail: false,
  sharePhone: false,
  shareAddress: false,
  shareEmergency: false,
  shareSpousePartner: false,
};

describe("WRITE_RULE table", () => {
  it("classifies a representative of each rule (DATABASE-SCHEMA §8)", () => {
    expect(WRITE_RULE.id).toBe("protected");
    expect(WRITE_RULE.firstName).toBe("editable");
    expect(WRITE_RULE.email).toBe("editable");
    expect(WRITE_RULE.privacy).toBe("consent");
    expect(WRITE_RULE.unlisted).toBe("consent");
    expect(WRITE_RULE.allowNewsletterEmail).toBe("consent");
    expect(WRITE_RULE.adminNote).toBe("staff");
    expect(WRITE_RULE.deceased).toBe("protected");
    expect(WRITE_RULE.debrothered).toBe("protected");
    // Role is protected: set only by the change-role action, never via PATCH (OFC-139).
    expect(WRITE_RULE.role).toBe("protected");
    expect(WRITE_RULE.headshotVersion).toBe("protected");
    expect(WRITE_RULE.lastVerifiedDate).toBe("protected");
    expect(WRITE_RULE.lastModified).toBe("protected");
    expect(WRITE_RULE.ghostMemberId).toBe("protected");
  });
});

describe("hasUsableEmail / isUsableAdmin — the last-admin invariant's usable-admin predicate (OFC-241)", () => {
  const usableAdmin: Pick<Profile, "role" | "deceased" | "debrothered" | "email"> = {
    role: "admin",
    deceased: { isDeceased: false },
    debrothered: { isDebrothered: false },
    email: "admin@example.test",
  };

  it("hasUsableEmail is true only for a non-empty, non-whitespace string", () => {
    expect(hasUsableEmail("a@x.test")).toBe(true);
    expect(hasUsableEmail(undefined)).toBe(false);
    expect(hasUsableEmail("")).toBe(false);
    expect(hasUsableEmail("   ")).toBe(false);
  });

  it("counts a living, emailed, non-de-brothered admin as usable", () => {
    expect(isUsableAdmin(usableAdmin)).toBe(true);
  });

  it("is false for a non-admin role", () => {
    expect(isUsableAdmin({ ...usableAdmin, role: "manager" })).toBe(false);
    expect(isUsableAdmin({ ...usableAdmin, role: "brother" })).toBe(false);
  });

  it("is false for an admin who cannot actually sign in (deceased / de-brothered / emailless)", () => {
    expect(isUsableAdmin({ ...usableAdmin, deceased: { isDeceased: true } })).toBe(false);
    expect(isUsableAdmin({ ...usableAdmin, debrothered: { isDebrothered: true } })).toBe(false);
    expect(isUsableAdmin({ ...usableAdmin, email: undefined })).toBe(false);
    expect(isUsableAdmin({ ...usableAdmin, email: "   " })).toBe(false);
  });

  it("isRoleEligible is the sign-in-eligibility half, role-agnostic (backs the promote-guard)", () => {
    const eligible = {
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      email: "x@y.test",
    };
    expect(isRoleEligible(eligible)).toBe(true);
    expect(isRoleEligible({ ...eligible, deceased: { isDeceased: true } })).toBe(false);
    expect(isRoleEligible({ ...eligible, debrothered: { isDebrothered: true } })).toBe(false);
    expect(isRoleEligible({ ...eligible, email: undefined })).toBe(false);
  });

  it("shouldHaveGhostMember is the email↔Ghost invariant: living + not-de-brothered + usable email (D133)", () => {
    const eligible = {
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      email: "x@y.test",
    };
    expect(shouldHaveGhostMember(eligible)).toBe(true);
    expect(shouldHaveGhostMember({ ...eligible, email: undefined })).toBe(false); // Book-only
    expect(shouldHaveGhostMember({ ...eligible, email: "   " })).toBe(false); // not usable
    expect(shouldHaveGhostMember({ ...eligible, deceased: { isDeceased: true } })).toBe(false);
    expect(shouldHaveGhostMember({ ...eligible, debrothered: { isDebrothered: true } })).toBe(
      false,
    );
  });

  it("isRoleDowngrade is true only for a strictly lower role (backs the gate re-check, OFC-239)", () => {
    expect(isRoleDowngrade("admin", "brother")).toBe(true);
    expect(isRoleDowngrade("admin", "manager")).toBe(true);
    expect(isRoleDowngrade("manager", "brother")).toBe(true);
    expect(isRoleDowngrade("brother", "admin")).toBe(false); // an upgrade
    expect(isRoleDowngrade("manager", "admin")).toBe(false); // an upgrade
    expect(isRoleDowngrade("admin", "admin")).toBe(false); // unchanged
  });
});

describe("canActOnProfile — the object-level predicate (D106)", () => {
  it("lets a brother act only on his own record", () => {
    expect(canActOnProfile("brother", 5001, 5001)).toBe(true);
    expect(canActOnProfile("brother", 5001, 5002)).toBe(false);
  });

  it("lets managers and admins act on any record", () => {
    for (const role of ["manager", "admin"] as const) {
      expect(canActOnProfile(role, 5001, 5001)).toBe(true);
      expect(canActOnProfile(role, 5001, 5002)).toBe(true);
    }
  });
});

describe("canWriteField — the per-field write truth table (§8)", () => {
  // Independent expectation per rule × (isOwner) × role.
  const expected: Record<
    WriteRule,
    { owner: Record<Role, boolean>; other: Record<Role, boolean> }
  > = {
    editable: {
      owner: { brother: true, manager: true, admin: true },
      other: { brother: false, manager: true, admin: true },
    },
    consent: {
      owner: { brother: true, manager: true, admin: true },
      other: { brother: false, manager: false, admin: true },
    },
    staff: {
      // adminNote: staff-only, and the owner cannot write his own (§9).
      owner: { brother: false, manager: true, admin: true },
      other: { brother: false, manager: true, admin: true },
    },
    protected: {
      owner: { brother: false, manager: false, admin: false },
      other: { brother: false, manager: false, admin: false },
    },
  };

  // One representative field per rule.
  const sample: Record<WriteRule, keyof Profile> = {
    editable: "firstName",
    consent: "privacy",
    staff: "adminNote",
    protected: "lastModified",
  };

  for (const rule of Object.keys(sample) as WriteRule[]) {
    for (const role of ROLES) {
      it(`${rule}/${sample[rule]} → ${role}: owner=${expected[rule].owner[role]}, other=${expected[rule].other[role]}`, () => {
        expect(canWriteField(role, true, sample[rule])).toBe(expected[rule].owner[role]);
        expect(canWriteField(role, false, sample[rule])).toBe(expected[rule].other[role]);
      });
    }
  }

  it("encodes the D124 unlisted rule precisely: owner yes, admin-on-another yes, manager-on-another no", () => {
    expect(canWriteField("brother", true, "unlisted")).toBe(true); // owner self-service
    expect(canWriteField("admin", false, "unlisted")).toBe(true); // admin sets another's
    expect(canWriteField("manager", false, "unlisted")).toBe(false); // manager may not
    expect(canWriteField("admin", true, "unlisted")).toBe(true); // admin's own, too
  });

  it("never lets a manager change another brother's consent/privacy (§9)", () => {
    for (const field of ["privacy", "allowNewsletterEmail", "allowShareWithMITAA"] as const) {
      expect(canWriteField("manager", false, field)).toBe(false);
      expect(canWriteField("admin", false, field)).toBe(true);
    }
  });
});

describe("canImpersonate — step-down only (N31)", () => {
  it("lets each role view as strictly lower roles, never up or sideways", () => {
    // Full truth table over real × target.
    const expected: Record<Role, Record<Role, boolean>> = {
      admin: { brother: true, manager: true, admin: false },
      manager: { brother: true, manager: false, admin: false },
      brother: { brother: false, manager: false, admin: false },
    };
    for (const real of ROLES) {
      for (const target of ROLES) {
        expect(canImpersonate(real, target)).toBe(expected[real][target]);
      }
    }
  });
});

describe("impersonatableRoles — the menu source, highest-first", () => {
  it("yields the step-down targets in descending rank", () => {
    expect(impersonatableRoles("admin")).toEqual(["manager", "brother"]);
    expect(impersonatableRoles("manager")).toEqual(["brother"]);
    expect(impersonatableRoles("brother")).toEqual([]);
  });
});

describe("canWriteFieldOnRecord — the record-aware gate (N70, OFC-206)", () => {
  const TOGGLE_FIELDS: { field: keyof Profile; flag: keyof PrivacyFlags }[] = [
    { field: "email", flag: "shareEmail" },
    { field: "alternateEmail", flag: "shareEmail" },
    { field: "phone", flag: "sharePhone" },
    { field: "address", flag: "shareAddress" },
    { field: "emergencyContacts", flag: "shareEmergency" },
    { field: "spousePartnerName", flag: "shareSpousePartner" },
  ];

  it("blocks a non-owner manager from writing a toggle field the owner has hidden", () => {
    for (const { field } of TOGGLE_FIELDS) {
      // Flag on → the manager sees it and may maintain it.
      expect(canWriteFieldOnRecord("manager", false, field, ALL_SHARED)).toBe(true);
      // Flag off → hidden from the manager's projection, so unwritable (no blind clobber).
      expect(canWriteFieldOnRecord("manager", false, field, NONE_SHARED)).toBe(false);
    }
  });

  it("never gates the owner or an admin — neither is blind to the value", () => {
    for (const { field } of TOGGLE_FIELDS) {
      // The owner reads their whole record.
      expect(canWriteFieldOnRecord("brother", true, field, NONE_SHARED)).toBe(true);
      // An admin reads through every toggle (D19).
      expect(canWriteFieldOnRecord("admin", false, field, NONE_SHARED)).toBe(true);
    }
  });

  it("leaves non-toggle fields exactly as the static rule decided", () => {
    // Public editable field: writable regardless of privacy.
    expect(canWriteFieldOnRecord("manager", false, "firstName", NONE_SHARED)).toBe(true);
    // Staff note: manager yes, owner no — privacy-independent.
    expect(canWriteFieldOnRecord("manager", false, "adminNote", NONE_SHARED)).toBe(true);
    expect(canWriteFieldOnRecord("brother", true, "adminNote", ALL_SHARED)).toBe(false);
    // Consent field: manager-on-another still no, even with everything shared.
    expect(canWriteFieldOnRecord("manager", false, "privacy", ALL_SHARED)).toBe(false);
    // Protected: never, either way.
    expect(canWriteFieldOnRecord("admin", false, "lastModified", ALL_SHARED)).toBe(false);
  });
});

describe("partitionWritableFields", () => {
  it("splits a patch into accepted and rejected by role/ownership", () => {
    // A manager editing another brother whose contact fields are shared: ordinary
    // fields in, consent + protected out.
    const { allowed, rejected } = partitionWritableFields(
      "manager",
      false,
      ["firstName", "email", "privacy", "unlisted", "adminNote", "lastModified"],
      ALL_SHARED,
    );
    expect(allowed).toEqual(["firstName", "email", "adminNote"]);
    expect(rejected).toEqual(["privacy", "unlisted", "lastModified"]);
  });

  it("rejects a hidden toggle field a manager cannot see on this record (N70)", () => {
    // Same manager, but the owner has hidden email and spouse: those drop to rejected.
    const { allowed, rejected } = partitionWritableFields(
      "manager",
      false,
      ["firstName", "email", "spousePartnerName", "adminNote"],
      NONE_SHARED,
    );
    expect(allowed).toEqual(["firstName", "adminNote"]);
    expect(rejected).toEqual(["email", "spousePartnerName"]);
  });
});
