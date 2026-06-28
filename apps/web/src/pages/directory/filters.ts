import { type Role, countryName, subdivisionName } from "@pbe/shared";
import type { DirectoryProfile } from "../../lib/types.js";

/**
 * The Directory's **structured filter model** (PRD §5.6.4, D38) — the typed
 * filters, their URL-serialisable shape, the numeric-grammar parser, and the
 * predicate they compose to. Kept pure (no React, no URL) so the composition is
 * unit-tested directly; `useDirectoryFilters` wires it to the URL and the panel.
 *
 * The governing rule is **filterable ⟺ visible** (D16/D38): a field is filterable
 * by a role exactly when that role may see it as a column. The staff-only filters
 * below are gated by the same predicate as their restricted columns; because
 * filtering runs over the already-projected dataset (D4/D5), an out-of-role filter
 * could never match hidden data anyway — this only keeps the UI honest.
 *
 * Composition: **OR within a field** (a comma list / multi-select means "any of
 * these") and **AND across fields**; the deceased default is AND-ed in by the
 * query engine, not here (D38).
 */

/** A tri-state presence/boolean filter: unset, or one of two values. */
export type PresenceFilter = "" | "has" | "missing";
export type BoolFilter = "" | "yes" | "no";
export type VerificationFilter = "" | "verified" | "never";

/** Every structured filter, in its URL-serialisable form (strings + string lists). */
export interface DirectoryFilters {
  /** Numeric grammar (comma lists + dash ranges): Class Year. */
  classYear: string;
  /** Numeric grammar: Constitution ID. */
  constitutionId: string;
  /** Multi-select (OR): course codes — matches ANY of a brother's majors. */
  major: string[];
  /** Multi-select (OR): ISO country codes. */
  country: string[];
  /** Multi-select (OR): state/province codes or free-text values. */
  stateProvince: string[];
  /** Substring (case-insensitive): City. */
  city: string;
  /** Staff-only — presence of an email / phone. */
  email: PresenceFilter;
  phone: PresenceFilter;
  /** Staff-only — the consent flags. */
  allowNewsletterEmail: BoolFilter;
  allowCommentReplyEmail: BoolFilter;
  allowShareWithMITAA: BoolFilter;
  /** Staff-only — verification state, plus an optional "not verified since" date. */
  verification: VerificationFilter;
  /** Staff-only — `YYYY-MM-DD`; when set, keep records last verified before it (stale). */
  verifiedBefore: string;
}

export const EMPTY_FILTERS: DirectoryFilters = {
  classYear: "",
  constitutionId: "",
  major: [],
  country: [],
  stateProvince: [],
  city: "",
  email: "",
  phone: "",
  allowNewsletterEmail: "",
  allowCommentReplyEmail: "",
  allowShareWithMITAA: "",
  verification: "",
  verifiedBefore: "",
};

/** The staff-only filter keys (manager/admin); gated like their restricted columns. */
const STAFF_FILTER_KEYS: readonly (keyof DirectoryFilters)[] = [
  "email",
  "phone",
  "allowNewsletterEmail",
  "allowCommentReplyEmail",
  "allowShareWithMITAA",
  "verification",
  "verifiedBefore",
];

/** Whether `role` may use the staff-only filters (the same gate as the restricted columns). */
export function canUseStaffFilters(role: Role): boolean {
  return role === "manager" || role === "admin";
}

/** True when no filter is set — used to keep a pristine view's URL clean. */
export function isEmptyFilters(filters: DirectoryFilters): boolean {
  return countActiveFilters(filters) === 0;
}

/** How many filter *fields* are currently constraining the view (for the panel badge). */
export function countActiveFilters(filters: DirectoryFilters): number {
  let n = 0;
  if (filters.classYear.trim()) n++;
  if (filters.constitutionId.trim()) n++;
  if (filters.major.length) n++;
  if (filters.country.length) n++;
  if (filters.stateProvince.length) n++;
  if (filters.city.trim()) n++;
  if (filters.email) n++;
  if (filters.phone) n++;
  if (filters.allowNewsletterEmail) n++;
  if (filters.allowCommentReplyEmail) n++;
  if (filters.allowShareWithMITAA) n++;
  if (filters.verification) n++;
  if (filters.verifiedBefore.trim()) n++;
  return n;
}

/** A parsed numeric-grammar input: the discrete values, the ranges, and any bad tokens. */
export interface NumericGrammar {
  values: number[];
  ranges: [number, number][];
  /** Tokens that didn't parse — surfaced inline rather than silently dropped (§5.6.4). */
  errors: string[];
  /** True when there is at least one usable value/range (so the filter is active). */
  active: boolean;
}

/**
 * Parse the numeric grammar: comma-separated integers and `lo-hi` closed ranges,
 * freely combined (e.g. `1980, 1985-1989, 1992`). Whitespace is tolerated; an
 * unparseable token is collected into `errors`. A reversed range (`1990-1980`) is
 * normalised. Closed ranges only (MVP).
 */
export function parseNumericGrammar(raw: string): NumericGrammar {
  const values: number[] = [];
  const ranges: [number, number][] = [];
  const errors: string[] = [];

  for (const rawToken of raw.split(",")) {
    const token = rawToken.trim();
    if (token === "") {
      continue;
    }
    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const lo = Number(rangeMatch[1]);
      const hi = Number(rangeMatch[2]);
      ranges.push(lo <= hi ? [lo, hi] : [hi, lo]);
      continue;
    }
    if (/^\d+$/.test(token)) {
      values.push(Number(token));
      continue;
    }
    errors.push(token);
  }

  return { values, ranges, errors, active: values.length > 0 || ranges.length > 0 };
}

/** Whether a number satisfies a parsed grammar (any value OR any range — OR-within). */
function numericMatches(grammar: NumericGrammar, value: number | null | undefined): boolean {
  if (value == null) {
    return false;
  }
  if (grammar.values.includes(value)) {
    return true;
  }
  return grammar.ranges.some(([lo, hi]) => value >= lo && value <= hi);
}

/**
 * Build the row predicate for a filter set. Each active field contributes an
 * AND-ed clause; an inactive field contributes nothing. Within a field, lists and
 * grammars are OR. Staff-only fields are honoured only for staff roles (a brother
 * cannot set them in the UI, and they would never match projected-away data).
 */
export function buildFilterPredicate(
  filters: DirectoryFilters,
  role: Role,
): (profile: DirectoryProfile) => boolean {
  const clauses: ((p: DirectoryProfile) => boolean)[] = [];

  const yearGrammar = parseNumericGrammar(filters.classYear);
  if (yearGrammar.active) {
    clauses.push((p) => numericMatches(yearGrammar, p.classYear ?? null));
  }

  const idGrammar = parseNumericGrammar(filters.constitutionId);
  if (idGrammar.active) {
    clauses.push((p) => numericMatches(idGrammar, p.id));
  }

  if (filters.major.length > 0) {
    const wanted = new Set(filters.major);
    // OR within: a brother matches if ANY of his majors is selected (§5.6.1).
    clauses.push((p) => (p.majors ?? []).some((code) => wanted.has(code)));
  }

  if (filters.country.length > 0) {
    const wanted = new Set(filters.country);
    clauses.push((p) => p.address?.country != null && wanted.has(p.address.country));
  }

  if (filters.stateProvince.length > 0) {
    const wanted = new Set(filters.stateProvince);
    clauses.push((p) => p.address?.stateProvince != null && wanted.has(p.address.stateProvince));
  }

  const city = filters.city.trim().toLocaleLowerCase();
  if (city !== "") {
    clauses.push((p) => (p.address?.city ?? "").toLocaleLowerCase().includes(city));
  }

  if (canUseStaffFilters(role)) {
    addStaffClauses(filters, clauses);
  }

  return (profile) => clauses.every((clause) => clause(profile));
}

/** The staff-only presence/boolean/verification clauses (PRD §5.6.4). */
function addStaffClauses(
  filters: DirectoryFilters,
  clauses: ((p: DirectoryProfile) => boolean)[],
): void {
  const presence = (value: PresenceFilter, has: (p: DirectoryProfile) => boolean) => {
    if (value === "has") {
      clauses.push(has);
    } else if (value === "missing") {
      clauses.push((p) => !has(p));
    }
  };
  presence(filters.email, (p) => Boolean(p.email));
  presence(filters.phone, (p) => Boolean(p.phone));

  const bool = (value: BoolFilter, read: (p: DirectoryProfile) => boolean | undefined) => {
    if (value === "yes") {
      clauses.push((p) => read(p) === true);
    } else if (value === "no") {
      clauses.push((p) => read(p) === false);
    }
  };
  bool(filters.allowNewsletterEmail, (p) => p.allowNewsletterEmail);
  bool(filters.allowCommentReplyEmail, (p) => p.allowCommentReplyEmail);
  bool(filters.allowShareWithMITAA, (p) => p.allowShareWithMITAA);

  if (filters.verification === "verified") {
    clauses.push((p) => Boolean(p.lastVerifiedDate));
  } else if (filters.verification === "never") {
    clauses.push((p) => !p.lastVerifiedDate);
  }

  const before = filters.verifiedBefore.trim();
  if (before !== "") {
    // Stale: never verified, or last verified strictly before the cutoff date.
    clauses.push((p) => !p.lastVerifiedDate || p.lastVerifiedDate < before);
  }
}

/** A multi-select option: the stored value, plus its human label for the control. */
export interface FilterOption {
  value: string;
  label: string;
}

/** The vocabulary options for the multi-selects, drawn from values present in the data. */
export interface FilterOptions {
  major: FilterOption[];
  country: FilterOption[];
  stateProvince: FilterOption[];
}

/**
 * Collect the multi-select vocabularies from the dataset (§5.6.4): only values
 * actually present appear, so US/CA surface clean codes and the international tail
 * surfaces its free text. Sorted by label for a stable, scannable list.
 */
export function collectFilterOptions(profiles: readonly DirectoryProfile[]): FilterOptions {
  const majors = new Set<string>();
  const countries = new Set<string>();
  const states = new Map<string, string>(); // value → label (country-aware display)

  for (const p of profiles) {
    for (const code of p.majors ?? []) {
      majors.add(code);
    }
    const country = p.address?.country;
    if (country) {
      countries.add(country);
    }
    const sp = p.address?.stateProvince;
    if (sp) {
      states.set(sp, subdivisionName(country, sp));
    }
  }

  const byLabel = (a: FilterOption, b: FilterOption) => a.label.localeCompare(b.label);
  return {
    major: [...majors].map((value) => ({ value, label: value })).sort(byLabel),
    country: [...countries].map((value) => ({ value, label: countryName(value) })).sort(byLabel),
    stateProvince: [...states].map(([value, label]) => ({ value, label })).sort(byLabel),
  };
}

export { STAFF_FILTER_KEYS };
