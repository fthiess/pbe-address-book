import { describe, expect, it } from "vitest";
import {
  WRITE_RULE,
  type WriteRule,
  canActOnProfile,
  canImpersonate,
  canWriteField,
  impersonatableRoles,
  partitionWritableFields,
} from "./capabilities.js";
import type { Profile, Role } from "./types.js";

const ROLES: Role[] = ["brother", "manager", "admin"];

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
    expect(WRITE_RULE.headshotVersion).toBe("protected");
    expect(WRITE_RULE.lastVerifiedDate).toBe("protected");
    expect(WRITE_RULE.lastModified).toBe("protected");
    expect(WRITE_RULE.ghostMemberId).toBe("protected");
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

describe("partitionWritableFields", () => {
  it("splits a patch into accepted and rejected by role/ownership", () => {
    // A manager editing another brother: ordinary fields in, consent + protected out.
    const { allowed, rejected } = partitionWritableFields("manager", false, [
      "firstName",
      "email",
      "privacy", // consent — manager-on-another rejected
      "unlisted", // consent — rejected
      "adminNote", // staff — allowed
      "lastModified", // protected — rejected
    ]);
    expect(allowed).toEqual(["firstName", "email", "adminNote"]);
    expect(rejected).toEqual(["privacy", "unlisted", "lastModified"]);
  });
});
