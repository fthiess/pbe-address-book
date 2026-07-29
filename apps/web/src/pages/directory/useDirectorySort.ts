import { useQueryState } from "nuqs";
import { useCallback, useMemo } from "react";
import { COLUMNS, type ColumnKey, type SortDirection } from "./grid-model.js";

/**
 * The active sort — part of the **shareable view**, so it lives in the URL query
 * string (D31/§5.4): `?sort=<column>&dir=desc`. The initial sort is Canonical
 * Name ascending (§5.6.2), encoded as the *absence* of the params, so a pristine
 * directory URL stays clean and the default never bloats a shared link.
 *
 * Sorting is single-column. Clicking a header sorts that column ascending;
 * clicking the active header again toggles to descending (§5.6.2). The grid then
 * applies the (last, first, year) canonical order as the universal secondary key
 * (see `makeComparator`).
 *
 * `toggleSort` encodes *header* semantics, which are wrong for a pair of
 * dropdowns: picking a field there must not silently reset the direction, and
 * picking the field you are already sorted by must not flip it. So the phone's
 * Sort control (OFC-364) drives {@link DirectorySort.setSortKey} and
 * {@link DirectorySort.setDirection} instead — each moves exactly the one
 * dimension its `<select>` names.
 */

const DEFAULT_KEY: ColumnKey = "name";
const DEFAULT_DIRECTION: SortDirection = "asc";

/** A sort key is valid only if it names a sortable column in the current model. */
function isSortableKey(value: string | null): value is ColumnKey {
  return value !== null && value in COLUMNS && COLUMNS[value as ColumnKey].sortable;
}

export interface DirectorySort {
  sortKey: ColumnKey;
  direction: SortDirection;
  /** Header click: a new column sorts ascending; the active column toggles direction. */
  toggleSort: (key: ColumnKey) => void;
  /** Sort by `key`, keeping the current direction — the phone's "Sort by" select (OFC-364). */
  setSortKey: (key: ColumnKey) => void;
  /** Set the direction outright, keeping the current column — the phone's "Order" select (OFC-364). */
  setDirection: (direction: SortDirection) => void;
  /** Restore the default sort (Canonical Name ascending) — used by Reset (D38). */
  reset: () => void;
}

export function useDirectorySort(): DirectorySort {
  // Sort is a discrete change, so it pushes a history entry — back/forward walk
  // through sort changes (D31, refined; live search stays on replace).
  const [rawKey, setKey] = useQueryState("sort", { defaultValue: DEFAULT_KEY, history: "push" });
  const [rawDir, setDir] = useQueryState("dir", {
    defaultValue: DEFAULT_DIRECTION,
    history: "push",
  });

  // Clamp whatever the URL carries to the valid space, so a hand-edited or stale
  // link can never select a non-existent column or a bogus direction.
  const sortKey = isSortableKey(rawKey) ? rawKey : DEFAULT_KEY;
  const direction: SortDirection = rawDir === "desc" ? "desc" : "asc";

  const toggleSort = useCallback(
    (key: ColumnKey) => {
      if (!COLUMNS[key]?.sortable) {
        return;
      }
      if (key === sortKey) {
        const next: SortDirection = direction === "asc" ? "desc" : "asc";
        void setDir(next === DEFAULT_DIRECTION ? null : next);
      } else {
        void setKey(key === DEFAULT_KEY ? null : key);
        void setDir(null); // new column always starts ascending (the default)
      }
    },
    [sortKey, direction, setKey, setDir],
  );

  // Both setters write `null` for the default value, so a pristine sort keeps the
  // URL clean (and a shared link never carries `?sort=name&dir=asc`) — the same
  // encoding `toggleSort` uses.
  const setSortKey = useCallback(
    (key: ColumnKey) => {
      if (!COLUMNS[key]?.sortable) {
        return;
      }
      void setKey(key === DEFAULT_KEY ? null : key);
    },
    [setKey],
  );

  const setDirection = useCallback(
    (next: SortDirection) => {
      void setDir(next === DEFAULT_DIRECTION ? null : next);
    },
    [setDir],
  );

  const reset = useCallback(() => {
    void setKey(null);
    void setDir(null);
  }, [setKey, setDir]);

  return useMemo(
    () => ({ sortKey, direction, toggleSort, setSortKey, setDirection, reset }),
    [sortKey, direction, toggleSort, setSortKey, setDirection, reset],
  );
}
