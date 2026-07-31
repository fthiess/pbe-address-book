import type { Profile } from "@pbe/shared";

/** A fixed timestamp so test records are deterministic (no wall-clock in fixtures). */
const FIXED_TIMESTAMP = "2026-06-03T12:00:00.000Z";

/**
 * Build a complete, valid `Profile` for tests, overriding only the fields a
 * given test cares about. Defaults to the docs' fake exemplar, James Smyth '84
 * (#5247); pass `id` (and any names) to make distinct records.
 *
 * ⚠ The privacy block is **deliberately not the schema default** any more. It
 * mirrored it until D163 flipped `shareEmergency`/`shareSpousePartner` to on
 * (OFC-373); this fixture keeps them **off** so the hidden-toggle cases stay
 * covered — above all the N70/OFC-206 guard that a manager cannot overwrite a
 * value the owner has hidden, which needs a hidden value to exist. A test that
 * wants a typical post-launch record must set them `true` explicitly.
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
