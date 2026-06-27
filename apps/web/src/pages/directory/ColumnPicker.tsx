import { useId, useRef } from "react";
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
 */

const GROUP_LABEL: Partial<Record<ColumnGroup, string>> = {
  optional: "More columns",
  restricted: "Staff columns",
};

export function ColumnPicker({ lens }: { lens: ColumnLens }) {
  const panelId = useId();
  const ref = useRef<HTMLDetailsElement>(null);
  useDetailsAutoClose(ref);

  // Group the available (role-permitted) columns for a tidy menu; the default
  // data columns lead, then optional, then the staff-only restricted set.
  const groups: ColumnGroup[] = ["default", "optional", "restricted"];

  return (
    <details ref={ref} className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ColumnsIcon />
        Columns
      </summary>
      <div
        id={panelId}
        className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
      >
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">Choose which columns to show</legend>
          {groups.map((group) => {
            const columns = lens.available.filter((column) => column.group === group);
            if (columns.length === 0) {
              return null;
            }
            return (
              <div key={group} className="mb-1 last:mb-0">
                {GROUP_LABEL[group] && (
                  <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABEL[group]}
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
                      onChange={() => lens.toggle(column.key)}
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
            onClick={lens.reset}
            className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
          >
            Reset to default columns
          </button>
        </div>
      </div>
    </details>
  );
}

function ColumnsIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <rect x="1.5" y="2" width="12" height="11" rx="1.5" />
      <line x1="5.8" y1="2" x2="5.8" y2="13" />
      <line x1="9.6" y1="2" x2="9.6" y2="13" />
    </svg>
  );
}
