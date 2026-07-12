import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * The manager/admin **row selection** model (§5.6.8, D41 as amended by N79/OFC-196).
 *
 * Selection is private, transient working state that feeds the CSV Export (D90/D92
 * — the only bulk action left over a selection after D100 dropped bulk-delete). It
 * is keyed by stable Constitution ID, and it **persists across search, filter,
 * sort, and navigation** so a user can build a disjoint set — filter to '70, select
 * all, filter to '80, select all, export both. That reverses D41's original
 * clear-on-view-change (whose sole rationale, scoping a destructive bulk delete to
 * visible rows, died with D100): keeping ids out of view is now safe because the
 * only consumer is a benign, consent-gated export.
 *
 * It lives in a **per-instance in-memory context** mounted above the routes — a
 * fourth state bucket beyond D31's URL / History / localStorage split, for state
 * that is private (never in a shared link, like the stars it feeds), transient
 * (dropped on a full reload or in a new tab), and session-scoped (must outlive the
 * Directory's remount on navigation). The provider sits inside the authenticated
 * gate, so signing out unmounts it and clears the selection for free.
 */
export interface Selection {
  selected: ReadonlySet<number>;
  isSelected: (id: number) => boolean;
  toggle: (id: number) => void;
  /** Union `ids` into the selection (header select-all over the visible view). */
  addAll: (ids: readonly number[]) => void;
  /** Remove `ids` from the selection (header deselect over the visible view) — never
   *  touches selections outside `ids`, so off-view picks survive. */
  removeAll: (ids: readonly number[]) => void;
  clear: () => void;
  count: number;
}

// Pure set transforms — the provider is a thin `useState` shell over these, so the
// selection algebra is unit-tested directly (no DOM harness). Each preserves the
// input reference when it would be a no-op, so a redundant call skips a re-render.
export function toggled(prev: Set<number>, id: number): Set<number> {
  const next = new Set(prev);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function added(prev: Set<number>, ids: readonly number[]): Set<number> {
  if (ids.every((id) => prev.has(id))) {
    return prev;
  }
  const next = new Set(prev);
  for (const id of ids) {
    next.add(id);
  }
  return next;
}

export function removed(prev: Set<number>, ids: readonly number[]): Set<number> {
  if (!ids.some((id) => prev.has(id))) {
    return prev;
  }
  const next = new Set(prev);
  for (const id of ids) {
    next.delete(id);
  }
  return next;
}

const SelectionCtx = createContext<Selection | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  const isSelected = useCallback((id: number) => selected.has(id), [selected]);
  const toggle = useCallback((id: number) => setSelected((prev) => toggled(prev, id)), []);
  const addAll = useCallback(
    (ids: readonly number[]) => setSelected((prev) => added(prev, ids)),
    [],
  );
  const removeAll = useCallback(
    (ids: readonly number[]) => setSelected((prev) => removed(prev, ids)),
    [],
  );
  const clear = useCallback(() => setSelected((prev) => (prev.size === 0 ? prev : new Set())), []);

  const value = useMemo<Selection>(
    () => ({ selected, isSelected, toggle, addAll, removeAll, clear, count: selected.size }),
    [selected, isSelected, toggle, addAll, removeAll, clear],
  );

  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>;
}

export function useSelection(): Selection {
  const ctx = useContext(SelectionCtx);
  if (!ctx) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return ctx;
}
