/**
 * The genesis conversion (Phase 8 / OFC-341): the merged Constitution-roster +
 * MITAA + Ghost dataset, as one CSV, into a **restore snapshot** — the envelope
 * `src/tools/restore.ts` already knows how to validate and write.
 *
 * WHY A SNAPSHOT AND NOT A LOADER. The initial bulk write was designed as its own
 * tool (PRE-LAUNCH-TOOLS §A), but by the time it was needed the offline restore
 * (D101) existed: structural validation (id + email uniqueness, Big Brother
 * integrity, cycle freedom), a dry run, a pre-write safety snapshot, a forensic
 * audit entry, and the tested Firestore write. Building a second bulk writer would
 * have duplicated the one already proven on staging, so the genesis load is
 * "convert, then restore". This module is the pure half — CSV text in, snapshot
 * collections plus a report out — so every mapping rule is unit-testable against
 * the fake exemplar space without a real row. `csv-to-snapshot.ts` is the I/O shell.
 *
 * ⚠ The INPUT is real member PII. It never enters this PUBLIC repo — not as a
 * fixture, not in a test, not in a log line. Tests use James Smyth '84 (#5247).
 *
 * MAPPING RULES that are not obvious from the column names:
 *   - `privacy` is `{ ...DEFAULT_PRIVACY }` — the shared default, never a hand-
 *     written block (D163's cutover obligation: a loader writing `false` would make
 *     the D163 reversal a silent no-op for every real brother).
 *   - `role` is written ONLY for the ids passed as admins; everyone else is a
 *     brother by omission (OFC-238; DATABASE-SCHEMA §3.3).
 *   - A deceased brother gets `allowNewsletterEmail: false` (the schema forces it).
 *   - `fullLegalName` is set only when the source "Full Name" differs from the
 *     first/middle/last join — it is where suffixes and go-by first names live.
 *   - `Course` may list several codes ("6-3, 15"); each must be a known code
 *     (`MAJOR_CODES`); unknown ones are dropped WITH a warning, primary stays first.
 *   - Dates arrive as either `YYYY` or `YYYY-M-D`; a full date maps to
 *     `dateOfDeath`, a bare year to `deathYear` (mutually exclusive, D122).
 *   - A US address carries `country: "US"` explicitly; a foreign one maps the
 *     source country NAME to its ISO alpha-2 code, and the "Foreign City" field
 *     (which often carries a postcode) lands verbatim in `city`.
 *   - The 120-char short-text cap (`MAX_SHORT_TEXT_LENGTH`) is enforced by
 *     truncating at a word boundary WITH a warning — the API rejects rather than
 *     truncates, but a loader that refuses a whole roster over one long Sports
 *     line helps nobody; the warning names the row so it can be tidied in-app.
 *   - Every profile is run through `validateProfile` with `requireRequired`; any
 *     issue is an ERROR and the caller must not write the snapshot.
 */
import {
  type Address,
  DEFAULT_PRIVACY,
  type DeceasedInfo,
  MAJOR_CODES,
  MAX_SHORT_TEXT_LENGTH,
  type Profile,
  type Role,
  isCountryCode,
  isSubdivisionCode,
  normalizeEmail,
  normalizePhone,
  validateProfile,
} from "@pbe/shared";
import type { BackupData, CollectionSnapshot } from "../data/backup.js";

/** The columns the genesis CSV must carry, by exact header text. */
export const REQUIRED_COLUMNS = [
  "Const ID",
  "Full Name",
  "First Name",
  "Middle Name",
  "Last Name",
  "Class",
  "Email",
  "Alternate Email",
  "Mugname",
  "Nickname",
  "Big Brother ID",
  "Course",
  "Debrothered",
  "Deceased",
  "Date of Birth",
  "Date of Death",
  "Obituary",
  "Sports",
  "Interests",
  "Addr Line 1",
  "Addr Line 2",
  "Addr City",
  "Addr State",
  "Addr Zip",
  "Addr Foreign City",
  "Addr Foreign Country",
  "Phone",
  "Company",
  "Job Title",
] as const;

type Column = (typeof REQUIRED_COLUMNS)[number];

/**
 * A profile as the genesis load WRITES it: `role` is stored only for admins and
 * managers (DATABASE-SCHEMA §3.3 — an omitted document is a `brother`, normalised
 * at hydration), whereas the domain `Profile` type carries it always.
 */
export type GenesisProfile = Omit<Profile, "role"> & { role?: Role };
type Row = Record<Column, string>;

/** One line of the conversion report. `error` means the snapshot must not be written. */
export interface ConversionIssue {
  readonly severity: "error" | "warning";
  /** Constitution ID of the row, or 0 for a file-level issue. */
  readonly id: number;
  readonly field: string;
  readonly message: string;
}

export interface ConversionOptions {
  /** Ids that receive `role: "admin"`. Everyone else is a brother by omission. */
  readonly adminIds?: readonly number[];
  /** `headshotVersion` per id; presence sets `hasHeadshot`. */
  readonly headshotVersions?: ReadonlyMap<number, string>;
  /** The `lastModified` / `newsletterConsentChangedAt` stamp (ISO 8601). */
  readonly now: string;
}

export interface ConversionResult {
  readonly collections: BackupData;
  readonly issues: ConversionIssue[];
  /** Counts for the operator's eyes. */
  readonly stats: {
    readonly rows: number;
    readonly deceased: number;
    readonly debrothered: number;
    readonly withEmail: number;
    readonly withAddress: number;
    readonly withHeadshot: number;
    readonly admins: number;
  };
}

// --- CSV ---------------------------------------------------------------------

/**
 * Parse RFC-4180-style CSV: double-quoted fields, `""` escapes, embedded newlines
 * inside quotes, CRLF or LF line ends, and a UTF-8 BOM. Hand-rolled because the
 * dependency it would replace is bigger than this function.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop a trailing fully-empty line (a file ending in "\n" yields one).
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function toRows(text: string, issues: ConversionIssue[]): Row[] {
  const table = parseCsv(text);
  const header = table[0];
  if (header === undefined) {
    issues.push({ severity: "error", id: 0, field: "file", message: "The CSV is empty." });
    return [];
  }
  const index = new Map(header.map((name, i) => [name.trim(), i]));
  for (const column of REQUIRED_COLUMNS) {
    if (!index.has(column)) {
      issues.push({
        severity: "error",
        id: 0,
        field: "file",
        message: `Missing column "${column}".`,
      });
    }
  }
  if (issues.length > 0) {
    return [];
  }
  return table.slice(1).map((cells) => {
    const row = {} as Row;
    for (const column of REQUIRED_COLUMNS) {
      row[column] = (cells[index.get(column) as number] ?? "").trim();
    }
    return row;
  });
}

// --- Field helpers ------------------------------------------------------------

/** Source country names → ISO 3166-1 alpha-2. Extend as the roster needs. */
export const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  scotland: "GB",
  canada: "CA",
  "hong kong": "HK",
  singapore: "SG",
  switzerland: "CH",
  italy: "IT",
  germany: "DE",
  taiwan: "TW",
  norway: "NO",
  colombia: "CO",
  spain: "ES",
  netherlands: "NL",
  "the netherlands": "NL",
  curacao: "CW",
  curaçao: "CW",
  israel: "IL",
  "saudi arabia": "SA",
  france: "FR",
  croatia: "HR",
  japan: "JP",
  mexico: "MX",
  india: "IN",
  australia: "AU",
  ireland: "IE",
  china: "CN",
  "south korea": "KR",
  korea: "KR",
  brazil: "BR",
  sweden: "SE",
  denmark: "DK",
  belgium: "BE",
  austria: "AT",
  "new zealand": "NZ",
  "united arab emirates": "AE",
  "puerto rico": "PR",
};

const YEAR_RE = /^(\d{4})$/u;
const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u;

/** `YYYY` → { year }, `YYYY-M-D` → { date: "YYYY-MM-DD", year }, else null. */
export function parseLooseDate(value: string): { year: number; date?: string } | null {
  const year = YEAR_RE.exec(value);
  if (year?.[1]) {
    return { year: Number(year[1]) };
  }
  const full = DATE_RE.exec(value);
  if (full?.[1] && full[2] && full[3]) {
    const y = Number(full[1]);
    const m = full[2].padStart(2, "0");
    const d = full[3].padStart(2, "0");
    return { year: y, date: `${y}-${m}-${d}` };
  }
  return null;
}

/** Truncate at the last word boundary within the cap; returns [text, truncated?]. */
export function capShortText(value: string): [string, boolean] {
  if (value.length <= MAX_SHORT_TEXT_LENGTH) {
    return [value, false];
  }
  const head = value.slice(0, MAX_SHORT_TEXT_LENGTH);
  const cut = head.lastIndexOf(" ");
  return [(cut > MAX_SHORT_TEXT_LENGTH / 2 ? head.slice(0, cut) : head).trimEnd(), true];
}

function optional(value: string): string | undefined {
  return value === "" ? undefined : value;
}

// --- Row → Profile -------------------------------------------------------------

function convertMajors(
  course: string,
  id: number,
  issues: ConversionIssue[],
): string[] | undefined {
  if (course === "") {
    return undefined;
  }
  const codes: string[] = [];
  for (const raw of course.split(",")) {
    const code = raw.trim();
    if (code === "") {
      continue;
    }
    if (!MAJOR_CODES.includes(code)) {
      issues.push({
        severity: "warning",
        id,
        field: "majors",
        message: `Unknown course code "${code}" dropped.`,
      });
      continue;
    }
    if (!codes.includes(code)) {
      codes.push(code);
    }
  }
  return codes.length > 0 ? codes : undefined;
}

function convertDeceased(row: Row, id: number, issues: ConversionIssue[]): DeceasedInfo {
  if (row.Deceased === "") {
    if (row["Date of Birth"] !== "" || row["Date of Death"] !== "") {
      issues.push({
        severity: "warning",
        id,
        field: "deceased",
        message: "Birth/death date on a living brother dropped (deceased-only fields).",
      });
    }
    return { isDeceased: false };
  }
  const info: DeceasedInfo = { isDeceased: true };
  if (row["Date of Birth"] !== "") {
    const born = parseLooseDate(row["Date of Birth"]);
    if (born) {
      info.birthYear = born.year;
    } else {
      issues.push({
        severity: "warning",
        id,
        field: "deceased.birthYear",
        message: `Unparseable date of birth "${row["Date of Birth"]}" dropped.`,
      });
    }
  }
  if (row["Date of Death"] !== "") {
    const died = parseLooseDate(row["Date of Death"]);
    if (died?.date) {
      info.dateOfDeath = died.date;
    } else if (died) {
      info.deathYear = died.year;
    } else {
      issues.push({
        severity: "warning",
        id,
        field: "deceased.dateOfDeath",
        message: `Unparseable date of death "${row["Date of Death"]}" dropped.`,
      });
    }
  }
  if (row.Obituary !== "") {
    if (/^https?:\/\//u.test(row.Obituary)) {
      info.obituaryUrl = row.Obituary;
    } else {
      issues.push({
        severity: "warning",
        id,
        field: "deceased.obituaryUrl",
        message: "Obituary is not an http(s) URL; dropped.",
      });
    }
  }
  return info;
}

function convertAddress(row: Row, id: number, issues: ConversionIssue[]): Address | undefined {
  const foreignCountry = row["Addr Foreign Country"];
  const address: Address = {};
  const street1 = optional(row["Addr Line 1"]);
  const street2 = optional(row["Addr Line 2"]);
  if (street1) {
    address.street1 = street1;
  }
  if (street2) {
    address.street2 = street2;
  }
  if (foreignCountry === "") {
    const city = optional(row["Addr City"]);
    const state = optional(row["Addr State"]);
    const zip = optional(row["Addr Zip"]);
    if (city) {
      address.city = city;
    }
    if (state) {
      if (isSubdivisionCode("US", state)) {
        address.stateProvince = state.toUpperCase();
      } else {
        issues.push({
          severity: "warning",
          id,
          field: "address.stateProvince",
          message: `Unknown US state "${state}" dropped.`,
        });
      }
    }
    if (zip) {
      if (/^\d{5}(-\d{4})?$/u.test(zip)) {
        address.postalCode = zip;
      } else {
        issues.push({
          severity: "warning",
          id,
          field: "address.postalCode",
          message: `Non-ZIP postal code "${zip}" dropped.`,
        });
      }
    }
    if (Object.keys(address).length === 0) {
      return undefined;
    }
    address.country = "US";
    return address;
  }
  const code = COUNTRY_NAMES[foreignCountry.toLowerCase()];
  if (code === undefined || !isCountryCode(code)) {
    issues.push({
      severity: "warning",
      id,
      field: "address.country",
      message: `Unmapped country "${foreignCountry}" — address written without a country.`,
    });
  } else {
    address.country = code;
  }
  const foreignCity = optional(row["Addr Foreign City"]) ?? optional(row["Addr City"]);
  if (foreignCity) {
    address.city = foreignCity;
  }
  return Object.keys(address).length === 0 ? undefined : address;
}

function shortText(
  value: string,
  id: number,
  field: string,
  issues: ConversionIssue[],
): string | undefined {
  if (value === "") {
    return undefined;
  }
  const [text, truncated] = capShortText(value);
  if (truncated) {
    issues.push({
      severity: "warning",
      id,
      field,
      message: `Truncated to ${MAX_SHORT_TEXT_LENGTH} characters at a word boundary; tidy in-app.`,
    });
  }
  return text;
}

function convertNames(row: Row, profile: GenesisProfile): void {
  const middle = optional(row["Middle Name"]);
  if (middle) {
    profile.middleName = middle;
  }
  const joined = [row["First Name"], row["Middle Name"], row["Last Name"]]
    .filter((part) => part !== "")
    .join(" ");
  if (row["Full Name"] !== "" && row["Full Name"] !== joined) {
    profile.fullLegalName = row["Full Name"];
  }
  const mug = optional(row.Mugname);
  if (mug) {
    profile.mugName = mug;
  }
  const nick = optional(row.Nickname);
  if (nick) {
    profile.nickname = nick;
  }
}

function convertContact(row: Row, profile: GenesisProfile, issues: ConversionIssue[]): void {
  if (row.Email !== "") {
    profile.email = normalizeEmail(row.Email);
    if (row["Alternate Email"] !== "") {
      const alternate = normalizeEmail(row["Alternate Email"]);
      if (alternate === profile.email) {
        issues.push({
          severity: "warning",
          id: profile.id,
          field: "alternateEmail",
          message: "Alternate email equals the primary; dropped (one address, one slot).",
        });
      } else {
        profile.alternateEmail = alternate;
      }
    }
  } else if (row["Alternate Email"] !== "") {
    issues.push({
      severity: "warning",
      id: profile.id,
      field: "alternateEmail",
      message: "Alternate email without a primary email dropped.",
    });
  }
  const phone = optional(row.Phone);
  if (phone) {
    if (normalizePhone(phone) === null) {
      issues.push({
        severity: "warning",
        id: profile.id,
        field: "phone",
        message: "Phone is not in a recognised format (international needs a leading +); dropped.",
      });
    } else {
      profile.phone = phone;
    }
  }
  const address = convertAddress(row, profile.id, issues);
  if (address) {
    profile.address = address;
  }
}

function convertWorkAndInterests(
  row: Row,
  profile: GenesisProfile,
  issues: ConversionIssue[],
): void {
  const employer = optional(row.Company);
  if (employer) {
    profile.employerName = employer;
  }
  const title = optional(row["Job Title"]);
  if (title) {
    profile.jobTitle = title;
  }
  const majors = convertMajors(row.Course, profile.id, issues);
  if (majors) {
    profile.majors = majors;
  }
  const sports = shortText(row.Sports, profile.id, "sports", issues);
  if (sports) {
    profile.sports = sports;
  }
  const activities = shortText(row.Interests, profile.id, "activities", issues);
  if (activities) {
    profile.activities = activities;
  }
}

function convertRelationsAndFlags(
  row: Row,
  profile: GenesisProfile,
  options: ConversionOptions,
  issues: ConversionIssue[],
): void {
  if (row["Big Brother ID"] !== "") {
    const big = Number(row["Big Brother ID"]);
    if (Number.isInteger(big) && big > 0) {
      profile.bigBrotherId = big;
    } else {
      issues.push({
        severity: "warning",
        id: profile.id,
        field: "bigBrotherId",
        message: `Big Brother ID "${row["Big Brother ID"]}" is not an id; dropped.`,
      });
    }
  }
  const version = options.headshotVersions?.get(profile.id);
  if (version !== undefined) {
    profile.hasHeadshot = true;
    profile.headshotVersion = version;
  }
  if (options.adminIds?.includes(profile.id)) {
    profile.role = "admin";
  }
}

function convertRow(
  row: Row,
  options: ConversionOptions,
  issues: ConversionIssue[],
): GenesisProfile | null {
  const id = Number(row["Const ID"]);
  if (!Number.isInteger(id) || id <= 0) {
    issues.push({
      severity: "error",
      id: 0,
      field: "id",
      message: `Row with Const ID "${row["Const ID"]}" is not a positive integer.`,
    });
    return null;
  }
  if (row["First Name"] === "" && row["Last Name"] === "") {
    issues.push({
      severity: "warning",
      id,
      field: "firstName",
      message: `No first or last name (Full Name "${row["Full Name"]}"); row SKIPPED — add in-app.`,
    });
    return null;
  }
  const classYear = /^\d{4}$/u.test(row.Class) ? Number(row.Class) : null;
  if (classYear === null && row.Class !== "") {
    issues.push({
      severity: "warning",
      id,
      field: "classYear",
      message: `Class "${row.Class}" is not a 4-digit year; written as unknown.`,
    });
  }
  const deceased = convertDeceased(row, id, issues);
  const profile: GenesisProfile = {
    id,
    firstName: row["First Name"],
    lastName: row["Last Name"],
    classYear,
    deceased,
    debrothered:
      row.Debrothered === ""
        ? { isDebrothered: false }
        : { isDebrothered: true, debrotheredAt: options.now },
    hasHeadshot: false,
    privacy: { ...DEFAULT_PRIVACY },
    unlisted: false,
    allowNewsletterEmail: !deceased.isDeceased,
    allowShareWithMITAA: false,
    willingToMentor: false,
    lastModified: options.now,
    newsletterConsentChangedAt: options.now,
  };
  convertNames(row, profile);
  convertContact(row, profile, issues);
  convertWorkAndInterests(row, profile, issues);
  convertRelationsAndFlags(row, profile, options, issues);
  return profile;
}

// --- Entry point ----------------------------------------------------------------

/** Convert the genesis CSV text into restore collections plus a report. */
export function convertGenesisCsv(text: string, options: ConversionOptions): ConversionResult {
  const issues: ConversionIssue[] = [];
  const rows = toRows(text, issues);
  const profiles: CollectionSnapshot[] = [];
  const seen = new Set<number>();
  let deceased = 0;
  let debrothered = 0;
  let withEmail = 0;
  let withAddress = 0;
  let withHeadshot = 0;
  let admins = 0;

  for (const row of rows) {
    const profile = convertRow(row, options, issues);
    if (profile === null) {
      continue;
    }
    if (seen.has(profile.id)) {
      issues.push({
        severity: "error",
        id: profile.id,
        field: "id",
        message: "Duplicate Constitution ID.",
      });
      continue;
    }
    seen.add(profile.id);
    const validation = validateProfile(profile, { requireRequired: true });
    for (const issue of validation.issues) {
      issues.push({
        severity: "error",
        id: profile.id,
        field: issue.field,
        message: issue.message,
      });
    }
    if (profile.deceased.isDeceased) {
      deceased++;
    }
    if (profile.debrothered.isDebrothered) {
      debrothered++;
    }
    if (profile.email) {
      withEmail++;
    }
    if (profile.address) {
      withAddress++;
    }
    if (profile.hasHeadshot) {
      withHeadshot++;
    }
    if (profile.role === "admin") {
      admins++;
    }
    profiles.push({ id: String(profile.id), data: profile as unknown as Record<string, unknown> });
  }

  // Big Brother references must land on a loaded id; restore refuses otherwise,
  // but naming the row here is friendlier than a validator rule number.
  for (const { data } of profiles) {
    const big = data.bigBrotherId;
    if (typeof big === "number" && !seen.has(big)) {
      issues.push({
        severity: "error",
        id: data.id as number,
        field: "bigBrotherId",
        message: `Big Brother #${big} is not in the roster.`,
      });
    }
  }
  for (const adminId of options.adminIds ?? []) {
    if (!seen.has(adminId)) {
      issues.push({
        severity: "error",
        id: adminId,
        field: "role",
        message: "Admin id is not in the roster.",
      });
    }
  }
  for (const id of options.headshotVersions?.keys() ?? []) {
    if (!seen.has(id)) {
      issues.push({
        severity: "warning",
        id,
        field: "hasHeadshot",
        message: "A headshot exists for an id that is not in the roster; ignored.",
      });
    }
  }

  return {
    collections: { profiles, users: [], config: [] },
    issues,
    stats: {
      rows: rows.length,
      deceased,
      debrothered,
      withEmail,
      withAddress,
      withHeadshot,
      admins,
    },
  };
}
