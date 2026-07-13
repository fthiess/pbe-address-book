import type { Profile } from "@pbe/shared";

/** A fixed timestamp so test records are deterministic (no wall-clock in fixtures). */
const FIXED_TIMESTAMP = "2026-06-03T12:00:00.000Z";

/**
 * Build a complete, valid `Profile` for tests, overriding only the fields a
 * given test cares about. Defaults to the docs' fake exemplar, James Smyth '84
 * (#5247); pass `id` (and any names) to make distinct records. Privacy and
 * consent default to the schema's defaults (DATABASE-SCHEMA §3.3) — the
 * reachability toggles on, the two third-party-data toggles off (D93).
 *
 * Test-support only — never imported by shipped code, so it stays out of the
 * production bundle.
 */
export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  const id = overrides.id ?? 5247;
  return {
    id,
    firstName: "James",
    lastName: "Smyth",
    classYear: 1984,
    email: "james.smyth@example.test",
    role: "brother",
    deceased: { isDeceased: false },
    debrothered: { isDebrothered: false },
    hasHeadshot: false,
    privacy: {
      shareEmail: true,
      sharePhone: true,
      shareAddress: true,
      shareEmergency: false,
      shareSpousePartner: false,
    },
    unlisted: false,
    allowNewsletterEmail: true,
    allowShareWithMITAA: false,
    lastModified: FIXED_TIMESTAMP,
    newsletterConsentChangedAt: FIXED_TIMESTAMP,
    ...overrides,
  };
}
