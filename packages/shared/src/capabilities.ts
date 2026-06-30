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

import type { BrotherId, Profile, Role } from "./types.js";

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
  hasHeadshot: "protected", // headshot upload/remove pipeline (pointer-last — §7)
  headshotVersion: "protected", // ditto; opaque server-set token (R16)

  // Owner's privacy & consent — owner or admin, never a manager-on-another.
  privacy: "consent",
  unlisted: "consent", // owner self-service; admin may set another's; manager may not (D124)
  allowNewsletterEmail: "consent",
  allowCommentReplyEmail: "consent",
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
};

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
 * The role hierarchy, low → high (DATABASE-SCHEMA §8). The single source of the
 * *ordering* the step-down impersonation rule reads; the projection/write rules
 * above are deliberately not ordinal (they branch on the role name), so this rank
 * exists only where a comparison is genuinely needed.
 */
const ROLE_RANK: Record<Role, number> = { brother: 0, manager: 1, admin: 2 };

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

/** Partition a set of would-be-written field names into accepted and rejected. */
export function partitionWritableFields(
  role: Role,
  isOwner: boolean,
  fields: Iterable<keyof Profile>,
): { readonly allowed: (keyof Profile)[]; readonly rejected: (keyof Profile)[] } {
  const allowed: (keyof Profile)[] = [];
  const rejected: (keyof Profile)[] = [];
  for (const field of fields) {
    (canWriteField(role, isOwner, field) ? allowed : rejected).push(field);
  }
  return { allowed, rejected };
}
