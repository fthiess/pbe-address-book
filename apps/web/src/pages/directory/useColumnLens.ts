import type { Role } from "@pbe/shared";
import { useCallback, useMemo, useState } from "react";
import {
  COLUMNS,
  type ColumnKey,
  DEFAULT_DATA_KEYS,
  columnAllowsRole,
  selectableColumns,
} from "./grid-model.js";

/**
 * The **column lens** (D30/D31) — the user's personal choice of *which* data
 * columns appear and in *what order*. It is a personal preference, so it lives in
 * `localStorage`, deliberately **not** in the URL: a shared link reproduces the
 * sender's search/filter/sort view (§5.4) without imposing the sender's columns.
 *
 * The lens covers only the reorderable data columns; the frozen identity columns
 * (Thumbnail, Canonical Name) are always shown and never part of it. The stored
 * value is reconciled against the current model and role on every load, so a
 * column removed from the app, or one a role may not see, is silently dropped
 * rather than rendered against missing data.
 */

const STORAGE_KEY = "pbe.book.directory.columns.v1";

interface PersistedLens {
  /** Ordered list of visible data-column keys. */
  visible: ColumnKey[];
}

/** Read and sanitise the persisted lens for this role, or null if none/invalid. */
function loadLens(role: Role): ColumnKey[] | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedLens>;
    if (!Array.isArray(parsed.visible)) {
      return null;
    }
    // Keep only keys that still exist in the model, are non-pinned, and are
    // visible to this role; de-duplicate while preserving order.
    const seen = new Set<ColumnKey>();
    const clean = parsed.visible.filter((key): key is ColumnKey => {
      const column = COLUMNS[key as ColumnKey];
      if (!column || column.pinned || !columnAllowsRole(column, role) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    return clean;
  } catch {
    return null;
  }
}

/** Persist the lens, ignoring quota/availability failures (a non-critical preference). */
function saveLens(visible: ColumnKey[]): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ visible } satisfies PersistedLens));
  } catch {
    // localStorage unavailable or full — the lens simply won't persist.
  }
}

/** The default lens: the role-identical default data columns, in their default order. */
function defaultLens(): ColumnKey[] {
  return [...DEFAULT_DATA_KEYS];
}

export interface ColumnLens {
  /** Visible data columns, in display order (excludes the pinned identity block). */
  visible: ColumnKey[];
  /** Every non-pinned column this role may select, for the picker menu. */
  available: ReturnType<typeof selectableColumns>;
  /** Whether a column is currently shown. */
  isVisible: (key: ColumnKey) => boolean;
  /** Show/hide a data column; showing appends it at the end of the order. */
  toggle: (key: ColumnKey) => void;
  /** Replace the visible-column order (the drag-reorder commit). */
  setOrder: (keys: ColumnKey[]) => void;
  /** Restore the default column set and order. */
  reset: () => void;
}

/** Manage the persisted column lens for the signed-in role. */
export function useColumnLens(role: Role): ColumnLens {
  const [visible, setVisible] = useState<ColumnKey[]>(() => loadLens(role) ?? defaultLens());

  const available = useMemo(() => selectableColumns(role), [role]);

  const commit = useCallback((next: ColumnKey[]) => {
    setVisible(next);
    saveLens(next);
  }, []);

  const isVisible = useCallback((key: ColumnKey) => visible.includes(key), [visible]);

  const toggle = useCallback(
    (key: ColumnKey) => {
      const column = COLUMNS[key];
      if (!column || column.pinned || !columnAllowsRole(column, role)) {
        return;
      }
      commit(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]);
    },
    [visible, role, commit],
  );

  const setOrder = useCallback(
    (keys: ColumnKey[]) => {
      // Accept only a permutation of the currently-visible set, so a reorder can
      // never smuggle in or drop a column (that is `toggle`'s job).
      const current = new Set(visible);
      const reordered = keys.filter((key) => current.has(key));
      if (reordered.length === visible.length) {
        commit(reordered);
      }
    },
    [visible, commit],
  );

  const reset = useCallback(() => commit(defaultLens()), [commit]);

  return { visible, available, isVisible, toggle, setOrder, reset };
}
