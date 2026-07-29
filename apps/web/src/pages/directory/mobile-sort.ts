import type { Role } from "@pbe/shared";
import { COLUMNS, type ColumnKey, columnAllowsRole } from "./grid-model.js";

/**
 * Which fields the phone's "Sort by" select offers (OFC-364).
 *
 * On a phone the Directory renders cards, not a table, so there are no column
 * headers — and the header click was the *only* sort affordance in the app. The
 * sort itself always worked (it lives in the URL); it was simply unreachable
 * below `md` unless you hand-edited `?sort=`.
 *
 * The offer is **Canonical Name plus the lens's currently visible, sortable data
 * fields** — Forrest's call at the OFC-364 plan gate. It mirrors the desktop rule
 * (you can only sort by a column you can see) and keeps one mental model: *Fields*
 * chooses both what the cards show and what you can sort by. A field you want to
 * sort by but not display is one tap away in Fields.
 *
 * The one exception is the **active** key, which is appended even when it is not
 * visible: a link like `?sort=email&cols=classYear` arrives with a sort whose field
 * the lens hides, and a select whose `value` names no option renders blank in some
 * browsers and picks the first option in others — either way misreporting the sort
 * actually in force. Better to name it. It is still filtered by role, so a URL
 * naming a staff-only field can never surface that field's label to a brother.
 */
export function mobileSortKeys(
  visible: readonly ColumnKey[],
  active: ColumnKey,
  role: Role,
): ColumnKey[] {
  // Canonical Name is the default sort and a pinned column — always offered, always
  // first, never dependent on the lens.
  const keys: ColumnKey[] = ["name"];

  for (const key of visible) {
    if (isOfferable(key, role) && !keys.includes(key)) {
      keys.push(key);
    }
  }

  if (!keys.includes(active) && isOfferable(active, role)) {
    keys.push(active);
  }

  return keys;
}

/** A field may be offered when it exists, sorts, and this role may see it. */
function isOfferable(key: ColumnKey, role: Role): boolean {
  const column = COLUMNS[key];
  return column?.sortable === true && columnAllowsRole(column, role);
}
