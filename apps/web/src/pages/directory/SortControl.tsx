import type { Role } from "@pbe/shared";
import { useId } from "react";
import { COLUMNS, type ColumnKey, type SortDirection } from "./grid-model.js";
import { mobileSortKeys } from "./mobile-sort.js";
import type { ColumnLens } from "./useColumnLens.js";
import type { DirectorySort } from "./useDirectorySort.js";

/**
 * The **phone Sort control** (OFC-364), rendered only inside the mobile "Options"
 * fold (N92/OFC-211). Below `md` the Directory renders cards rather than a table,
 * and a column header was the app's only sort affordance — so on a phone the sort
 * was reachable only by hand-editing `?sort=` in the URL. UAT found it; this is the
 * affordance that was missing.
 *
 * Two native `<select>`s — the field, then the direction. Native rather than a
 * custom popover on purpose: they are keyboard- and screen-reader-correct by
 * construction (so they cost the a11y gate nothing to satisfy, D79), they add no
 * bytes to a bundle this audience may pull over a slow link, and on a phone the
 * platform renders them as its own full-height picker, which is a far better touch
 * target than anything drawn in the page.
 *
 * The two selects drive `setSortKey` / `setDirection` rather than the grid's
 * `toggleSort`: a dropdown must move exactly the dimension it names, where a header
 * click deliberately does both (new column ⇒ ascending). Sort state itself is
 * unchanged and still lives in the URL (D31), so a sort set on a phone survives a
 * reload, walks back/forward, and travels in a shared link exactly as on desktop.
 */
export function SortControl({
  sort,
  lens,
  role,
}: {
  sort: DirectorySort;
  lens: ColumnLens;
  role: Role;
}) {
  const fieldId = useId();
  const orderId = useId();
  const keys = mobileSortKeys(lens.visible, sort.sortKey, role);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-xs font-medium">
          Sort by
        </label>
        <select
          id={fieldId}
          value={sort.sortKey}
          onChange={(event) => sort.setSortKey(event.target.value as ColumnKey)}
          className={SELECT_CLASS}
        >
          {keys.map((key) => (
            <option key={key} value={key}>
              {COLUMNS[key].label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={orderId} className="text-xs font-medium">
          Order
        </label>
        <select
          id={orderId}
          value={sort.direction}
          onChange={(event) => sort.setDirection(event.target.value as SortDirection)}
          className={SELECT_CLASS}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>
    </div>
  );
}

/** The filter panel's field styling, so the fold's controls read as one set. */
const SELECT_CLASS =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
