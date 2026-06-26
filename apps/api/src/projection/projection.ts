/**
 * The server-side privacy projection — Book's single visibility-enforcement
 * point (DECISIONS D5/D82; ENGINEERING-DESIGN §1.4/§2.4). Every response
 * carrying profile data is projected here to the fields the caller's role and
 * the record's privacy settings permit; the backend *omits* disallowed fields
 * rather than returning a value the caller may not see.
 *
 * PHASE 2a SCOPE. This re-expresses the brother-role projection over the full
 * `Profile` schema (Phase 2a) and adds the **`debrothered` whole-record hide**
 * (D115) alongside the `unlisted` one (D124), both reusing one mechanism. It is
 * deliberately a **safe subset**: the brother view here carries the public
 * fields plus the contact `email` behind its consent toggle (D45). The full
 * field-visibility taxonomy across all classes (phone/address/emergency/spouse
 * toggles, the restricted/staff/system classes), the **manager** and **admin**
 * projections, the write-side capability matrix, and the cross-caller isolation
 * invariant land in Phase 2b, extending this same module so it stays the one
 * enforcement point. Until then the manager/admin arms throw rather than guess,
 * so a misrouted call fails loud instead of leaking an unbuilt projection.
 */

import type { Profile, Role } from "@pbe/shared";

/**
 * A profile as a brother sees it (Phase 2a subset): the public fields, with the
 * contact `email` present only when the owner consented to directory email
 * (D45). The full per-class projected types are defined in Phase 2b alongside
 * the complete taxonomy.
 */
export type BrotherProfile = Pick<
  Profile,
  | "id"
  | "firstName"
  | "middleName"
  | "lastName"
  | "fullLegalName"
  | "mugName"
  | "classYear"
  | "employerName"
  | "jobTitle"
  | "majors"
  | "links"
  | "bigBrotherId"
  | "deceased"
  | "hasHeadshot"
  | "headshotVersion"
> & {
  /** Present only when `privacy.shareEmail` is set and an address is on file (D45). */
  email?: string;
};

/**
 * Project the dataset to a single role's view. Phase 2a implements `brother`;
 * `manager` and `admin` arrive in Phase 2b (they see more, computed fresh per
 * request — D82). Until then those arms throw rather than guess.
 */
export function projectForRole(profiles: readonly Profile[], role: Role): BrotherProfile[] {
  switch (role) {
    case "brother":
      return projectForBrother(profiles);
    case "manager":
    case "admin":
      throw new Error(
        `projectForRole: the "${role}" projection is implemented in Phase 2b (data/permission core).`,
      );
  }
}

/** Whether a record is hidden from brothers as a whole (D124 unlisted / D115 de-brothered). */
function hiddenFromBrothers(profile: Profile): boolean {
  return profile.unlisted || profile.debrothered.isDebrothered;
}

/** The brother-role projection (see the module and {@link BrotherProfile} notes). */
function projectForBrother(profiles: readonly Profile[]): BrotherProfile[] {
  const projected: BrotherProfile[] = [];
  for (const profile of profiles) {
    // Whole-record hide: an unlisted (D124) or de-brothered (D115) record does
    // not exist from a brother's vantage. Both reuse this one omission point.
    if (hiddenFromBrothers(profile)) {
      continue;
    }
    projected.push(projectBrotherFields(profile));
  }
  return projected;
}

/**
 * Field-level brother projection of a single (already listed) record. Written
 * as a **positive allowlist** — every visible field is named explicitly — so a
 * field added to `Profile` later cannot leak into the brother view until it is
 * deliberately listed here. Optional fields are copied only when present, so the
 * wire shape never carries `undefined` keys.
 */
function projectBrotherFields(profile: Profile): BrotherProfile {
  const result: BrotherProfile = {
    id: profile.id,
    firstName: profile.firstName,
    lastName: profile.lastName,
    classYear: profile.classYear,
    deceased: profile.deceased,
    hasHeadshot: profile.hasHeadshot,
  };
  copyIfPresent(profile, result, "middleName");
  copyIfPresent(profile, result, "fullLegalName");
  copyIfPresent(profile, result, "mugName");
  copyIfPresent(profile, result, "employerName");
  copyIfPresent(profile, result, "jobTitle");
  copyIfPresent(profile, result, "majors");
  copyIfPresent(profile, result, "links");
  copyIfPresent(profile, result, "bigBrotherId");
  copyIfPresent(profile, result, "headshotVersion");
  // Contact email is visible only behind its consent toggle (D45).
  if (profile.privacy.shareEmail && profile.email !== undefined) {
    result.email = profile.email;
  }
  return result;
}

/** Copy an optional field onto the projection only when it is present on the source. */
function copyIfPresent<K extends keyof BrotherProfile & keyof Profile>(
  source: Profile,
  target: BrotherProfile,
  key: K,
): void {
  const value = source[key];
  if (value !== undefined) {
    (target[key] as Profile[K]) = value;
  }
}
