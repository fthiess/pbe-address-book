import { type Role, countryName, formatConstitutionId, subdivisionName } from "@pbe/shared";
import type { DirectoryProfile } from "../../lib/types.js";

/**
 * The Directory grid's **column model** — the single declarative source the
 * grid, the column-lens menu, the sort logic, and the (future) CSV export all
 * read from (PRD §5.6.1/§5.6.2). Keeping every column's identity, display
 * accessor, sort key, width, and role-visibility in one table means adding or
 * regrouping a column is a one-line change here rather than edits scattered
 * across the render.
 *
 * Phase 3a builds the grid skeleton: the two frozen identity columns
 * (Thumbnail, Canonical Name), the role-identical default data columns, and the
 * manager/administrator restricted columns (off by default). The **Select** and
 * **Star** pinned columns and the structured **filters** (§5.6.4–5.6.8) are not
 * modelled here yet — they arrive with their behaviour in Sessions 3b/3c.
 */

/** Every column the grid can show, keyed by a stable id (also its lens key). */
export type ColumnKey =
  // Frozen pinned block (always present, left, non-reorderable):
  | "select" // manager/admin row-selection checkbox (capability-gated)
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
  | "mugName"
  | "constitutionId"
  // Restricted, manager/administrator only (§5.6.1, off by default):
  | "allowNewsletterEmail"
  | "allowCommentReplyEmail"
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
}

/** The resize bounds shared by the lens, the resize handle, and auto-fit (N16/N27). */
export const MIN_COLUMN_WIDTH = 64;
export const MAX_COLUMN_WIDTH = 640;

/** A brother's primary major is the first entry in his (owner-ordered) list (§5.6.1). */
function primaryMajor(profile: DirectoryProfile): string | null {
  return profile.majors?.[0] ?? null;
}

/** "—" placeholder for an absent/withheld value, kept out of assistive announcements. */
const EMPTY = "—";

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
    // Manager/admin-only row selection for Export (§5.6.8); a single capability
    // predicate (`canSelectRows`) gates it, not scattered role checks (D33).
    roles: STAFF,
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
    display: (p) => (p.classYear == null ? EMPTY : String(p.classYear)),
    sortValue: (p) => p.classYear ?? null,
  },
  major: {
    key: "major",
    // MIT "majors" are called **courses** — the column is headed "Course"
    // (the underlying field stays `majors`). The cell renders the primary
    // course as a colour-coded chip (see CourseChip); this string is the
    // sort/export value.
    label: "Course",
    group: "default",
    width: 120,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => primaryMajor(p) ?? EMPTY,
    sortValue: (p) => primaryMajor(p),
  },
  email: {
    key: "email",
    label: "Email",
    group: "default",
    width: 224,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => p.email ?? EMPTY,
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
    display: (p) => p.phone ?? EMPTY,
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
    display: (p) => p.address?.city ?? EMPTY,
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
        : EMPTY,
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
    display: (p) => (p.address?.country ? countryName(p.address.country) : EMPTY),
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
    display: (p) => p.fullLegalName ?? EMPTY,
    sortValue: (p) => p.fullLegalName?.toLocaleLowerCase() ?? null,
  },
  mugName: {
    key: "mugName",
    // A brother's house "mug" name — the fraternity nickname (often whimsical and
    // unrelated to his given name), a public field and one of the searched name
    // fields (D35). Off by default, selectable by any role.
    label: "Mug Name",
    group: "optional",
    width: 168,
    align: "start",
    pinned: false,
    sortable: true,
    display: (p) => p.mugName ?? EMPTY,
    sortValue: (p) => p.mugName?.toLocaleLowerCase() ?? null,
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
  allowCommentReplyEmail: {
    key: "allowCommentReplyEmail",
    label: "Comment replies",
    group: "restricted",
    width: 132,
    align: "start",
    pinned: false,
    sortable: true,
    roles: STAFF,
    display: (p) => yesNo(p.allowCommentReplyEmail),
    sortValue: (p) => boolRank(p.allowCommentReplyEmail),
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
    display: (p) => (p.lastModified ? p.lastModified.slice(0, 10) : EMPTY),
    sortValue: (p) => p.lastModified ?? null,
  },
};

/** Yes/No rendering for a boolean consent column (text, never colour alone — D32). */
function yesNo(value: boolean | undefined): string {
  return value === undefined ? EMPTY : value ? "Yes" : "No";
}

/** Sort rank for a boolean: false < true, with undefined (withheld) last. */
function boolRank(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

/**
 * The single capability predicate for the manager/admin **Select** column and
 * its action bar (D33/D41): one place to decide "may this role select rows,"
 * rather than role checks scattered through the grid — so the deferred
 * "share this selection" feature (PRD §3.2) can enable selection for everyone
 * with a one-line change here.
 */
export function canSelectRows(role: Role): boolean {
  return role === "manager" || role === "admin";
}

/**
 * The frozen pinned columns in fixed left-to-right order (§5.6.1): the
 * capability-gated **Select**, the universal **Star**, then the **Thumbnail** and
 * **Canonical Name** identity block. These never appear in the lens (they are
 * always present, never reordered) and freeze as a contiguous block on
 * horizontal scroll.
 */
export function pinnedColumnsForRole(role: Role): GridColumn[] {
  const keys: ColumnKey[] = canSelectRows(role)
    ? ["select", "star", "thumbnail", "name"]
    : ["star", "thumbnail", "name"];
  return keys.map((key) => COLUMNS[key]);
}

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
  return (a, b) => {
    const av = column.sortValue(a);
    const bv = column.sortValue(b);
    // Nulls (absent/withheld) always sort last, in BOTH directions — checked
    // before the direction sign so a descending sort never floats "unknown" to
    // the top. Two nulls fall through to the canonical secondary key.
    if (av === null || bv === null) {
      if (av !== null) {
        return -1;
      }
      if (bv !== null) {
        return 1;
      }
      return compareCanonical(a, b);
    }
    const primary = compareNonNull(av, bv) * sign;
    return primary !== 0 ? primary : compareCanonical(a, b);
  };
}

/** Compare two present sort values: numerically for numbers, by locale for strings. */
function compareNonNull(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}
