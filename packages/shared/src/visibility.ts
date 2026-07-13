/**
 * The field-visibility taxonomy — the read-side source of truth for Book's
 * single server-side privacy projection (DATABASE-SCHEMA §9; DECISIONS D5/D16/
 * D19/D44/D82). Every `Profile` field is classified here exactly once, and the
 * projection (`apps/api/src/projection`) is the only place that *executes* the
 * classification, omitting from each response the fields the caller's role (and
 * the record's privacy toggles) do not permit.
 *
 * This is a **declarative table plus a pure predicate**, deliberately in
 * `packages/shared` rather than the backend: the same classification the server
 * enforces is what the SPA reads to decide which controls to render per role
 * (the D50 shared-logic precedent — one source, no client/server drift). The
 * server is still the single *enforcement* point; the client merely mirrors it.
 *
 * Exhaustiveness is load-bearing for safety. `FIELD_VISIBILITY` is typed
 * `Record<keyof Profile, …>`, so a field added to `Profile` later **will not
 * compile** until it is deliberately classified — a new field can never leak
 * into a projection by being forgotten. This is the table the schema's
 * `VisibilityClass` type was written to be checked against (`types.ts`).
 */

import type { PrivacyFlags, Profile, Role } from "./types.js";

/**
 * A field's visibility, tied to the data the projection needs to evaluate it.
 * Toggle fields additionally name the `PrivacyFlags` switch that governs them,
 * so the field→flag mapping (§9) lives in this one table rather than a second
 * structure that could drift from it.
 *
 * Note on `staff-internal`: DATABASE-SCHEMA §9 names `adminNote` as its
 * canonical member, but the **read** visibility it denotes — manager/admin yes,
 * ordinary brothers no — is exactly what the two whole-record-hide flags
 * (`unlisted` D124, `debrothered` D115) also need in the bulk projection, so
 * they are classified here too. Their *other* facets are handled elsewhere and
 * deliberately not by this read table: the owner sees his own `unlisted`/
 * `debrothered` via the wholesale self projection (`projectSelf`), their write
 * rules differ (`capabilities.ts`), and the whole-record hide they drive is the
 * projection's record-level omission, not a field-level one. (DECISIONS N10.)
 *
 * The `private` class of `VisibilityClass` (the `users` doc's `stars`) has no
 * `Profile` member and so never appears in this table. `role` used to live there
 * too, but moved onto the `Profile` (OFC-139) and is now classified `public`
 * below — every brother may see who holds a staff role (OFC-199).
 */
export type FieldVisibility =
  | { readonly cls: "public" }
  | { readonly cls: "toggle"; readonly flag: keyof PrivacyFlags }
  | { readonly cls: "restricted" }
  | { readonly cls: "staff-internal" }
  | { readonly cls: "system-internal" };

/**
 * Every `Profile` field's visibility class (DATABASE-SCHEMA §3.3 "Visibility"
 * column / §9). Exhaustive over `keyof Profile` by construction — see the module
 * note on why that exhaustiveness is the safety guarantee.
 */
export const FIELD_VISIBILITY: Record<keyof Profile, FieldVisibility> = {
  // --- Identity / names / class year — public ---
  id: { cls: "public" },
  firstName: { cls: "public" },
  middleName: { cls: "public" },
  lastName: { cls: "public" },
  fullLegalName: { cls: "public" },
  mugName: { cls: "public" },
  classYear: { cls: "public" },

  // --- Contact — toggle (each behind its owner share-flag) ---
  email: { cls: "toggle", flag: "shareEmail" },
  alternateEmail: { cls: "toggle", flag: "shareEmail" },
  phone: { cls: "toggle", flag: "sharePhone" },
  address: { cls: "toggle", flag: "shareAddress" },
  emergencyContacts: { cls: "toggle", flag: "shareEmergency" },

  // --- Professional / personal ---
  employerName: { cls: "public" },
  jobTitle: { cls: "public" },
  // Third-party data, hidden from peers unless opted in (D93).
  spousePartnerName: { cls: "toggle", flag: "shareSpousePartner" },
  majors: { cls: "public" },
  links: { cls: "public" },
  bigBrotherId: { cls: "public" },

  // --- Status ---
  deceased: { cls: "public" },
  // Staff-only flag; the record it marks is hidden from brothers wholesale (D115).
  debrothered: { cls: "staff-internal" },

  // --- Access ---
  // The brother's Book role. Public: the staff roles (manager/admin) are official
  // contact points, not secrets, so every brother may see who holds them (OFC-199,
  // reversing OFC-139's staff-only proposal). Read-public; write stays locked to
  // the change-role action (WRITE_RULE: protected).
  role: { cls: "public" },

  // --- Photos ---
  hasHeadshot: { cls: "public" },
  headshotVersion: { cls: "public" },

  // --- Visibility settings ---
  privacy: { cls: "restricted" },
  // Staff-only flag; the record it marks is hidden from peers wholesale (D124).
  unlisted: { cls: "staff-internal" },

  // --- Usage preferences / housekeeping — restricted (owner/manager/admin) ---
  allowNewsletterEmail: { cls: "restricted" },
  allowShareWithMITAA: { cls: "restricted" },
  // Verification state is public: an accuracy signal every brother may read, and a
  // public administrative act — not PII (OFC-207; amends D28). The *right to mark*
  // verified stays owner/manager/admin, governed on the write side by
  // `capabilities.ts`; this read class does not widen it. `verifiedBy` is a
  // Constitution id whose canonical name the client resolves from the roster
  // (managers/admins resolve every verifier; a brother falls back to date-only for
  // a verifier hidden from his roster — OFC-208).
  lastVerifiedDate: { cls: "public" },
  verifiedBy: { cls: "public" },
  lastModified: { cls: "restricted" },
  newsletterConsentChangedAt: { cls: "restricted" },

  // --- Staff & integration ---
  adminNote: { cls: "staff-internal" },
  ghostMemberId: { cls: "system-internal" },

  // --- System-internal status snapshots (D80) — never sent to any client ---
  deceasedConsentSnapshot: { cls: "system-internal" },
  debrotherConsentSnapshot: { cls: "system-internal" },
};

/**
 * Whether a role sees a given field on **another brother's** record, given that
 * record's privacy flags. This is the per-field half of the bulk projection
 * (DATABASE-SCHEMA §9):
 *
 * - **public** — every authenticated brother.
 * - **toggle** — the owner and admins always; other brothers *and managers* only
 *   when the owner's share-flag is on (the Session-3 narrowing of D16: a hidden
 *   value is hidden from managers too — only admins, the override role, see
 *   through an off-toggle; D19).
 * - **restricted / staff-internal** — managers and admins; never ordinary
 *   brothers.
 * - **system-internal** — no client, in any projection.
 *
 * This governs the *bulk* per-role projection of records the caller does not
 * own; a caller's own record is delivered in full (bar `adminNote`) out of band
 * by the self projection, which does not consult this predicate (D82).
 */
export function fieldVisibleToRole(
  vis: FieldVisibility,
  role: Role,
  privacy: PrivacyFlags,
): boolean {
  switch (vis.cls) {
    case "public":
      return true;
    case "toggle":
      return role === "admin" || privacy[vis.flag];
    case "restricted":
    case "staff-internal":
      return role === "manager" || role === "admin";
    case "system-internal":
      return false;
  }
}
