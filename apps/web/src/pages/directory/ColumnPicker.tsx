import { Columns3 } from "lucide-react";
import { useId, useRef } from "react";
import { trackColumnLayoutChanged, trackColumnsReset } from "../../lib/analytics.js";
import { useDetailsAutoClose } from "../../lib/useDetailsAutoClose.js";
import type { ColumnGroup } from "./grid-model.js";
import type { ColumnLens } from "./useColumnLens.js";

/**
 * The **column-lens picker** (§5.6.1, D30): choose which data columns appear.
 * Built on a native `<details>` disclosure so it is keyboard- and
 * screen-reader-operable by construction (the Radix-popover enrichment is a
 * Phase 6 nicety, not a baseline need). Order is changed by dragging the column
 * headers (the grips); this menu governs *membership* and offers Reset.
 *
 * The restricted, manager/administrator-only columns appear in their own labelled
 * group only when the role may select them — the lens already filters them out
 * for brothers, so the section is simply absent there.
 *
 * **The control is called "Fields" on a phone** (OFC-364): below `md` the Directory
 * renders cards, not a table, so there are no columns on screen and the desktop
 * word names nothing the reader can see. The underlying model, the `cols` URL
 * parameter, the localStorage key, and the analytics event names are unchanged —
 * this is the visible word only, chosen by the caller that knows the width.
 */

const GROUP_LABEL: Partial<Record<ColumnGroup, "optional" | "restricted">> = {
  optional: "optional",
  restricted: "restricted",
};

/**
 * Every string that changes with the layout's word for a column. Grouped in one
 * table so the two vocabularies stay parallel and a future third caller can't
 * half-rename the control.
 */
const WORDING = {
  columns: {
    trigger: "Columns",
    legend: "Choose which columns to show",
    optional: "More columns",
    restricted: "Staff columns",
    reset: "Reset to default columns",
  },
  fields: {
    trigger: "Fields",
    legend: "Choose which fields to show",
    optional: "More fields",
    restricted: "Staff fields",
    reset: "Reset to default fields",
  },
} as const;

export function ColumnPicker({
  lens,
  wording = "columns",
}: {
  lens: ColumnLens;
  /** Which vocabulary to show: table columns (desktop) or card fields (phone, OFC-364). */
  wording?: keyof typeof WORDING;
}) {
  const words = WORDING[wording];
  const panelId = useId();
  const ref = useRef<HTMLDetailsElement>(null);
  useDetailsAutoClose(ref);

  // Group the available (role-permitted) columns for a tidy menu; the default
  // data columns lead, then optional, then the staff-only restricted set.
  const groups: ColumnGroup[] = ["default", "optional", "restricted"];

  return (
    <details ref={ref} className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Columns3 size={15} strokeWidth={1.4} aria-hidden="true" />
        {words.trigger}
      </summary>
      <div
        id={panelId}
        className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
      >
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">{words.legend}</legend>
          {groups.map((group) => {
            const columns = lens.available.filter((column) => column.group === group);
            if (columns.length === 0) {
              return null;
            }
            return (
              <div key={group} className="mb-1 last:mb-0">
                {GROUP_LABEL[group] && (
                  <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {words[GROUP_LABEL[group]]}
                  </p>
                )}
                {columns.map((column) => (
                  <label
                    key={column.key}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={lens.isVisible(column.key)}
                      onChange={() => {
                        // The column key is a schema field *name* (e.g. `email`),
                        // not brother data (7a-4). New visibility is the negation of
                        // the current one.
                        trackColumnLayoutChanged(column.key, !lens.isVisible(column.key));
                        lens.toggle(column.key);
                      }}
                      className="size-4 accent-[var(--primary)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </fieldset>
        <div className="mt-1 border-t border-border pt-1">
          <button
            type="button"
            onClick={() => {
              trackColumnsReset();
              lens.reset();
            }}
            className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
          >
            {words.reset}
          </button>
        </div>
      </div>
    </details>
  );
}
