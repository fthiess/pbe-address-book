/**
 * The write-side capability matrix — the **dual of the read projection**
 * (`visibility.ts`), and the second half of Book's access-control floor
 * (DATABASE-SCHEMA §8 "Authorization"; ENGINEERING-DESIGN §1.4/§2.4; DECISIONS
 * D19/D106/D124). Where the read projection decides which fields leave the
 * server, this decides which fields a write may bring *in*.
 *
 * Two independent gates, both enforced server-side; a write must clear both:
 *
 *  1. The **object-level predicate** ({@link canActOnProfile}): may this caller
 *     touch this record at all? A brother may write only his own record; a
 *     manager or admin may write any. This blocks the IDOR a bare
 *     "is-authenticated" check would leave open on contiguous, guessable
 *     Constitution IDs (D106).
 *
 *  2. The **per-field writable allowlist** ({@link canWriteField}): given that
 *     the caller may touch the record, which *fields* may this role write? A
 *     field outside the allowlist is **rejected, never silently dropped**
 *     (§8) — the route returns 403/422 rather than applying a partial write.
 *
 * Like `FIELD_VISIBILITY`, `WRITE_RULE` is `Record<keyof Profile, …>`, so a new
 * `Profile` field cannot become writable by being forgotten — it will not
 * compile until it is deliberately classified.
 *
 * Scope: this module is the field-level write matrix for the PATCH path. The
 * **named privileged actions** (delete, change-role, mark-deceased, de-brother,
 * verify, export, backup, Ghost-sync) are gated at their own dedicated
 * endpoints in later phases (PRD §4) — they are not folded into this table,
 * because several mutate fields this table marks `protected` precisely so they
 * cannot ride the general PATCH path.
 */

import type { BrotherId, PrivacyFlags, Profile, Role } from "./types.js";
import { FIELD_VISIBILITY, fieldVisibleToRole } from "./visibility.js";

/**
 * How a field may be written through the general PATCH path:
 *
 * - **editable** — ordinary directory data: writable by the owner, a manager, or
 *   an admin (subject to the object predicate). Managers maintain any visible
 *   field (ENGINEERING-DESIGN §2.4).
 * - **consent** — the owner's privacy and consent choices (the `privacy` flags,
 *   the three `allow*` switches, and `unlisted`): writable by the **owner or an
 *   admin only** — a manager editing another brother **cannot** change his
 *   privacy/consent (§9; D124's owner-or-admin rule for `unlisted`).
 * - **staff** — `adminNote`: read/write for managers and admins, and **not** the
 *   owner (a staff-internal note the brother must not see or set, §9).
 * - **protected** — never writable through PATCH by any role. The immutable `id`,
 *   the server-managed verification/housekeeping/Ghost fields, and the fields
 *   owned by **dedicated server actions** (`deceased` via mark-deceased,
 *   `debrothered` via the de-brother action, the headshot pointer via the upload
 *   pipeline). "Protected" is about this write path only — these fields still
 *   change, via their own audited endpoints (§8; D106).
 */
export type WriteRule = "editable" | "consent" | "staff" | "protected";

/** Every `Profile` field's PATCH write rule (DATABASE-SCHEMA §8). Exhaustive. */
export const WRITE_RULE: Record<keyof Profile, WriteRule> = {
  // Immutable identity.
  id: "protected",

  // Ordinary directory data — owner / manager / admin.
  firstName: "editable",
  middleName: "editable",
  lastName: "editable",
  fullLegalName: "editable",
  mugName: "editable",
  classYear: "editable",
  email: "editable",
  alternateEmail: "editable",
  phone: "editable",
  address: "editable",
  emergencyContacts: "editable",
  employerName: "editable",
  jobTitle: "editable",
  spousePartnerName: "editable",
  majors: "editable",
  links: "editable",
  bigBrotherId: "editable",

  // Owned by dedicated server actions, not PATCH.
  deceased: "protected", // mark-deceased flow (snapshots consent, forces flags off — §8)
  debrothered: "protected", // PUT …/debrothered (Ghost delete/recreate lifecycle — D115)
  role: "protected", // PUT …/role — the change-role action only, never PATCH (OFC-139)
  hasHeadshot: "protected", // headshot upload/remove pipeline (pointer-last — §7)
  headshotVersion: "protected", // ditto; opaque server-set token (R16)

  // Owner's privacy & consent — owner or admin, never a manager-on-another.
  privacy: "consent",
  unlisted: "consent", // owner self-service; admin may set another's; manager may not (D124)
  allowNewsletterEmail: "consent",
  allowShareWithMITAA: "consent",

  // Server-managed verification & housekeeping.
  lastVerifiedDate: "protected", // set by the verify action (D28)
  verifiedBy: "protected",
  lastModified: "protected", // server-stamped every write
  newsletterConsentChangedAt: "protected", // server-stamped on consent change (D103)

  // Staff-internal note — manager/admin read+write, not the owner.
  adminNote: "staff",

  // System-internal — Ghost handle, set only by the sync/migration path.
  ghostMemberId: "protected",

  // System-internal consent/verification snapshots (D80) — set only by the
  // mark-deceased (PUT …/deceased) and de-brother (PUT …/debrothered) actions.
  deceasedConsentSnapshot: "protected",
  debrotherConsentSnapshot: "protected",
};

/**
 * Whether a brother has an email usable as their sign-in identity — a non-empty,
 * non-whitespace string. Book authenticates through the Ghost bridge, which resolves
 * a member by email, so a brother with **no** usable email can never sign in (Book
 * deliberately tolerates email-less brothers — ~1/3 of the roster; C15/D20/D115).
 * The single definition shared by the Ghost create/de-brother gates and the
 * usable-admin count.
 */
export function hasUsableEmail(email: string | undefined): boolean {
  return typeof email === "string" && email.trim() !== "";
}

/**
 * Whether a brother is **eligible to hold a working staff role** — living, not
 * de-brothered (sign-in denied, D115), and with a usable email (the Ghost bridge
 * resolves sign-in by email). A brother who fails this can never exercise a role,
 * so promoting them to one is meaningless and — for `admin` — counting them toward
 * the last-admin invariant is a lockout hole (OFC-241). `unlisted` is deliberately
 * NOT disqualifying: an unlisted admin can still sign in and act.
 */
export function isRoleEligible(
  profile: Pick<Profile, "deceased" | "debrothered" | "email">,
): boolean {
  return (
    !profile.deceased.isDeceased &&
    !profile.debrothered.isDebrothered &&
    hasUsableEmail(profile.email)
  );
}

/**
 * Whether a brother **should have a Ghost member** — the email↔Ghost-record
 * invariant (D133; OFC-232): a living, non-de-brothered brother has a Ghost member
 * exactly when he has a usable email, and never otherwise. Deceased brothers (D80)
 * and de-brothered brothers (D115) are always Ghost-less; an email-less brother is
 * Book-only (~1/3 of the roster; C15/D20). The Ghost create/delete lifecycle on the
 * PATCH and mark-deceased paths is gated on this predicate.
 *
 * It coincides with {@link isRoleEligible} because both reduce to the same question
 * — *can this brother use the Ghost bridge to sign in* — so it delegates to it. The
 * two are deliberately kept as separate names: they answer distinct questions (one
 * about holding a working role, one about Ghost membership) and could diverge if
 * either concept gains a condition the other lacks.
 */
export function shouldHaveGhostMember(
  profile: Pick<Profile, "deceased" | "debrothered" | "email">,
): boolean {
  return isRoleEligible(profile);
}

/**
 * Whether a profile is an admin who can **actually administer** — the quantity the
 * last-admin invariant must protect (D128, corrected by OFC-241): the `admin` role
 * held by a {@link isRoleEligible} brother. Counting nominal-only admins (deceased /
 * de-brothered / emailless) let the sole *usable* admin demote, delete, mark-deceased,
 * or de-brother themselves into a **zero-usable-admins org lockout** — the very failure
 * the invariant exists to prevent (found in 5.5f live testing: a seeded *deceased*
 * admin, hidden from the Directory, silently satisfied the count).
 */
export function isUsableAdmin(
  profile: Pick<Profile, "role" | "deceased" | "debrothered" | "email">,
): boolean {
  return profile.role === "admin" && isRoleEligible(profile);
}

/**
 * The object-level write predicate: may a caller in `role`, whose own record is
 * `actorId`, write to the record `targetId`? Brothers may write only their own
 * record; managers and admins may write any (ENGINEERING-DESIGN §1.4; D106).
 * This is orthogonal to {@link canWriteField}, which then narrows *which fields*.
 */
export function canActOnProfile(role: Role, actorId: BrotherId, targetId: BrotherId): boolean {
  return actorId === targetId || role === "manager" || role === "admin";
}

/**
 * May `role` write `field` on a record it is permitted to touch, where `isOwner`
 * is whether that record is the caller's own? Pair with {@link canActOnProfile}:
 * the object predicate decides *whether*, this decides *which fields*. A `false`
 * here means the field is **rejected** from the write, not dropped (§8).
 */
export function canWriteField(role: Role, isOwner: boolean, field: keyof Profile): boolean {
  switch (WRITE_RULE[field]) {
    case "editable":
      return isOwner || role === "manager" || role === "admin";
    case "consent":
      return isOwner || role === "admin";
    case "staff":
      return role === "manager" || role === "admin";
    case "protected":
      return false;
  }
}

/**
 * The **record-aware** write predicate — {@link canWriteField} narrowed by the
 * record's own privacy flags, closing the read/write asymmetry OFC-206 found
 * (DECISIONS N70). The principle: *a caller must not be able to write a field
 * they cannot read on this record.*
 *
 * The static {@link canWriteField} marks the contact/spouse fields `editable`, so
 * a manager could PATCH them on any record — but the read projection
 * (`visibility.ts`) hides a `toggle` field from a manager when the owner's
 * governing share-flag is **off** (only admins see through an off toggle, D19). A
 * manager could therefore *overwrite* a spouse/emergency/phone value they were
 * never allowed to *see* — a blind clobber of hidden data. This predicate removes
 * that: a field hidden from the caller's projection is also unwritable by them.
 *
 * Only a **non-owner** is ever at risk of a blind write, and only on a
 * privacy-gated `toggle` field — owners read their whole record, and admins read
 * through every toggle — so those callers are never gated here, and every
 * non-`toggle` field is unaffected (its read visibility already meets or exceeds
 * its write rule). The route pairs this with {@link canActOnProfile} exactly as it
 * did the static check; the client mirrors it in the edit form's diff.
 */
export function canWriteFieldOnRecord(
  role: Role,
  isOwner: boolean,
  field: keyof Profile,
  privacy: PrivacyFlags,
): boolean {
  if (!canWriteField(role, isOwner, field)) {
    return false;
  }
  // "Can't write what you can't read." The owner reads their whole record, so the
  // read gate applies only to a non-owner; for them it collapses to the toggle
  // check (public → always visible, restricted/staff → managers+admins, and the
  // never-writable classes are already `false` above).
  return isOwner || fieldVisibleToRole(FIELD_VISIBILITY[field], role, privacy);
}

/**
 * The role hierarchy, low → high (DATABASE-SCHEMA §8). The single source of the
 * *ordering* the step-down impersonation rule reads; the projection/write rules
 * above are deliberately not ordinal (they branch on the role name), so this rank
 * exists only where a comparison is genuinely needed.
 */
const ROLE_RANK: Record<Role, number> = { brother: 0, manager: 1, admin: 2 };

/**
 * Whether moving `from` → `to` is a **demotion** (a strictly lower role). The
 * session gate uses this to catch a caller whose real role was downgraded after
 * their session snapshotted it (OFC-239): only a downgrade forces re-auth — an
 * upgrade merely under-privileges the stale session, which is safe.
 */
export function isRoleDowngrade(from: Role, to: Role): boolean {
  return ROLE_RANK[to] < ROLE_RANK[from];
}

/**
 * "View as" — may a caller whose **real** role is `realRole` step **down** to
 * `targetRole` for testing (DECISIONS N31)? The rule is strictly ordinal and
 * one-directional: an admin may view as a manager or a brother, a manager as a
 * brother, a brother as no one. Escalation and same-role are both `false`, so a
 * caller can never gain powers they lack — impersonation only ever *restricts*
 * the view (which is why it is safe to expose in production).
 *
 * This is the **mechanism's** name (the endpoints, the audit actions, and the
 * session field all say "impersonate"); the *user-facing* affordance is worded
 * "View as" (N31), since nobody is being deceived and the object is a role, not a
 * person.
 */
export function canImpersonate(realRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[targetRole] < ROLE_RANK[realRole];
}

/**
 * The roles `realRole` may step down to, highest-first (so an admin yields
 * `["manager", "brother"]`). The masthead builds its "View as …" items straight
 * from this, and an empty list (a brother) is what hides the affordance entirely.
 */
export function impersonatableRoles(realRole: Role): Role[] {
  return (["admin", "manager", "brother"] as const).filter((role) =>
    canImpersonate(realRole, role),
  );
}

/**
 * Partition a set of would-be-written field names into accepted and rejected,
 * **against a specific record's privacy flags** (N70). Uses the record-aware
 * {@link canWriteFieldOnRecord}, so a `toggle` field hidden from the caller lands
 * in `rejected` — the write path returns 403 rather than a blind clobber.
 */
export function partitionWritableFields(
  role: Role,
  isOwner: boolean,
  fields: Iterable<keyof Profile>,
  privacy: PrivacyFlags,
): { readonly allowed: (keyof Profile)[]; readonly rejected: (keyof Profile)[] } {
  const allowed: (keyof Profile)[] = [];
  const rejected: (keyof Profile)[] = [];
  for (const field of fields) {
    (canWriteFieldOnRecord(role, isOwner, field, privacy) ? allowed : rejected).push(field);
  }
  return { allowed, rejected };
}
