/**
 * The shared client/server validation module (DECISIONS D50): the single place
 * the field rules of DATABASE-SCHEMA §8 live, imported by both sides so the
 * client's fast-feedback validation and the server's authoritative validation
 * can never drift.
 *
 * The validator checks a **candidate record state**. For a create (`POST`) pass
 * the full record; for a partial edit (`PATCH`) pass the stored record merged
 * with the patch, so cross-field rules (e.g. `alternateEmail` requires `email`)
 * see the whole picture. Rules apply only to fields that are present, except the
 * required-field checks, which the caller enables with `requireRequired` on a
 * create. Issues carry the offending field's **name**, never its value (the
 * names-not-values discipline, D61).
 *
 * Structural rules that need the whole dataset — `id`/`email` uniqueness, the
 * big-brother existence/cycle check, `majors` membership when no vocabulary is
 * supplied — are noted inline and finalized on the write path (which holds the
 * in-memory dataset); this pure module does everything that does not.
 */

import { isCountryCode, isSubdivisionCode } from "./geo.js";
import type { Profile } from "./types.js";

export interface ValidationIssue {
  /** The offending field's dotted name (never its value — D61). */
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface ValidationContext {
  /**
   * The reference "current year" for the class-year and lifespan ranges.
   * Defaults to the real current year; overridable so tests are deterministic.
   */
  currentYear?: number;
  /**
   * When supplied, `majors` codes are validated against this vocabulary (the
   * `majors` collection's codes). When omitted, only structural rules (array,
   * non-empty, no duplicates) are checked and membership is left to the write
   * path (DATABASE-SCHEMA §8).
   */
  validMajorCodes?: ReadonlySet<string>;
  /**
   * Enforce presence of the always-required fields (`firstName`, `lastName`,
   * `classYear`). Set on a create, where the whole record is supplied; left off
   * for a partial edit, which only carries changed fields.
   */
  requireRequired?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PHONE_ALLOWED_RE = /^\+?[0-9().\-\s]+$/u;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;

const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

const MIN_CLASS_YEAR = 1890;
const CLASS_YEAR_FUTURE_MARGIN = 6;
const MIN_BIRTH_YEAR = 1850;
const MAX_LINKS = 5;
const MAX_EMERGENCY_CONTACTS = 2;

function currentYearOf(context: ValidationContext): number {
  return context.currentYear ?? new Date().getUTCFullYear();
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * Canonicalize a phone number to the one stored form (DECISIONS N35). A **NANP**
 * number (country code `+1`) is formatted `+1 (AAA) BBB-CCCC`; every other
 * international number is reduced to **E.164** (`+` then its digits, no
 * separators). A bare number with no `+` is assumed NANP — the default country
 * code, `+1` — when its length fits (10 digits, or 11 with a leading `1`);
 * otherwise it needs an explicit country code and is rejected. Returns `null` for
 * anything that isn't a usable number, so a single function serves both roles:
 * validation reads `null` as invalid, and the write path stores the non-null
 * canonical form.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "" || !PHONE_ALLOWED_RE.test(trimmed)) {
    return null;
  }
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/gu, "");
  if (digits.length === 0) {
    return null;
  }
  if (hasPlus) {
    // Explicit country code: `+1` + 10 digits is NANP; anything else is E.164.
    if (digits.startsWith("1") && digits.length === 11) {
      return formatNanp(digits.slice(1));
    }
    if (digits.length < E164_MIN_DIGITS || digits.length > E164_MAX_DIGITS) {
      return null;
    }
    return `+${digits}`;
  }
  // No country code: default to NANP (+1) when the length fits, else require one.
  if (digits.length === 10) {
    return formatNanp(digits);
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return formatNanp(digits.slice(1));
  }
  return null;
}

/** Format ten NANP digits as the canonical `+1 (AAA) BBB-CCCC`. */
function formatNanp(ten: string): string {
  return `+1 (${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

function isValidPhone(value: string): boolean {
  return normalizePhone(value) !== null;
}

/** A URL restricted to the strict http/https scheme allowlist (D107). */
function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/** A real `YYYY-MM-DD` calendar date (rejects e.g. 2026-02-31). */
function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value.trim());
  if (match === null) {
    return false;
  }
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Validate a candidate `Profile` state against DATABASE-SCHEMA §8. See the
 * module note for the create-vs-patch contract and the structural rules left to
 * the write path.
 */
export function validateProfile(
  input: Partial<Profile>,
  context: ValidationContext = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const currentYear = currentYearOf(context);

  // --- id ---
  if (input.id !== undefined && !isPositiveInteger(input.id)) {
    add("id", "Constitution ID must be a positive integer.");
  }

  // --- names (required) ---
  if (input.firstName !== undefined || context.requireRequired) {
    if (!isNonEmpty(input.firstName)) {
      add("firstName", "First name is required.");
    }
  }
  if (input.lastName !== undefined || context.requireRequired) {
    if (!isNonEmpty(input.lastName)) {
      add("lastName", "Last name is required.");
    }
  }

  // --- class year (required as value-or-null) ---
  if (input.classYear !== undefined || context.requireRequired) {
    const cy = input.classYear;
    if (cy !== null) {
      if (cy === undefined || !Number.isInteger(cy)) {
        add("classYear", "Class year must be a 4-digit year or unknown.");
      } else if (cy < MIN_CLASS_YEAR || cy > currentYear + CLASS_YEAR_FUTURE_MARGIN) {
        add(
          "classYear",
          `Class year must be between ${MIN_CLASS_YEAR} and ${currentYear + CLASS_YEAR_FUTURE_MARGIN}.`,
        );
      }
    }
  }

  // --- email / alternateEmail ---
  if (input.email !== undefined && !isValidEmail(input.email)) {
    add("email", "Enter a valid email address.");
  }
  if (input.alternateEmail !== undefined) {
    if (!isValidEmail(input.alternateEmail)) {
      add("alternateEmail", "Enter a valid email address.");
    }
    if (!isNonEmpty(input.email)) {
      add("alternateEmail", "An alternate email requires a primary email.");
    }
  }

  // --- phone ---
  if (input.phone !== undefined && !isValidPhone(input.phone)) {
    add("phone", "Enter a valid phone number.");
  }

  // --- address ---
  if (input.address !== undefined) {
    const { country, stateProvince } = input.address;
    if (country !== undefined && country !== "" && !isCountryCode(country)) {
      add("address.country", "Select a valid country.");
    }
    if (
      stateProvince !== undefined &&
      stateProvince !== "" &&
      !isSubdivisionCode(country, stateProvince)
    ) {
      add("address.stateProvince", "Select a valid state or province.");
    }
  }

  // --- emergencyContacts (max 2; per-contact email/phone) ---
  if (input.emergencyContacts !== undefined) {
    const contacts = input.emergencyContacts;
    if (contacts.length > MAX_EMERGENCY_CONTACTS) {
      add("emergencyContacts", `At most ${MAX_EMERGENCY_CONTACTS} emergency contacts.`);
    }
    contacts.forEach((contact, i) => {
      if (contact.email !== undefined && contact.email !== "" && !isValidEmail(contact.email)) {
        add(`emergencyContacts.${i}.email`, "Enter a valid email address.");
      }
      if (contact.phone !== undefined && contact.phone !== "" && !isValidPhone(contact.phone)) {
        add(`emergencyContacts.${i}.phone`, "Enter a valid phone number.");
      }
    });
  }

  // --- majors (array; no duplicates; non-empty codes; membership when supplied) ---
  if (input.majors !== undefined) {
    const majors = input.majors;
    const seen = new Set<string>();
    majors.forEach((code, i) => {
      if (!isNonEmpty(code)) {
        add(`majors.${i}`, "Major code must not be empty.");
        return;
      }
      if (seen.has(code)) {
        add(`majors.${i}`, "Duplicate major.");
      }
      seen.add(code);
      if (context.validMajorCodes !== undefined && !context.validMajorCodes.has(code)) {
        add(`majors.${i}`, "Unknown major code.");
      }
    });
  }

  // --- links (max 5; non-empty label; http/https url) ---
  if (input.links !== undefined) {
    const links = input.links;
    if (links.length > MAX_LINKS) {
      add("links", `At most ${MAX_LINKS} links.`);
    }
    links.forEach((link, i) => {
      if (!isNonEmpty(link.label)) {
        add(`links.${i}.label`, "Link label must not be empty.");
      }
      if (!isHttpUrl(link.url)) {
        add(`links.${i}.url`, "Link must be a valid http or https URL.");
      }
    });
  }

  // --- bigBrotherId (positive integer, not self; existence/cycle on write path) ---
  if (input.bigBrotherId !== undefined && input.bigBrotherId !== null) {
    if (!isPositiveInteger(input.bigBrotherId)) {
      add("bigBrotherId", "Big Brother must be a valid brother.");
    } else if (input.id !== undefined && input.bigBrotherId === input.id) {
      add("bigBrotherId", "A brother cannot be their own Big Brother.");
    }
  }

  // --- deceased sub-fields ---
  validateDeceased(input, currentYear, add);

  // --- verification date ---
  if (input.lastVerifiedDate !== undefined && !isValidIsoDate(input.lastVerifiedDate)) {
    add("lastVerifiedDate", "Verification date must be a valid YYYY-MM-DD date.");
  }

  return { ok: issues.length === 0, issues };
}

/** Deceased lifespan/date rules (D122) — split out for readability. */
function validateDeceased(
  input: Partial<Profile>,
  currentYear: number,
  add: (field: string, message: string) => void,
): void {
  const deceased = input.deceased;
  if (deceased === undefined) {
    return;
  }
  const onDeceasedRecord = deceased.isDeceased === true;

  if (deceased.dateOfDeath !== undefined && !isValidIsoDate(deceased.dateOfDeath)) {
    add("deceased.dateOfDeath", "Date of death must be a valid YYYY-MM-DD date.");
  }
  if (
    deceased.obituaryUrl !== undefined &&
    deceased.obituaryUrl !== "" &&
    !isHttpUrl(deceased.obituaryUrl)
  ) {
    add("deceased.obituaryUrl", "Obituary link must be a valid http or https URL.");
  }
  if (
    deceased.inMemoriamUrl !== undefined &&
    deceased.inMemoriamUrl !== "" &&
    !isHttpUrl(deceased.inMemoriamUrl)
  ) {
    add("deceased.inMemoriamUrl", "In Memoriam link must be a valid http or https URL.");
  }

  if (deceased.birthYear !== undefined) {
    if (!onDeceasedRecord) {
      add("deceased.birthYear", "Birth year applies only to a deceased brother.");
    } else if (
      !Number.isInteger(deceased.birthYear) ||
      deceased.birthYear < MIN_BIRTH_YEAR ||
      deceased.birthYear > currentYear
    ) {
      add("deceased.birthYear", `Birth year must be between ${MIN_BIRTH_YEAR} and ${currentYear}.`);
    }
  }

  if (deceased.deathYear !== undefined) {
    if (!onDeceasedRecord) {
      add("deceased.deathYear", "Death year applies only to a deceased brother.");
    } else if (deceased.dateOfDeath !== undefined) {
      // Mutually exclusive with a full date — the year is derived from the date (D122).
      add("deceased.deathYear", "Provide either a full date of death or a death year, not both.");
    } else if (!Number.isInteger(deceased.deathYear) || deceased.deathYear > currentYear) {
      add("deceased.deathYear", `Death year must be ${currentYear} or earlier.`);
    } else if (
      deceased.birthYear !== undefined &&
      Number.isInteger(deceased.birthYear) &&
      deceased.deathYear < deceased.birthYear
    ) {
      add("deceased.deathYear", "Death year cannot be before birth year.");
    }
  }
}
