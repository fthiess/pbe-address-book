import {
  type Role,
  compareCourseCodes,
  countryName,
  courseLabel,
  isWillingToMentor,
  subdivisionName,
} from "@pbe/shared";
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
/** The Staff filter: unset, or "managers and administrators" (OFC-199). */
export type StaffFilter = "" | "staffOnly";
/**
 * The mentoring filter: unset, or "willing" (D166, OFC-386). Deliberately **not** a
 * {@link BoolFilter} — there is no "No" option, because the stored `false` conflates
 * "I considered this and declined" with "I have never opened my profile", and a
 * filter that presented those as a single answered "No" would be lying about most of
 * the roster. "Any" already covers everyone the negative case would.
 */
export type MentorFilter = "" | "yes";
/**
 * A **narrow-to-yes** filter: unset ("Any"), or keep only the records where the
 * flag is true (OFC-399). Deliberately has no "No", for the same reason
 * {@link MentorFilter} doesn't — but arrived at from the other direction: here the
 * negative case is not ambiguous, it is simply the overwhelming default (almost
 * every brother is living, listed and un-de-brothered), so a "No" option would be a
 * control whose only effect is to remove a handful of records from a view that
 * already excludes them or shows them plainly marked. "Any" covers it.
 */
export type YesFilter = "" | "yes";

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
  /**
   * Substring (case-insensitive): Employer (D164, OFC-379) — "who works at …", the
   * most-requested search UAT produced. Matches the single **current** employer the
   * record holds, so a brother who has moved on is not found under the old company;
   * the filter's `?` says so, because the limitation is in the data model, not here
   * (PRD §5.6.4; employment history is OFC-255's business, not this filter's).
   */
  employer: string;
  /**
   * All-brothers — filter to managers and administrators (OFC-199). Role is public
   * (OFC-139), so unlike the staff-only filters below this is available to every
   * role. A single "staff or not" toggle: with only ~6–8 staff, splitting managers
   * from admins would add UI for no practical gain.
   */
  staff: StaffFilter;
  /**
   * All-brothers — keep only brothers willing to mentor (D166, OFC-386).
   * `willingToMentor` is **public**, so like Employer and Staff this needs no role
   * gate: filterable ⟺ visible holds outright.
   */
  willingToMentor: MentorFilter;
  /**
   * All-brothers — keep only brothers who have passed (OFC-399). The flag is
   * public (the grid badges it, the profile carries the In Memoriam treatment), so
   * like Mentoring and Staff this needs no role gate.
   *
   * ⚠ **Named `deceasedOnly`, not `deceased`, because the URL key `deceased` is
   * already taken** — it is the D36 "Include deceased" boolean (`deceased=true`,
   * owned by `Directory.tsx`). Every filter field here maps to a same-named query
   * param, so calling this one `deceased` would have put two hooks with two
   * different parsers on one key: the filter would write `deceased=yes`, the
   * toggle would read that as "not true", and `reset()` would silently clear the
   * toggle along with the filters. The name also states the semantics correctly —
   * `deceased=true` *includes*, `deceasedOnly=yes` *narrows to*.
   *
   * ⚠ **This filter overrides the living-only default** (Forrest's call, D171).
   * The Directory hides deceased brothers unless "Include deceased" is ticked
   * (D36), and that default is applied by the query engine *after* this predicate —
   * so on its own, "Deceased: Yes" would have intersected with "living only" and
   * returned an empty grid whenever the box was unticked, which is its default
   * state. `filterRows` therefore treats an explicit request for deceased brothers
   * as its own inclusion, exactly as "Starred only" already does (D39). The two
   * controls are consequently **not** independent: read them together or neither
   * makes sense.
   */
  deceasedOnly: YesFilter;
  /** Staff-only — presence of an email / phone. */
  email: PresenceFilter;
  phone: PresenceFilter;
  /**
   * Staff-only — the whole-record hides (OFC-399). Both are classified
   * `staff-internal`, so they are already in the manager/admin bulk projection and
   * absent from a brother's entirely: filterable ⟺ visible holds by the same gate
   * as the restricted columns, and an out-of-role filter could not match anything
   * even if it were somehow set. They exist so staff can *find* the records the
   * brother view omits (D124 unlisted / D115 de-brothered) rather than scrolling
   * for the badge.
   */
  unlisted: YesFilter;
  debrothered: YesFilter;
  /** Staff-only — the consent flags. */
  allowNewsletterEmail: BoolFilter;
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
  employer: "",
  staff: "",
  willingToMentor: "",
  deceasedOnly: "",
  email: "",
  phone: "",
  unlisted: "",
  debrothered: "",
  allowNewsletterEmail: "",
  allowShareWithMITAA: "",
  verification: "",
  verifiedBefore: "",
};

/** The staff-only filter keys (manager/admin); gated like their restricted columns. */
const STAFF_FILTER_KEYS: readonly (keyof DirectoryFilters)[] = [
  "email",
  "phone",
  "unlisted",
  "debrothered",
  "allowNewsletterEmail",
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
  if (filters.employer.trim()) n++;
  if (filters.staff) n++;
  if (filters.willingToMentor) n++;
  if (filters.deceasedOnly) n++;
  if (filters.email) n++;
  if (filters.phone) n++;
  if (filters.unlisted) n++;
  if (filters.debrothered) n++;
  if (filters.allowNewsletterEmail) n++;
  if (filters.allowShareWithMITAA) n++;
  if (filters.verification) n++;
  if (filters.verifiedBefore.trim()) n++;
  return n;
}

/**
 * A parsed range bound, `null` meaning "unbounded on this side": `[1985, null]`
 * is `1985-` (that year and later), `[null, 1990]` is `-1990` (that year and
 * earlier). A closed range has both bounds; at least one bound is always present.
 */
export type NumericRange = [number | null, number | null];

/** A parsed numeric-grammar input: the discrete values, the ranges, and any bad tokens. */
export interface NumericGrammar {
  values: number[];
  ranges: NumericRange[];
  /** Tokens that didn't parse — surfaced inline rather than silently dropped (§5.6.4). */
  errors: string[];
  /** True when there is at least one usable value/range (so the filter is active). */
  active: boolean;
}

/**
 * Parse the numeric grammar: comma-separated integers and `lo-hi` ranges, freely
 * combined (e.g. `1980, 1985-1989, 1992`). Ranges may be **one-sided** — `1985-`
 * (that year and later) or `-1990` (that year and earlier) — carried as a `null`
 * bound (OFC-195). Whitespace is tolerated; an unparseable token (including a bare
 * `-`) is collected into `errors`. A reversed closed range (`1990-1980`) is
 * normalised.
 */
export function parseNumericGrammar(raw: string): NumericGrammar {
  const values: number[] = [];
  const ranges: NumericRange[] = [];
  const errors: string[] = [];

  for (const rawToken of raw.split(",")) {
    const token = rawToken.trim();
    if (token === "") {
      continue;
    }
    const closedMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (closedMatch) {
      const lo = Number(closedMatch[1]);
      const hi = Number(closedMatch[2]);
      ranges.push(lo <= hi ? [lo, hi] : [hi, lo]);
      continue;
    }
    const lowerOpenMatch = token.match(/^(\d+)\s*-$/);
    if (lowerOpenMatch) {
      ranges.push([Number(lowerOpenMatch[1]), null]);
      continue;
    }
    const upperOpenMatch = token.match(/^-\s*(\d+)$/);
    if (upperOpenMatch) {
      ranges.push([null, Number(upperOpenMatch[1])]);
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
  // An open bound (`null`) is unbounded on that side.
  return grammar.ranges.some(
    ([lo, hi]) => (lo == null || value >= lo) && (hi == null || value <= hi),
  );
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

  // Employer, all roles: `employerName` is a **public** field (shared visibility
  // table), so it is already in every role's projection and filterable ⟺ visible
  // holds without a gate. An absent value never matches, exactly like City.
  const employer = filters.employer.trim().toLocaleLowerCase();
  if (employer !== "") {
    clauses.push((p) => (p.employerName ?? "").toLocaleLowerCase().includes(employer));
  }

  // Staff filter — all roles (role is public, OFC-139/OFC-199): keep only managers
  // and administrators. Undefined role (a brother) never matches.
  if (filters.staff === "staffOnly") {
    clauses.push((p) => p.role === "manager" || p.role === "admin");
  }

  // Mentoring, all roles: public like Employer and Staff. Uses the shared predicate,
  // so a deceased brother's stored opt-in never matches — which matters because
  // "Include deceased" (D36) is the one case where he could otherwise reach the grid
  // and be offered as a mentor.
  if (filters.willingToMentor === "yes") {
    clauses.push((p) => isWillingToMentor(p));
  }

  // Deceased, all roles (OFC-399): a plain "keep only the flagged records" clause.
  // ⚠ It does NOT reach in and disable the living-only default — that stays the
  // query engine's business (`filterRows`), which is where the D36 toggle already
  // lives; this module remains a pure predicate over one record at a time and knows
  // nothing about the view's defaults. See the field's doc comment for the
  // interaction, and `query.ts` for the override that makes it produce rows.
  if (filters.deceasedOnly === "yes") {
    clauses.push((p) => p.deceased?.isDeceased === true);
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

  // The whole-record hides (OFC-399). Both read defensively: `unlisted` is a bare
  // boolean and `debrothered` a block, and either can be absent from a projected
  // record — an absent flag means "not hidden", never "unknown, so keep it".
  if (filters.unlisted === "yes") {
    clauses.push((p) => p.unlisted === true);
  }
  if (filters.debrothered === "yes") {
    clauses.push((p) => p.debrothered?.isDebrothered === true);
  }

  const bool = (value: BoolFilter, read: (p: DirectoryProfile) => boolean | undefined) => {
    if (value === "yes") {
      clauses.push((p) => read(p) === true);
    } else if (value === "no") {
      clauses.push((p) => read(p) === false);
    }
  };
  bool(filters.allowNewsletterEmail, (p) => p.allowNewsletterEmail);
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
    // Course options carry "code — Name" so the filter reads "6-3 — Computer
    // Science and Engineering"; they sort by course NUMBER (2 before 10), not as
    // strings — Country/State stay alphabetical by label.
    major: [...majors]
      .map((value) => ({ value, label: courseLabel(value) }))
      .sort((a, b) => compareCourseCodes(a.value, b.value)),
    country: [...countries].map((value) => ({ value, label: countryName(value) })).sort(byLabel),
    stateProvince: [...states].map(([value, label]) => ({ value, label })).sort(byLabel),
  };
}

export { STAFF_FILTER_KEYS };
