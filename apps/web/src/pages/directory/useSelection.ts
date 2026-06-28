import { useCallback, useRef, useState } from "react";

/**
 * The manager/admin **row selection** model (§5.6.8, D41). Selection is transient
 * in-memory state that feeds Export, and it **clears whenever the search/filter
 * view changes**, so an export stays scoped to what the user can currently see —
 * never to rows scrolled out of, or filtered away from, the current view.
 *
 * The clear is keyed on `viewKey` (the search/filter signature) and applied at
 * render time (the React "reset state when a prop changes" pattern), so the
 * selection is already empty on the first render of a changed view rather than a
 * frame later. Sort and column-lens changes deliberately do **not** clear it —
 * they reorder the same row set, so `viewKey` excludes them.
 */
export interface Selection {
  selected: ReadonlySet<number>;
  isSelected: (id: number) => boolean;
  toggle: (id: number) => void;
  /** Replace the selection with exactly `ids` (header select-all over the view). */
  setAll: (ids: readonly number[]) => void;
  clear: () => void;
  count: number;
}

export function useSelection(viewKey: string): Selection {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  // Reset on a view change, during render, so a changed view never momentarily
  // shows a stale selection.
  const lastViewKey = useRef(viewKey);
  if (lastViewKey.current !== viewKey) {
    lastViewKey.current = viewKey;
    if (selected.size > 0) {
      setSelected(new Set());
    }
  }

  const isSelected = useCallback((id: number) => selected.has(id), [selected]);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const setAll = useCallback((ids: readonly number[]) => setSelected(new Set(ids)), []);
  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, isSelected, toggle, setAll, clear, count: selected.size };
}
