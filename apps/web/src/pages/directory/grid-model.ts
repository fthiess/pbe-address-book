import {
  type Role,
  compareCourseCodes,
  countryName,
  formatConstitutionId,
  isWillingToMentor,
  subdivisionName,
} from "@pbe/shared";
import type { DirectoryProfile } from "../../lib/types.js";

/**
 * The Directory grid's **column model** — the single declarative source the
 * grid, the column-lens menu, the sort logic, and the displayed-columns CSV
 * export all read from (PRD §5.6.1/§5.6.2). Keeping every column's identity,
 * display accessor, sort key, width, and role-visibility in one table means
 * adding or regrouping a column is a one-line change here rather than edits
 * scattered across the render.
 *
 * The export was a *future* reader of this table until D176, and is now a real
 * one: `displayed-csv.ts` builds its file from these `label`s and cell values,
 * which is why a column's `display` — and, where they differ, its `csvValue` —
 * are now user-visible in two places rather than one.
 */

/** Every column the grid can show, keyed by a stable id (also its lens key). */
export type ColumnKey =
  // Frozen pinned block (always present, left, non-reorderable):
  | "select" // row-selection checkbox, every role since D175
  | "star" // universal personal-favorite toggle
  | "thumbnail"
  | "name"
  // Role-identical default data columns (§5.6.1):
  | "classYear"
  | "major"
  | "email"
  | "phone"
  | "city"
  | "stateProvince"
  | "country"
  // Non-default selectable columns (off by default):
  | "fullName"
  // `nickname`, not `mugName` (OFC-409): the mug name is a historical record shown
  // only on the Profile page, and never a Directory column.
  | "nickname"
  | "employer"
  | "postPbeEducation"
  | "sports"
  | "activities"
  | "constitutionId"
  | "role"
  | "willingToMentor"
  // Restricted, manager/administrator only (§5.6.1, off by default):
  | "allowNewsletterEmail"
  | "allowShareWithMITAA"
  | "lastVerifiedDate"
  | "lastModified";

/** Which structural group a column belongs to — drives ordering and the lens. */
export type ColumnGroup = "pinned" | "default" | "optional" | "restricted";

export type ColumnAlign = "start" | "end";

/**
 * A column's full definition. `display` renders the cell text; `sortValue`
 * yields the comparable key (string, number, or null for "unknown/absent",
 * which always sorts last). A column with `sortable: false` (the thumbnail) has
 * no header sort affordance. `roles`, when set, restricts both the column's
 * visibility and its lens entry to those roles (the projection already withholds
 * the underlying values server-side — this only keeps the UI honest).
 */
export interface GridColumn {
  key: ColumnKey;
  /** Visible header label (also the cell's accessible column association). */
  label: string;
  group: ColumnGroup;
  /** Fixed pixel width — the grid template is deterministic so frozen offsets compute. */
  width: number;
  align: ColumnAlign;
  pinned: boolean;
  sortable: boolean;
  /** Whether the column can be resized (default true; false for the fixed control columns). */
  resizable?: boolean;
  /** Roles allowed to see/select this column; omitted = every role. */
  roles?: readonly Role[];
  /** The cell's display string. `name` is the resolved Canonical Name (passed in). */
  display: (profile: DirectoryProfile, name: string) => string;
  /** The comparable sort key, or null when the value is absent/unknown. */
  sortValue: (profile: DirectoryProfile) => string | number | null;
  /**
   * The displayed-columns CSV cell (OFC-403), when `display` is **not** what the
   * reader sees. Omitted for all but one column, because a cell normally *is* its
   * display string — the exception is Course, whose cell renders every course as a
   * chip strip while `display` returns the primary alone (that string exists for
   * sorting). Exporting "6" from a cell reading "6, 18" would be a quiet lie about
   * what was on screen, which is the one thing this export promises not to be.
   */
  csvValue?: (profile: DirectoryProfile) => string;
  /**
   * How to order two **present** sort values, when the column's vocabulary has an
   * order of its own that neither numeric nor locale comparison reproduces. Omitted
   * — the case for every column but Course — means the default {@link compareNonNull}.
   *
   * Null handling, the direction sign, and the canonical secondary key are NOT this
   * function's business: it sees only two non-null values and returns their
   * ascending order, exactly like a plain `Array.sort` comparator.
   */
  compare?: (a: string | number, b: string | number) => number;
}

/** The resize bounds shared by the lens, the resize handle, and auto-fit (N16/N27). */
export const MIN_COLUMN_WIDTH = 64;
export const MAX_COLUMN_WIDTH = 640;

/**
 * The columns whose cells render the name search's `<mark>` highlights (D35) — the
 * Canonical Name and the other searched name fields that have a column. Shared by
 * the grid (which decides whether to render marks), the phone card view, and
 * auto-fit (which must add their padding to a measured width, OFC-358), so the
 * three can't disagree about which cells carry them.
 *
 * ⚠ **This is the searched-name-fields set INTERSECTED WITH the columns, not the
 * searched set itself.** Since OFC-409 the matcher also indexes `mugName`, which
 * has no column at all — so a brother matched only by his mug name is returned
 * and listed with nothing marked. That is correct: there is no cell in which to
 * draw the mark. Don't "fix" it by adding a key with no column, which would put an
 * undefined entry into `COLUMNS[key]` lookups.
 */
export const HIGHLIGHTED_COLUMN_KEYS: ReadonlySet<ColumnKey> = new Set<ColumnKey>([
  "name",
  "fullName",
  "nickname",
]);

/** A brother's primary major is the first entry in his (owner-ordered) list (§5.6.1). */
function primaryMajor(profile: DirectoryProfile): string | null {
  return profile.majors?.[0] ?? null;
}

/**
 * "—" placeholder for an absent/withheld value, kept out of assistive announcements.
 *
 * Exported because the displayed-columns CSV (OFC-403) has to *undo* it: an em-dash
 * is a reading aid for a screen, and a spreadsheet wants an empty cell.
 */
export const EMPTY_CELL = "—";

const STAFF: readonly Role[] = ["manager", "admin"];

/**
 * The column registry. Order here is the canonical full order; the active view's
 * order is the user's lens (a permutation of the visible subset), so this map's
 * iteration order only seeds the default and the lens menu.
 */
export const COLUMNS: Readonly<Record<ColumnKey, GridColumn>> = {
  select: {
    key: "select",
    label: "Select",
    group: "pinned",
    width: 44,
    align: "start",
    pinned: true,
    sortable: false,
    resizable: false,
    // Row selection for **every** role since OFC-411, which gave brothers Copy
    // Emails: a selection column with nothing to act on would have been furniture,
    // and an action with no way to pick its subjects is unusable, so the two moved
    // together. No `roles` gate — what each role may then *do* with a selection is
    // the action's own question (`canExportCsv` for Export, the per-role cap for
    // Copy Emails), which is where it belongs. This column used to carry the
    // `roles: STAFF` that PRD §3.2 anticipated dropping "with a one-line change".
    display: () => "",
    sortValue: () => null,
  },
  star: {
    key: "star",
    label: "Star",
    group: "pinned",
    width: 44,
    align: "start",
    pinned: true,
    sortable: false,
    resizable: false,
    // The universal personal-favorite toggle, shown to every role (§5.6.6, D39).
    display: () => "",
    sortValue: () => null,
  },
  thumbnail: {
    key: "thumbnail",
    label: "Photo",
    group: "pinned",
    width: 64,
    align: "start",
    pinned: true,
    sortable: false,
    // Fixed width like the Select/Star control columns — no resize handle (the
    // photo box is a constant 64px; resizing it only ever obscured the avatar).
    resizable: false,
    display: () => "",
    sortValue: () => null,
  },
  name: {
    key: "name",
    label: "Name",
    group: "pinned",
    width: 248,
    align: "start",
    pinned: true,
    sortable: true,
    // The cell renders the resolved Canonical Name; sorting uses the structured
    // (last, first, year) key, never this display string (see compareCanonical).
    display: (_profile, name) => name,
    sortValue: () => null,
  },
  classYear: {
    key: "classYear",
    label: "Class",
    group: "default",
    width: 96,
    align: "end",
    pinned: false,
    sortable: true,
    // The numeric year as its own column is what makes it sortable and
    // range-filterable, which the 'YY token inside Canonical Name is not (§5.6.1).
    // Shown as the full 4-digit year here (e.g. "1972"); the apostrophe-two-digit
    // 'YY form belongs only to the Canonical Name in the Name column.
    display: (p) => (p.classYear == null ? EMPTY_CELL : String(p.classYear)),
    sortValue: (p) => p.classYear ?? null,
  },
  major: {
    key: "major",
    // MIT "majors" are called **courses** — the column is headed "Course"
    // (the underlying field stays `majors`). The visible cell renders ALL of a
    // brother's courses as chips (DirectoryGrid/DirectoryCards, D136/OFC-269);
    // this string is only the primary course, used as the sort/export value
    // (sort stays keyed on the primary — D33).
    label: "Course",
    group: "default",
    width: 120,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => primaryMajor(p) ?? EMPTY_CELL,
    // Every course, matching the chip strip the cell actually renders — see
    // `csvValue`. The separator is the ";" the canonical export already uses for
    // `majors`, so the two files agree about how a multi-valued cell is written.
    csvValue: (p) => (p.majors ?? []).join(";"),
    sortValue: (p) => primaryMajor(p),
    // Courses are numbers, so they must sort as numbers: a plain string compare
    // gives 1, 10, 11, 2 (OFC-290). `compareCourseCodes` is the same comparator the
    // filter panel's course list and the profile editor's course picker already use
    // — the Directory was the one place still ordering them as text.
    compare: (a, b) => compareCourseCodes(String(a), String(b)),
  },
  email: {
    key: "email",
    label: "Email",
    group: "default",
    width: 224,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => p.email ?? EMPTY_CELL,
    sortValue: (p) => p.email?.toLocaleLowerCase() ?? null,
  },
  phone: {
    key: "phone",
    label: "Telephone",
    group: "default",
    width: 152,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => p.phone ?? EMPTY_CELL,
    sortValue: (p) => p.phone ?? null,
  },
  city: {
    key: "city",
    label: "City",
    group: "default",
    width: 140,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => p.address?.city ?? EMPTY_CELL,
    sortValue: (p) => p.address?.city?.toLocaleLowerCase() ?? null,
  },
  stateProvince: {
    key: "stateProvince",
    label: "State/Province",
    group: "default",
    width: 132,
    align: "start",
    pinned: false,
    sortable: true,
    // US/CA codes resolve to a display name; international free text echoes (§8).
    display: (p) =>
      p.address?.stateProvince
        ? subdivisionName(p.address.country, p.address.stateProvince)
        : EMPTY_CELL,
    sortValue: (p) =>
      p.address?.stateProvince
        ? subdivisionName(p.address.country, p.address.stateProvince).toLocaleLowerCase()
        : null,
  },
  country: {
    key: "country",
    label: "Country",
    group: "default",
    width: 128,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => (p.address?.country ? countryName(p.address.country) : EMPTY_CELL),
    sortValue: (p) =>
      p.address?.country ? countryName(p.address.country).toLocaleLowerCase() : null,
  },
  fullName: {
    key: "fullName",
    // The brother's full/legal name (incl. suffixes, compound names) — off by
    // default, selectable by any role when the constructed Canonical Name isn't
    // enough (§3.2; visual-design column set).
    label: "Full Name",
    group: "optional",
    width: 200,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => p.fullLegalName ?? EMPTY_CELL,
    sortValue: (p) => p.fullLegalName?.toLocaleLowerCase() ?? null,
  },
  nickname: {
    key: "nickname",
    // The name a brother goes by — a public field and one of the searched name
    // fields (D35). Off by default, selectable by any role.
    //
    // ⚠ This column reads `nickname`, NOT `mugName` (OFC-409, superseding N170's
    // OFC-402 half). N170 headed the *mug name* column "Nickname" while the two
    // were one field; they are now two, and the mug name — a historical record
    // that may be a joke the brother would not want used as a name for him —
    // deliberately has **no** Directory column at all. A stored column lens naming
    // the old `mugName` key is dropped silently by `parseLens`, so a brother who
    // had added that column simply finds it gone, which is the intended outcome.
    label: "Nickname",
    group: "optional",
    width: 168,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => p.nickname ?? EMPTY_CELL,
    sortValue: (p) => p.nickname?.toLocaleLowerCase() ?? null,
  },
  employer: {
    key: "employer",
    // The brother's current employer — a public field (shared visibility table),
    // already in every role's projection, so this column adds no bytes to the
    // roster read. Off by default like every optional column: it is the answer to
    // a specific question ("who works at …"), not part of the resting view (D164,
    // OFC-379). Wide enough for a company name without the header truncating.
    label: "Employer",
    group: "optional",
    width: 200,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => p.employerName ?? EMPTY_CELL,
    sortValue: (p) => p.employerName?.toLocaleLowerCase() ?? null,
  },
  // The three OFC-404/405/406 free-text fields. All public (shared visibility
  // table), so they are already in every role's projection and cost the roster
  // read nothing; all off by default, like every optional column — each answers a
  // specific question ("who else rows?") rather than belonging to the resting view
  // (D164). Wider than Employer at 224px because they hold a phrase rather than a
  // company name, and capped at 120 characters, so a full value has a real chance
  // of fitting; auto-fit (N27) handles the rest.
  postPbeEducation: {
    key: "postPbeEducation",
    label: "Post-PBE Education",
    group: "optional",
    width: 224,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => p.postPbeEducation ?? EMPTY_CELL,
    sortValue: (p) => p.postPbeEducation?.toLocaleLowerCase() ?? null,
  },
  sports: {
    key: "sports",
    label: "Sports",
    group: "optional",
    width: 224,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => p.sports ?? EMPTY_CELL,
    sortValue: (p) => p.sports?.toLocaleLowerCase() ?? null,
  },
  activities: {
    key: "activities",
    label: "Activities",
    group: "optional",
    width: 224,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => p.activities ?? EMPTY_CELL,
    sortValue: (p) => p.activities?.toLocaleLowerCase() ?? null,
  },
  constitutionId: {
    key: "constitutionId",
    label: "Constitution ID",
    group: "optional",
    width: 128,
    align: "end",
    pinned: false,
    sortable: true,
    display: (p) => formatConstitutionId(p.id),
    sortValue: (p) => p.id,
  },
  role: {
    key: "role",
    // The brother's Book role (public since OFC-139; OFC-199 column). Off by
    // default, selectable by **any** role — the staff roles are official, not
    // secret. Ordinary brothers render as an em-dash rather than a wall of
    // "Brother", so the column reads at a glance as "who's staff".
    //
    // Headed "Staff", not "Role" (OFC-407). UAT testers read "Role" as the
    // fraternity offices a brother had held — President and the like — and the
    // filter panel already called the same thing "Staff", so the two halves of one
    // concept disagreed. "Staff" is now the single user-facing name; the field,
    // the column key, and the analytics property stay `role` (internal naming is
    // deliberately unchanged). This label is also the column-picker menu entry.
    label: "Staff",
    group: "optional",
    width: 128,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => roleLabel(p.role),
    sortValue: (p) => roleRank(p.role),
  },
  willingToMentor: {
    key: "willingToMentor",
    // The mentoring opt-in (D166, OFC-386) — a public field, so selectable by any
    // role and already in every projection. Renders "Yes" or an em-dash rather than
    // Yes/No, following the Role column: the opt-in is the interesting value, "No"
    // is the resting state of most of the roster, and a column of "No" would offer a
    // distinction the filter deliberately doesn't (its options are Any/Yes).
    label: "Willing to Mentor",
    group: "optional",
    width: 148,
    align: "start",
    pinned: false,
    sortable: true,
    // `isWillingToMentor`, not the raw field: a deceased brother's stored opt-in is
    // not a live offer, so he reads as an em-dash here exactly as he is skipped by
    // the filter — the two must agree, which is why both call the shared predicate.
    display: (p) => (isWillingToMentor(p) ? "Yes" : EMPTY_CELL),
    // Not-willing is `null`, not `0`, so it sorts last in BOTH directions and the
    // opted-in brothers gather at the top whichever way the header is clicked — the
    // same single-interesting-value shape as the Role column's `roleRank`, and the
    // reason this column's sort direction is deliberately close to a no-op.
    sortValue: (p) => (isWillingToMentor(p) ? 1 : null),
  },
  allowNewsletterEmail: {
    key: "allowNewsletterEmail",
    label: "Newsletter",
    group: "restricted",
    width: 112,
    align: "start",
    pinned: false,
    sortable: true,
    roles: STAFF,
    display: (p) => yesNo(p.allowNewsletterEmail),
    sortValue: (p) => boolRank(p.allowNewsletterEmail),
  },
  allowShareWithMITAA: {
    key: "allowShareWithMITAA",
    label: "Share with MITAA",
    group: "restricted",
    width: 140,
    align: "start",
    pinned: false,
    sortable: true,
    roles: STAFF,
    display: (p) => yesNo(p.allowShareWithMITAA),
    sortValue: (p) => boolRank(p.allowShareWithMITAA),
  },
  lastVerifiedDate: {
    key: "lastVerifiedDate",
    label: "Last verified",
    group: "restricted",
    width: 128,
    align: "start",
    pinned: false,
    sortable: true,
    roles: STAFF,
    // Verified-on date (YYYY-MM-DD), or "Never" when the record has never been
    // verified — the data-hygiene cue a manager chases (§5.6.1).
    display: (p) => p.lastVerifiedDate ?? "Never",
    sortValue: (p) => p.lastVerifiedDate ?? null,
  },
  lastModified: {
    key: "lastModified",
    label: "Last updated",
    group: "restricted",
    width: 164,
    align: "start",
    pinned: false,
    sortable: true,
    roles: STAFF,
    display: (p) => (p.lastModified ? p.lastModified.slice(0, 10) : EMPTY_CELL),
    sortValue: (p) => p.lastModified ?? null,
  },
};

/** Yes/No rendering for a boolean consent column (text, never colour alone — D32). */
function yesNo(value: boolean | undefined): string {
  return value === undefined ? EMPTY_CELL : value ? "Yes" : "No";
}

/** The Role column's cell: staff labelled, an ordinary brother an em-dash (OFC-199). */
function roleLabel(role: Role | undefined): string {
  return role === "admin" ? "Administrator" : role === "manager" ? "Manager" : EMPTY_CELL;
}

/**
 * Sort rank for the Role column: admins above managers above everyone else.
 * Ordinary brothers (and an absent role) are `null` so they sort last in both
 * directions like every other "absent/withheld" value, keeping staff together at
 * the top when sorting by Role.
 */
function roleRank(role: Role | undefined): number | null {
  return role === "admin" ? 2 : role === "manager" ? 1 : null;
}

/** Sort rank for a boolean: false < true, with undefined (withheld) last. */
function boolRank(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

/**
 * The frozen pinned columns in fixed left-to-right order (§5.6.1): **Select**,
 * **Star**, then the **Thumbnail** and **Canonical Name** identity block. These
 * never appear in the lens (they are always present, never reordered) and freeze
 * as a contiguous block on horizontal scroll.
 *
 * Role-independent since OFC-411 — the block used to lose its Select column for
 * brothers, which is why this was a `pinnedColumnsForRole(role)` function. Every
 * role now selects, so the same four columns lead every grid.
 */
export const PINNED_COLUMNS: readonly GridColumn[] = (
  ["select", "star", "thumbnail", "name"] as const
).map((key) => COLUMNS[key]);

/**
 * The default visible data columns, the *same set for every role* (§5.6.1), so
 * the first-load view is identical regardless of role; the restricted columns
 * are opt-in. Order is the default lens order (reorderable by the user).
 */
export const DEFAULT_DATA_KEYS: readonly ColumnKey[] = [
  "classYear",
  "major",
  "email",
  "phone",
  "city",
  "stateProvince",
  "country",
];

/** Whether a column may be seen/selected by `role` (no `roles` = every role). */
export function columnAllowsRole(column: GridColumn, role: Role): boolean {
  return column.roles === undefined || column.roles.includes(role);
}

/**
 * Every non-pinned column this role may select, in registry order — the menu of
 * the column-lens picker. Pinned identity columns are excluded (always shown,
 * never toggled).
 */
export function selectableColumns(role: Role): GridColumn[] {
  return (Object.keys(COLUMNS) as ColumnKey[])
    .map((key) => COLUMNS[key])
    .filter((column) => !column.pinned && columnAllowsRole(column, role));
}

/**
 * Compare two records in **canonical directory order**: last name, then first
 * name, then class year (§5.6.2). This is both the Canonical Name column's sort
 * and the *secondary* key under every other column's sort, so ties always settle
 * into readable name order. Names compare case-insensitively by locale; an
 * unknown class year sorts after known ones.
 */
export function compareCanonical(a: DirectoryProfile, b: DirectoryProfile): number {
  const byLast = localeCompare(a.lastName, b.lastName);
  if (byLast !== 0) {
    return byLast;
  }
  const byFirst = localeCompare(a.firstName, b.firstName);
  if (byFirst !== 0) {
    return byFirst;
  }
  return compareYear(a.classYear, b.classYear);
}

/** Case/locale-insensitive compare; an absent name sorts before a present one. */
function localeCompare(a: string | undefined, b: string | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

/**
 * Class-year tiebreak: ascending, with an unknown (null) year sorting after any
 * known one and two unknowns tying. Branch-compared rather than arithmetic on a
 * sentinel so two unknowns can't produce `Infinity - Infinity` (NaN).
 */
function compareYear(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) {
    return 0;
  }
  if (a == null) {
    return 1;
  }
  if (b == null) {
    return -1;
  }
  return a - b;
}

export type SortDirection = "asc" | "desc";

/**
 * Build the row comparator for the active sort. The Canonical Name column sorts
 * by {@link compareCanonical} directly; every other column sorts by its
 * `sortValue` (nulls always last regardless of direction, so "unknown" never
 * floats to the top of a descending sort) with canonical order as the secondary
 * key. Direction flips only the primary comparison.
 */
export function makeComparator(
  key: ColumnKey,
  direction: SortDirection,
): (a: DirectoryProfile, b: DirectoryProfile) => number {
  const sign = direction === "asc" ? 1 : -1;

  if (key === "name") {
    return (a, b) => sign * compareCanonical(a, b);
  }

  const column = COLUMNS[key];
  return (a, b) =>
    compareSortValues(column.sortValue(a), column.sortValue(b), column.compare, sign, a, b);
}

/**
 * Sort rows by the active column, deriving each row's sort key **once** (O(n))
 * instead of inside the comparator, where it would be recomputed O(log n) times
 * per row (~13k derivations over 1166 rows). That derivation is locale-heavy for
 * the `country`/`stateProvince` columns (`countryName`/`subdivisionName` +
 * `toLocaleLowerCase`), and the sort re-runs on every search keystroke and filter
 * change — so the repeated work compounds on exactly the frugal older hardware
 * this audience uses (OFC-104). Decorate-sort-undecorate: map to `{ key, profile }`
 * computing each `sortValue` once, sort on the primitive key (canonical name as
 * the secondary tiebreak), then unwrap. The Name column has no single primitive
 * key — it sorts by the structured (last, first, year) tuple — so it stays on
 * {@link compareCanonical} directly.
 */
export function sortRows<T extends DirectoryProfile>(
  rows: readonly T[],
  key: ColumnKey,
  direction: SortDirection,
): T[] {
  const sign = direction === "asc" ? 1 : -1;

  if (key === "name") {
    return [...rows].sort((a, b) => sign * compareCanonical(a, b));
  }

  const column = COLUMNS[key];
  const decorated = rows.map((profile) => ({ key: column.sortValue(profile), profile }));
  decorated.sort((a, b) =>
    compareSortValues(a.key, b.key, column.compare, sign, a.profile, b.profile),
  );
  return decorated.map((entry) => entry.profile);
}

/**
 * Order two rows by their (already-derived) sort values. Nulls (absent/withheld)
 * always sort last, in BOTH directions — checked before the direction sign so a
 * descending sort never floats "unknown" to the top; two nulls fall through to
 * the canonical secondary key. Shared by {@link makeComparator} and
 * {@link sortRows} so their ordering can never drift apart.
 *
 * `compare` is the column's own value ordering when it has one (Course), else the
 * default {@link compareNonNull}. It is consulted only for two present values, so a
 * column comparator never has to think about nulls or direction.
 */
function compareSortValues(
  av: string | number | null,
  bv: string | number | null,
  compare: GridColumn["compare"],
  sign: number,
  a: DirectoryProfile,
  b: DirectoryProfile,
): number {
  if (av === null || bv === null) {
    if (av !== null) {
      return -1;
    }
    if (bv !== null) {
      return 1;
    }
    return compareCanonical(a, b);
  }
  const primary = (compare ?? compareNonNull)(av, bv) * sign;
  return primary !== 0 ? primary : compareCanonical(a, b);
}

/** Compare two present sort values: numerically for numbers, by locale for strings. */
function compareNonNull(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}
