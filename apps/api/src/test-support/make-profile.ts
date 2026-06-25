import type { Profile } from "@pbe/shared";

/**
 * Build a complete, valid `Profile` for tests, overriding only the fields a
 * given test cares about. Defaults to the docs' fake exemplar, James Smyth '84
 * (#5247); pass `constitutionId` (and any names) to make distinct records.
 *
 * Test-support only — never imported by shipped code, so it stays out of the
 * production bundle.
 */
export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  const constitutionId = overrides.constitutionId ?? 5247;
  return {
    id: `fake-${constitutionId}`,
    constitutionId,
    canonicalName: "James Smyth",
    firstName: "James",
    lastName: "Smyth",
    classYear: 1984,
    email: "james.smyth@example.test",
    city: "Cambridge",
    state: "MA",
    country: "USA",
    deceased: false,
    unlisted: false,
    allowDirectoryEmail: true,
    headshotVersion: null,
    ...overrides,
  };
}
