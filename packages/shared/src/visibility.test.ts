import { describe, expect, it } from "vitest";
import type { PrivacyFlags, Profile, Role } from "./types.js";
import { FIELD_VISIBILITY, type FieldVisibility, fieldVisibleToRole } from "./visibility.js";

const ROLES: Role[] = ["brother", "manager", "admin"];

/** All-true flags, so every toggle field is *shared* by its owner. */
const SHARED: PrivacyFlags = {
  shareEmail: true,
  sharePhone: true,
  shareAddress: true,
  shareEmergency: true,
  shareSpousePartner: true,
};

/** All-false flags, so every toggle field is *hidden* by its owner. */
const HIDDEN: PrivacyFlags = {
  shareEmail: false,
  sharePhone: false,
  shareAddress: false,
  shareEmergency: false,
  shareSpousePartner: false,
};

describe("FIELD_VISIBILITY table", () => {
  it("classifies the field set the schema documents (DATABASE-SCHEMA §3.3/§9)", () => {
    // Spot-check a representative of each class against the schema's Visibility column.
    expect(FIELD_VISIBILITY.firstName).toEqual({ cls: "public" });
    expect(FIELD_VISIBILITY.deceased).toEqual({ cls: "public" });
    expect(FIELD_VISIBILITY.email).toEqual({ cls: "toggle", flag: "shareEmail" });
    expect(FIELD_VISIBILITY.phone).toEqual({ cls: "toggle", flag: "sharePhone" });
    expect(FIELD_VISIBILITY.spousePartnerName).toEqual({
      cls: "toggle",
      flag: "shareSpousePartner",
    });
    expect(FIELD_VISIBILITY.privacy).toEqual({ cls: "restricted" });
    expect(FIELD_VISIBILITY.lastModified).toEqual({ cls: "restricted" });
    expect(FIELD_VISIBILITY.adminNote).toEqual({ cls: "staff-internal" });
    expect(FIELD_VISIBILITY.unlisted).toEqual({ cls: "staff-internal" });
    expect(FIELD_VISIBILITY.debrothered).toEqual({ cls: "staff-internal" });
    expect(FIELD_VISIBILITY.ghostMemberId).toEqual({ cls: "system-internal" });
  });

  it("maps every toggle field to a real PrivacyFlags switch", () => {
    const flagKeys = new Set(Object.keys(SHARED));
    for (const vis of Object.values(FIELD_VISIBILITY)) {
      if (vis.cls === "toggle") {
        expect(flagKeys.has(vis.flag)).toBe(true);
      }
    }
  });

  it("never classifies a Profile field as the users-only 'private' class", () => {
    // `private` (role/stars) lives in the `users` doc, not `Profile` (§9).
    for (const vis of Object.values(FIELD_VISIBILITY)) {
      expect(vis.cls).not.toBe("private");
    }
  });
});

describe("fieldVisibleToRole — the per-field bulk truth table (§9)", () => {
  // Hand-written, independent of the implementation's switch: visibility of a
  // field of each class to each role, for a SHARED toggle vs a HIDDEN toggle.
  const expected: Record<
    FieldVisibility["cls"],
    { shared: Record<Role, boolean>; hidden: Record<Role, boolean> }
  > = {
    public: {
      shared: { brother: true, manager: true, admin: true },
      hidden: { brother: true, manager: true, admin: true },
    },
    toggle: {
      // shared: peers + managers see it; hidden: only admins see through (D16/D19).
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

  const samples: FieldVisibility[] = [
    { cls: "public" },
    { cls: "toggle", flag: "shareEmail" },
    { cls: "restricted" },
    { cls: "staff-internal" },
    { cls: "system-internal" },
  ];

  for (const vis of samples) {
    for (const role of ROLES) {
      it(`${vis.cls} → ${role}: shared=${expected[vis.cls].shared[role]}, hidden=${expected[vis.cls].hidden[role]}`, () => {
        expect(fieldVisibleToRole(vis, role, SHARED)).toBe(expected[vis.cls].shared[role]);
        expect(fieldVisibleToRole(vis, role, HIDDEN)).toBe(expected[vis.cls].hidden[role]);
      });
    }
  }

  it("reads the named flag for toggle fields (sharePhone independent of shareEmail)", () => {
    const phone: FieldVisibility = { cls: "toggle", flag: "sharePhone" };
    const onlyPhoneOff: PrivacyFlags = { ...SHARED, sharePhone: false };
    expect(fieldVisibleToRole(phone, "brother", onlyPhoneOff)).toBe(false);
    expect(fieldVisibleToRole(phone, "manager", onlyPhoneOff)).toBe(false);
    expect(fieldVisibleToRole(phone, "admin", onlyPhoneOff)).toBe(true);
    // shareEmail being on must not leak the phone field through.
    expect(fieldVisibleToRole({ cls: "toggle", flag: "shareEmail" }, "brother", onlyPhoneOff)).toBe(
      true,
    );
  });
});

// A compile-time guard: the table is exhaustive over keyof Profile by its type,
// so this assignment fails to typecheck if a field is added without a class.
const _exhaustive: Record<keyof Profile, FieldVisibility> = FIELD_VISIBILITY;
void _exhaustive;
