import { formatCsvCell } from "@pbe/shared";
import type { DirectoryProfile } from "../../lib/types.js";
import { COLUMNS, type ColumnKey, EMPTY_CELL, type GridColumn } from "./grid-model.js";

/**
 * The **displayed-columns CSV** (OFC-403) — the second of the Directory's two
 * exports, and the deliberately *consumer* one.
 *
 * A UAT tester pointed out that a manager almost never wants all sixty-odd fields:
 * he wants the phone numbers and emails of the brothers he just filtered to, and
 * today he gets there by exporting everything and deleting columns in a
 * spreadsheet. So this export writes **what is on screen**: the Name column, then
 * the user's lens columns, in the user's order, with the values the cells show.
 * `csv.ts` in `@pbe/shared` keeps the other job — every field the role may see, in
 * canonical schema order, round-trippable by a future bulk importer (D41/§10).
 * Neither is a substitute for the other, which is why the button now asks.
 *
 * **Why the grid's strings and not the schema's values** (Forrest's call at the
 * plan gate). This file is what a brother hands to someone else: a `country` reads
 * "United States", not `US`; the Name column carries the resolved Canonical Name
 * rather than three discrete name fields. That is precisely what makes it *not* an
 * import format — a reader who needs `US` and a discrete `lastName` wants the all-
 * data export, and the menu says so.
 *
 * Three rules the values follow, each with a reason:
 *
 *  1. **An em-dash becomes an empty cell.** {@link EMPTY_CELL} is a reading aid for
 *     a screen — a spreadsheet's own vocabulary for "no value" is a blank, and a
 *     literal "—" would break every `COUNTA`, sort, and filter the recipient runs.
 *  2. **A cell that renders more than `display` returns uses `csvValue`** — Course,
 *     whose chip strip shows every course while `display` returns the primary alone.
 *  3. **Every cell goes through {@link formatCsvCell}**, the same one `csv.ts` uses,
 *     so the RFC-4180 escaping and the formula-injection neutralisation (S9/OFC-99)
 *     cannot drift between Book's two exports.
 *
 * ⚠ **The column set comes from the lens, which is already role-filtered** —
 * `parseLens` drops any key the role may not select, so a stale saved lens naming a
 * staff column cannot smuggle one into a brother's file. This function does not
 * re-check, and must not be called with a column list from anywhere else.
 */

/**
 * The pinned columns that lead every displayed export, in order. Only **Name**:
 * Select and Star are controls rather than data, and Photo has nothing to write
 * (images are never exported, D41). Name is not in the lens — it is pinned, always
 * on screen — so without this the file could arrive with no way to tell the rows
 * apart, which is the one column a reader cannot do without.
 */
const LEAD_KEYS: readonly ColumnKey[] = ["name"];

/** A column's cell text for this export: `csvValue` when it has one, else `display`. */
function cell(column: GridColumn, profile: DirectoryProfile, name: string): string {
  const text = column.csvValue ? column.csvValue(profile) : column.display(profile, name);
  return text === EMPTY_CELL ? "" : text;
}

/**
 * Serialise `rows` to a CSV of the Name column plus `visible`, in that order.
 * `nameOf` resolves a row's Canonical Name (the Directory already holds the
 * one-pass ambiguity resolution, so it is passed in rather than recomputed).
 * Lines are CRLF-terminated (RFC 4180 / Excel), like the canonical export.
 */
export function displayedColumnsToCsv(
  rows: readonly DirectoryProfile[],
  visible: readonly ColumnKey[],
  nameOf: (profile: DirectoryProfile) => string,
): string {
  const columns = [...LEAD_KEYS, ...visible].map((key) => COLUMNS[key]);
  const header = columns.map((column) => formatCsvCell(column.label)).join(",");
  const lines = rows.map((row) => {
    const name = nameOf(row);
    return columns.map((column) => formatCsvCell(cell(column, row, name))).join(",");
  });
  return [header, ...lines].join("\r\n");
}
