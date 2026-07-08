import {
  type Address,
  type DeceasedInfo,
  type EmergencyContact,
  FAKE_ID_FLOOR,
  type Link,
  type PrivacyFlags,
  type Profile,
} from "@pbe/shared";
import {
  FIRST_NAMES,
  LAST_NAMES,
  MUG_ADJECTIVES,
  MUG_NOUNS,
  MUG_SINGLE_WORDS,
  PLACES,
} from "./fixtures.js";
import { Random } from "./prng.js";

/**
 * The deterministic seeded fake-data generator (DECISIONS D65). Produces
 * obviously-fake profiles that span the full feature space of the Phase-2a
 * schema (DATABASE-SCHEMA §3): living and deceased (with both the full-date and
 * year-only death forms, D122), listed / unlisted / de-brothered, every
 * privacy-toggle combination, US/CA coded addresses versus international
 * free-text ones, single and double majors, big/little-brother trees, emergency
 * contacts, links, staff notes, and verified / stale / unverified states. Same
 * options in → byte-identical profiles out (no wall-clock, no Math.random).
 *
 * Every record validates against the shared `validateProfile` rules — asserted
 * by the generator's test — so the dataset is always a legal database.
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

// The lowest fake Constitution ID now lives in @pbe/shared (OFC-83), re-exported
// here so existing importers (and the generator's own test) keep one source.
export { FAKE_ID_FLOOR };

const CURRENT_YEAR = 2026;

/**
 * A deliberately planted **Canonical Name collision** (DATABASE-SCHEMA §5.1,
 * D15): the first {@link COLLISION_COUNT} records are forced to share an
 * identical first name, last name, AND class year, so the directory must
 * disambiguate **both** of them by appending their Constitution ID — e.g.
 * `William Evan '19 (#5001)` and `William Evan '19 (#5002)`. Without this, a
 * collision only ever arises by random chance, which leaves the disambiguation
 * path effectively untested. The planted brothers are also forced living,
 * listed, and not de-brothered so both stay visible to every viewing role.
 */
export const COLLISION_IDENTITY = {
  firstName: "William",
  lastName: "Evan",
  classYear: 2019,
} as const;
export const COLLISION_COUNT = 2;

/**
 * The small course-code pool the fake `majors` are drawn from. These are the
 * codes the generated dataset uses; the test validates against exactly this set.
 */
export const FAKE_MAJOR_CODES: readonly string[] = [
  "6-3",
  "6-2",
  "6-1",
  "8",
  "18",
  "2",
  "10",
  "15",
  "16",
  "7",
  "21",
  "14",
] as const;

/** A fixed epoch so generated timestamps are deterministic (no wall-clock). */
const BASE_EPOCH_MS = Date.UTC(2024, 0, 1);

function timestampFrom(rng: Random): string {
  // A point within roughly the last two years, derived from the PRNG.
  return new Date(BASE_EPOCH_MS + rng.int(0, 730) * 86_400_000).toISOString();
}

function isoDate(year: number, rng: Random): string {
  const month = String(rng.int(1, 12)).padStart(2, "0");
  const day = String(rng.int(1, 28)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emailFor(first: string, last: string, id: number, suffix = ""): string {
  const local = `${first}.${last}.${id}${suffix}`.toLowerCase().replace(/[^a-z0-9.+-]/gu, "");
  return `${local}@example.test`;
}

function fakePhone(rng: Random): string {
  // A reserved 555-01xx number, never a real line.
  return `+1 ${rng.int(201, 989)}-555-0${String(rng.int(100, 199))}`;
}

/** Generational suffixes occasionally appended to a full legal name. */
const NAME_SUFFIXES = ["Jr.", "Sr.", "II", "III", "IV"];

function makeName(rng: Random): {
  firstName: string;
  lastName: string;
  middleName?: string;
  mugName?: string;
} {
  const firstName = rng.pick(FIRST_NAMES);
  // ~12% carry a hyphenated surname to exercise tokenization and phonetic search.
  const lastName = rng.chance(0.12)
    ? `${rng.pick(LAST_NAMES)}-${rng.pick(LAST_NAMES)}`
    : rng.pick(LAST_NAMES);
  const name: { firstName: string; lastName: string; middleName?: string; mugName?: string } = {
    firstName,
    lastName,
  };
  if (rng.chance(0.4)) {
    name.middleName = rng.pick(FIRST_NAMES);
  }
  // ~35% carry a whimsical mug name (the house nickname), so the field is well
  // populated for testing Name Search over it — single words and short phrases,
  // unrelated to the real name (§5.6.3/D35).
  if (rng.chance(0.35)) {
    name.mugName = makeMugName(rng);
  }
  return name;
}

/**
 * A whimsical, name-unrelated mug name (D35 examples "Hilbert Space Pilot",
 * "Lissajous Figure"): a single word, an Adjective+Noun, or an Adjective+Word+Noun
 * three-word phrase — so multi-word mug-name search has data to exercise.
 */
function makeMugName(rng: Random): string {
  const roll = rng.float();
  if (roll < 0.4) {
    return rng.pick(MUG_SINGLE_WORDS);
  }
  if (roll < 0.75) {
    return `${rng.pick(MUG_ADJECTIVES)} ${rng.pick(MUG_NOUNS)}`;
  }
  return `${rng.pick(MUG_ADJECTIVES)} ${rng.pick(MUG_SINGLE_WORDS)} ${rng.pick(MUG_NOUNS)}`;
}

function makeAddress(rng: Random): Address {
  const place = rng.pick(PLACES);
  const address: Address = {
    street1: `${rng.int(1, 9999)} ${rng.pick(LAST_NAMES)} St`,
    city: place.city,
    postalCode: String(rng.int(10000, 99999)),
    country: place.country,
  };
  if (place.state !== null) {
    address.stateProvince = place.state;
  }
  if (rng.chance(0.2)) {
    address.street2 = `Apt ${rng.int(1, 40)}`;
  }
  return address;
}

function makePrivacy(rng: Random): PrivacyFlags {
  // Reachability toggles default-on, the two third-party toggles default-off
  // (D93), but each is independently varied so the dataset spans the combos.
  return {
    shareEmail: rng.chance(0.85),
    sharePhone: rng.chance(0.8),
    shareAddress: rng.chance(0.8),
    shareEmergency: rng.chance(0.2),
    shareSpousePartner: rng.chance(0.25),
  };
}

function makeMajors(rng: Random): string[] | undefined {
  const roll = rng.float();
  if (roll < 0.15) {
    return undefined; // no major on file
  }
  const primary = rng.pick(FAKE_MAJOR_CODES);
  if (roll < 0.35) {
    // Double major — pick a distinct second code, primary first.
    let second = rng.pick(FAKE_MAJOR_CODES);
    while (second === primary) {
      second = rng.pick(FAKE_MAJOR_CODES);
    }
    return [primary, second];
  }
  return [primary];
}

function makeLinks(rng: Random): Link[] | undefined {
  if (!rng.chance(0.3)) {
    return undefined;
  }
  const links: Link[] = [{ label: "LinkedIn", url: "https://www.linkedin.com/in/example" }];
  if (rng.chance(0.4)) {
    links.push({ label: "Personal site", url: "https://example.test/me" });
  }
  return links;
}

function makeEmergencyContacts(rng: Random): EmergencyContact[] | undefined {
  const roll = rng.float();
  if (roll < 0.65) {
    return undefined;
  }
  const contacts: EmergencyContact[] = [
    { name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`, phone: fakePhone(rng) },
  ];
  if (roll > 0.9) {
    contacts.push({
      name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
      phone: fakePhone(rng),
    });
  }
  return contacts;
}

function makeDeceased(rng: Random, classYear: number | null): DeceasedInfo {
  const deceased: DeceasedInfo = { isDeceased: true };
  const birthBase = classYear ?? rng.int(1936, 1990);
  const birthYear = birthBase - rng.int(18, 24);
  if (rng.chance(0.7)) {
    deceased.birthYear = birthYear;
  }
  const deathYear = Math.min(CURRENT_YEAR, birthYear + rng.int(40, 88));
  // The two death forms are mutually exclusive (D122): a full date OR a year.
  if (rng.chance(0.6)) {
    deceased.dateOfDeath = isoDate(deathYear, rng);
  } else {
    deceased.deathYear = deathYear;
  }
  if (rng.chance(0.3)) {
    deceased.obituaryUrl = "https://example.test/obituary";
  }
  if (rng.chance(0.2)) {
    deceased.inMemoriamUrl = "https://example.test/in-memoriam";
  }
  return deceased;
}

export function generateProfiles(options: GenerateOptions = {}): Profile[] {
  const count = options.count ?? DEFAULT_COUNT;
  const rng = new Random(options.seed ?? DEFAULT_SEED);
  const profiles: Profile[] = [];

  for (let i = 0; i < count; i++) {
    const id = FAKE_ID_FLOOR + i;
    // The first COLLISION_COUNT records are planted with a shared identity to
    // guarantee a Canonical Name collision the directory must disambiguate.
    const planted = i < COLLISION_COUNT;
    const generated = makeName(rng);
    const { middleName, mugName } = generated;
    const firstName = planted ? COLLISION_IDENTITY.firstName : generated.firstName;
    const lastName = planted ? COLLISION_IDENTITY.lastName : generated.lastName;

    // ~3% unknown class year (null), else a plausible graduation year. The
    // planted pair shares a fixed year so its members render an identical name.
    const randomYear = rng.chance(0.03) ? null : rng.int(1958, CURRENT_YEAR);
    const classYear = planted ? COLLISION_IDENTITY.classYear : randomYear;

    const age = classYear === null ? 40 : CURRENT_YEAR - classYear;
    // `&& !planted` keeps the planted pair living/listed without skipping the
    // draw, so the PRNG stream — and every other record — stays byte-stable.
    const isDeceased = rng.chance(Math.min(0.35, Math.max(0, (age - 35) * 0.012))) && !planted;
    // De-brothering is rare and orthogonal to everything else (D115).
    const isDebrothered = rng.chance(0.005) && !planted;

    const lastModified = timestampFrom(rng);

    const profile: Profile = {
      id,
      firstName,
      lastName,
      classYear,
      deceased: isDeceased ? makeDeceased(rng, classYear) : { isDeceased: false },
      debrothered: isDebrothered
        ? { isDebrothered: true, debrotheredAt: timestampFrom(rng) }
        : { isDebrothered: false },
      hasHeadshot: false,
      privacy: makePrivacy(rng),
      // ~3% of living brothers choose to be unlisted (D124); not deceased ones.
      // The planted collision pair is forced listed (the draw is still spent).
      unlisted: !isDeceased && rng.chance(0.03) && !planted,
      // Deceased forces the newsletter flag off (D49).
      allowNewsletterEmail: !isDeceased && rng.chance(0.9),
      allowShareWithMITAA: rng.chance(0.5),
      lastModified,
      newsletterConsentChangedAt: lastModified,
    };

    if (middleName !== undefined) profile.middleName = middleName;
    if (mugName !== undefined) profile.mugName = mugName;

    // ~70% carry a recorded full/legal name (first [middle] last [suffix]),
    // distinct from the constructed Canonical Name, so the Directory's Full Name
    // column has real data to display.
    if (rng.chance(0.7)) {
      const mid = middleName ?? rng.pick(FIRST_NAMES);
      const suffix = rng.chance(0.1) ? ` ${rng.pick(NAME_SUFFIXES)}` : "";
      profile.fullLegalName = `${firstName} ${mid} ${lastName}${suffix}`;
    }

    // ~5% of living brothers have no email; deceased records carry none.
    if (!isDeceased && rng.chance(0.95)) {
      profile.email = emailFor(firstName, lastName, id);
      if (rng.chance(0.15)) {
        profile.alternateEmail = emailFor(firstName, lastName, id, ".alt");
      }
    }
    if (rng.chance(0.7)) profile.phone = fakePhone(rng);
    if (rng.chance(0.75)) profile.address = makeAddress(rng);

    const emergencyContacts = makeEmergencyContacts(rng);
    if (emergencyContacts !== undefined) profile.emergencyContacts = emergencyContacts;
    if (rng.chance(0.6)) profile.employerName = `${rng.pick(LAST_NAMES)} Labs`;
    if (rng.chance(0.6)) profile.jobTitle = "Engineer";
    if (!isDeceased && rng.chance(0.4))
      profile.spousePartnerName = `${rng.pick(FIRST_NAMES)} ${lastName}`;

    const majors = makeMajors(rng);
    if (majors !== undefined) profile.majors = majors;
    const links = makeLinks(rng);
    if (links !== undefined) profile.links = links;

    // Big Brother points to an already-generated (lower-id) brother, so the tree
    // is acyclic by construction and the reference always exists.
    if (i > 0 && rng.chance(0.5)) {
      profile.bigBrotherId = FAKE_ID_FLOOR + rng.int(0, i - 1);
    }

    // ~40% of living brothers have a headshot; the version is an opaque token (R16).
    if (!isDeceased && rng.chance(0.4)) {
      profile.hasHeadshot = true;
      profile.headshotVersion = `v${rng.int(1, 5)}`;
    }

    // Verification: ~50% verified (recent or stale), the rest unverified. Frozen
    // for deceased records (D28/D48), so those are left unverified.
    if (!isDeceased && rng.chance(0.5)) {
      const verifyYear = rng.chance(0.6) ? rng.int(2025, CURRENT_YEAR) : rng.int(2020, 2024);
      profile.lastVerifiedDate = isoDate(verifyYear, rng);
      profile.verifiedBy = FAKE_ID_FLOOR + rng.int(0, Math.max(0, count - 1));
    }

    if (rng.chance(0.15)) profile.adminNote = "Staff note: confirmed mailing address by phone.";
    // Most living brothers are Ghost members; the id is an opaque backend token.
    if (!isDebrothered && rng.chance(0.9)) profile.ghostMemberId = `ghost-${id}`;

    profiles.push(profile);
  }

  return profiles;
}
