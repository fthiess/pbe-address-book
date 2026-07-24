/**
 * The Book analytics **event catalog** — the single source of truth for every
 * event name, its property shape, and the closed vocabularies those properties
 * draw from (D145, Phase 7a-4 / OFC-296).
 *
 * This module holds *data and types only*: it imports nothing from
 * `mixpanel-browser` and nothing from React, so it is trivially unit-testable
 * under Vitest's node environment (the same reason `analytics.ts` and
 * `analyticsConfig.ts` are split out — N125). The wrapper functions that actually
 * send events live in `analytics.ts` and are typed against {@link EventProperties}
 * here, so a wrong event name or a stray property is a **compile error** rather
 * than a runtime P6 leak.
 *
 * ## The P6 line this file draws
 *
 * P6 forbids any event that records *whom* a brother viewed, starred or searched
 * for. Every property type below is therefore a boolean, a bucket, or a **name**
 * from a closed set (a field-group label, a filter *dimension*, a toggle key, a
 * column key) — never a brother's id, name, email, a field *value*, a query, or
 * anything that identifies another person. A brother's action **on his own
 * record** may be attributed to him (it is his data about himself); an action on
 * **another** brother's record may be counted but never says whose (`Own`
 * booleans, id-less `Brother Starred`).
 *
 * ⚠ This covers only the properties Book *authors*. Mixpanel staples `$current_url`
 * onto every event by itself, and on this site a URL names a brother
 * (`/brother/5247/edit`) or carries filter values (`?classYear=1984`); several of
 * the events below fire on exactly those URLs. Keeping them P6-clean depends
 * equally on `BLOCKED_PROPERTIES` in `analyticsConfig.ts` stripping `$current_url`.
 * Neither this file nor that one is sufficient alone (N125).
 */

// ---------------------------------------------------------------------------
// Closed property vocabularies
// ---------------------------------------------------------------------------

/** A bucketed result/row count — never a raw number that could pinpoint one match. */
export type ResultBucket = "0" | "1" | "2-10" | "11+";

/**
 * Bucket a search/result count. Buckets rather than the raw number because a count
 * of exactly 1, attached to an identified brother at a known instant, is a sharper
 * signal about *who was looked up* than any of these events needs (P6).
 */
export function resultBucket(count: number): ResultBucket {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 10) return "2-10";
  return "11+";
}

/** A bucketed export row count. Coarser tiers than {@link ResultBucket} — an export
 *  legitimately spans the whole ~700-brother roster, so the interesting distinction
 *  is a one-off lookup vs a bulk pull, not the exact size. */
export type RowCountBucket = "1" | "2-10" | "11-100" | "101+";

/** Bucket an export row count (the Export button is disabled at zero rows). */
export function rowCountBucket(count: number): RowCountBucket {
  if (count <= 1) return "1";
  if (count <= 10) return "2-10";
  if (count <= 100) return "11-100";
  return "101+";
}

/** Which scope an export covered — the current view, or an explicit selection. */
export type ExportScope = "view" | "selection";

/**
 * The coarse groups a `Profile Saved` reports as changed — *which kinds* of data a
 * brother maintains, never *what* he changed it to. `identity`, `photo` and `other`
 * extend OFC-296's illustrative five (contact/professional/privacy/photo/
 * relationships) so that no save is ever recorded with an empty or misleading group
 * set: a name-or-class-year edit is `identity`, a staff note or any future field
 * falls to `other` rather than vanishing. All are category labels, never PII.
 */
export type FieldGroup =
  | "identity"
  | "contact"
  | "professional"
  | "relationships"
  | "privacy"
  | "photo"
  | "other";

/** Canonical output order, so a `Field Groups` array is stable across events. */
const FIELD_GROUP_ORDER: readonly FieldGroup[] = [
  "identity",
  "contact",
  "professional",
  "relationships",
  "privacy",
  "photo",
  "other",
];

/**
 * Map each writable top-level `Profile` key (the keys `buildPatch` emits — see
 * `profile/patch.ts`) to its coarse group. `privacy` is a single key covering the
 * whole `PrivacyFlags` block, so one flag flipping is enough to mark the `privacy`
 * group. Anything not listed (e.g. `adminNote`, the status blocks, a future field)
 * falls to `other` in {@link fieldGroupsChanged}, so the mapping never has to be
 * exhaustive to stay honest.
 */
const FIELD_TO_GROUP: Readonly<Record<string, FieldGroup>> = {
  // identity
  firstName: "identity",
  middleName: "identity",
  lastName: "identity",
  fullLegalName: "identity",
  mugName: "identity",
  classYear: "identity",
  // contact
  email: "contact",
  alternateEmail: "contact",
  phone: "contact",
  address: "contact",
  // professional
  employerName: "professional",
  jobTitle: "professional",
  majors: "professional",
  links: "professional",
  // relationships
  bigBrotherId: "relationships",
  spousePartnerName: "relationships",
  emergencyContacts: "relationships",
  // privacy
  privacy: "privacy",
  unlisted: "privacy",
  allowNewsletterEmail: "privacy",
  allowShareWithMITAA: "privacy",
};

/**
 * Reduce a save's changed-field keys (plus whether the headshot changed) to the
 * ordered, de-duplicated set of {@link FieldGroup}s it touched. Carries only group
 * *labels* — never the changed keys' values (P6).
 */
export function fieldGroupsChanged(
  patchKeys: readonly string[],
  photoChanged: boolean,
): FieldGroup[] {
  const groups = new Set<FieldGroup>();
  for (const key of patchKeys) {
    groups.add(FIELD_TO_GROUP[key] ?? "other");
  }
  if (photoChanged) {
    groups.add("photo");
  }
  return FIELD_GROUP_ORDER.filter((group) => groups.has(group));
}

/**
 * The directory filter dimensions, mapped to the **display name** each `Filter
 * Applied` event reports. Keyed on the filter field name from `useDirectoryFilters`
 * (note the UI's "course" is stored as `major` and "state" as `stateProvince`); the
 * value is the human dimension label. Only the *dimension* is ever sent — never the
 * selected value, which would narrow toward *whom* the brother is looking for (P6).
 *
 * A filter present in `useDirectoryFilters` but absent here simply goes untracked —
 * a safe omission, not a leak. Keep this in step with `filterParsers` when a filter
 * is added.
 */
export const FILTER_DIMENSIONS = {
  classYear: "Class Year",
  constitutionId: "Constitution ID",
  major: "Course",
  country: "Country",
  stateProvince: "State/Province",
  city: "City",
  staff: "Staff Role",
  email: "Has Email",
  phone: "Has Phone",
  allowNewsletterEmail: "Newsletter Consent",
  allowShareWithMITAA: "MITAA Consent",
  verification: "Verification",
  verifiedBefore: "Verified Before",
} as const;

/** A filter field name that carries a tracked dimension label. */
export type FilterDimensionKey = keyof typeof FILTER_DIMENSIONS;
/** A human dimension label reported by `Filter Applied`. */
export type FilterDimension = (typeof FILTER_DIMENSIONS)[FilterDimensionKey];

/** Whether a filter field holds a constraining (non-empty) value. */
function isFilterActive(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The set of filter dimensions currently *engaged* (holding a non-empty value), so
 * a caller can diff against the previous set and report each dimension the moment
 * it becomes active — the "which filters earn their place" signal, deduped against
 * per-keystroke churn (the value is only ever tested for emptiness, never read out).
 */
export function activeFilterKeys(
  filters: Readonly<Record<string, unknown>>,
): Set<FilterDimensionKey> {
  const active = new Set<FilterDimensionKey>();
  for (const key of Object.keys(FILTER_DIMENSIONS) as FilterDimensionKey[]) {
    if (isFilterActive(filters[key])) {
      active.add(key);
    }
  }
  return active;
}

// ---------------------------------------------------------------------------
// The event catalog
// ---------------------------------------------------------------------------

/** An event with no app-authored properties. */
type NoProperties = Record<string, never>;

/**
 * Every Book analytics event and the exact shape of the properties it carries.
 * The wrapper functions in `analytics.ts` are typed against this map, so adding an
 * event means adding a line here first — the registry OFC-296 asked for, earning
 * its place now that the taxonomy is ~14 events rather than one.
 */
export interface EventProperties {
  /** A route-pattern page view — `/brother/:id`, never `/brother/5247` (P6). */
  "Page View": { "Route Pattern": string };
  /** A completed fresh sign-in — the funnel's end; role/Constitution ID ride as
   *  user properties (D88), so this needs none. */
  "Signed In": NoProperties;
  /** A brother record opened. `Own` distinguishes a brother reading his own record
   *  from viewing another's; it never says *whose* (P6). */
  "Profile Viewed": { Own: boolean };
  /** A profile save succeeded. Reports *which kinds* of data changed and whether it
   *  was the brother's own record or a staff edit — never any field value (P6). */
  "Profile Saved": { "Field Groups": FieldGroup[]; Own: boolean };
  /** A privacy/consent switch flipped — the toggle's key and its new state (a
   *  brother's own choice about his own data; directly feeds the defaults debate). */
  "Consent Toggle Changed": { Toggle: string; Enabled: boolean };
  /** A brother was starred — count only, never *whom* (P6; Forrest's OFC-296 note). */
  "Brother Starred": NoProperties;
  /** A brother was un-starred — count only, never *whom* (P6). */
  "Brother Un-starred": NoProperties;
  /** A settled name search — a bucketed match count and whether it followed an empty
   *  search (retry-vs-give-up), never the query text or matched ids (P6). */
  "Search Performed": { "Result Count": ResultBucket; "After Empty": boolean };
  /** A filter dimension was engaged — the dimension name only, never its value (P6). */
  "Filter Applied": { Dimension: FilterDimension };
  /** A column was shown or hidden — the column key (a field name, not brother data). */
  "Column Layout Changed": { Column: string; Shown: boolean };
  /** The column lens was reset to defaults. */
  "Columns Reset": NoProperties;
  /** A help toggle-tip opened — the control's help title, never brother data. */
  "Help Opened": { Topic: string };
  /** A staff CSV export ran — its scope and a bucketed row count (audited separately
   *  for security by D92; this is the usage-shape view). */
  "Export Performed": { Scope: ExportScope; "Row Count": RowCountBucket };
  /** The below-`md` "Options" fold was opened (N92) — phone use, finally measured. */
  "Mobile Options Opened": NoProperties;
}

/** The name of any Book analytics event. */
export type EventName = keyof EventProperties;
