/**
 * The server-side privacy projection — Book's single visibility-enforcement
 * point (DECISIONS D5/D82; ENGINEERING-DESIGN §1.4/§2.4). Every response
 * carrying profile data is projected here to the fields the caller's role and
 * the record's privacy settings permit; the backend *omits* disallowed fields
 * rather than returning a value the caller may not see.
 *
 * PHASE 1a SCOPE. This is the walking-skeleton projection: it implements the
 * **brother** role over the first-cut `Profile` shape, exercising both kinds of
 * projection the full design needs — a *whole-record* hide (the `unlisted`
 * record vanishes from the brother view, D124) and *field-level* omission (the
 * privacy/consent flags are stripped, and the contact email appears only behind
 * its consent toggle, D45). The full field-visibility taxonomy across all
 * classes, the manager/admin projections, the capability matrix, and the
 * de-brother whole-record hide (D115) land in Phase 2, extending this same
 * module so it stays the one enforcement point.
 */

import type { Profile, Role } from "@pbe/shared";

/**
 * A profile as a brother sees it: the public fields, with the privacy/consent
 * flags removed and the contact email present only when the owner consented to
 * directory email (D45). A subset of `Profile` — the full per-class projected
 * types are defined in Phase 2 alongside the complete taxonomy.
 */
export type BrotherProfile = Omit<Profile, "email" | "unlisted" | "allowDirectoryEmail"> & {
  /** Present only when `allowDirectoryEmail` is set and an address is on file. */
  email?: string;
};

/**
 * Project the dataset to a single role's view. Phase 1a implements `brother`;
 * `manager` and `admin` arrive in Phase 2 (they see more, computed fresh per
 * request — D82). Until then those arms throw rather than guess, so a
 * misrouted call fails loud instead of leaking an unbuilt projection.
 */
export function projectForRole(profiles: readonly Profile[], role: Role): BrotherProfile[] {
  switch (role) {
    case "brother":
      return projectForBrother(profiles);
    case "manager":
    case "admin":
      throw new Error(
        `projectForRole: the "${role}" projection is implemented in Phase 2 (data/permission core).`,
      );
  }
}

/** The brother-role projection (see the module and {@link BrotherProfile} notes). */
function projectForBrother(profiles: readonly Profile[]): BrotherProfile[] {
  const projected: BrotherProfile[] = [];
  for (const profile of profiles) {
    // Whole-record hide: an unlisted record does not exist from a brother's
    // vantage (D124). The de-brother whole-record hide (D115) joins this in
    // Phase 2 once the `debrothered` sub-type exists.
    if (profile.unlisted) {
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
 * deliberately listed here. This is the safer default for the enforcement point.
 */
function projectBrotherFields(profile: Profile): BrotherProfile {
  const result: BrotherProfile = {
    id: profile.id,
    constitutionId: profile.constitutionId,
    canonicalName: profile.canonicalName,
    firstName: profile.firstName,
    lastName: profile.lastName,
    classYear: profile.classYear,
    city: profile.city,
    state: profile.state,
    country: profile.country,
    deceased: profile.deceased,
    headshotVersion: profile.headshotVersion,
  };
  // Contact email is visible only behind its consent toggle (D45).
  if (profile.allowDirectoryEmail && profile.email !== null) {
    result.email = profile.email;
  }
  return result;
}
