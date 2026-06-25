import type { Profile } from "@pbe/shared";
import { FIRST_NAMES, LAST_NAMES, PLACES } from "./fixtures.js";
import { Random } from "./prng.js";

/**
 * The deterministic seeded fake-data generator (DECISIONS D65). Produces
 * obviously-fake profiles that span the feature space (living and deceased,
 * listed and unlisted, with and without a headshot, US and international,
 * email present and absent). Same options in → byte-identical profiles out.
 *
 * NOTE (Phase 0): the generator targets the first-cut `Profile` shape in
 * `@pbe/shared`. It grows alongside the full schema in Phase 2 so the dataset
 * keeps "spanning every feature" as features land.
 */

export interface GenerateOptions {
  /** How many profiles to generate (D65 calls for ~600–2000). */
  count?: number;
  /** PRNG seed. A fixed default keeps the dataset stable across runs. */
  seed?: number;
}

/** Default seed — the ASCII bytes of "PBE\0", just to be memorable. */
export const DEFAULT_SEED = 0x50424500;
export const DEFAULT_COUNT = 1200;

/** The lowest fake Constitution ID. Real signing numbers are below this. */
export const FAKE_ID_FLOOR = 5001;

const CURRENT_YEAR = 2026;

function emailFor(first: string, last: string, constitutionId: number): string {
  const local = `${first}.${last}.${constitutionId}`.toLowerCase();
  return `${local}@example.test`;
}

export function generateProfiles(options: GenerateOptions = {}): Profile[] {
  const count = options.count ?? DEFAULT_COUNT;
  const rng = new Random(options.seed ?? DEFAULT_SEED);
  const profiles: Profile[] = [];

  for (let i = 0; i < count; i++) {
    const constitutionId = FAKE_ID_FLOOR + i;
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    const classYear = rng.int(1958, CURRENT_YEAR);

    // Older brothers are likelier to have passed away; blends ~6% overall.
    const age = CURRENT_YEAR - classYear;
    const deceased = rng.chance(Math.min(0.35, Math.max(0, (age - 35) * 0.012)));

    const place = rng.pick(PLACES);

    // ~5% have no email on file at all; deceased records carry no live email.
    const hasEmail = !deceased && rng.chance(0.95);
    const email = hasEmail ? emailFor(firstName, lastName, constitutionId) : null;

    profiles.push({
      id: `fake-${constitutionId}`,
      constitutionId,
      // Phase 2 recomputes this per the real Canonical Name rules (D15).
      canonicalName: `${firstName} ${lastName}`,
      firstName,
      lastName,
      classYear,
      email,
      city: place.city,
      state: place.state,
      country: place.country,
      deceased,
      // ~3% of living brothers choose to be unlisted (D124).
      unlisted: !deceased && rng.chance(0.03),
      // Deceased records force the email flags off (D49); otherwise mostly on.
      allowDirectoryEmail: hasEmail && rng.chance(0.88),
      // ~40% of living brothers have uploaded a headshot.
      headshotVersion: !deceased && rng.chance(0.4) ? 1 : null,
    });
  }

  return profiles;
}
