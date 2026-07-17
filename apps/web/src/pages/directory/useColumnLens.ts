import type { Role } from "@pbe/shared";
import { useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  COLUMNS,
  type ColumnKey,
  DEFAULT_DATA_KEYS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  columnAllowsRole,
  selectableColumns,
} from "./grid-model.js";

/**
 * The **column lens** (D30/D31, refined) — the user's choice of *which* data
 * columns appear, in *what order*, and at *what width*.
 *
 * It is a personal preference, so it persists in **localStorage** as the durable
 * default. It is **also mirrored into the URL** (`?cols=…`, only when non-default)
 * so a view is fully shareable and walks the browser back/forward history — a
 * deliberate refinement of D30/D31, which originally kept columns out of the URL.
 * The original concern (a shared link must not clobber the recipient's saved
 * column setup) is preserved: a URL that arrives carrying a `cols` that **differs
 * from the user's own saved default** is a *foreign* view — applied to the page
 * but **never written back to localStorage**; only edits to the user's own view
 * update their saved default. The URL is the single source of truth for the active
 * lens; localStorage seeds it on first load and records each edit.
 *
 * "Foreign" is decided by comparing the incoming `cols` against the persisted
 * value, **not** by mere URL presence (OFC-263/N104): `apply` writes the URL and
 * localStorage in lock-step, so the user's *own* view always satisfies
 * `cols === saved` after any reload — including the hard reload that "View as"
 * impersonation performs (N31), which preserves the URL. The old URL-presence test
 * misread that reload as a shared link, latched the view "foreign", and so broke
 * "Reset to default columns" for the rest of the session.
 *
 * Width clamps and the `cols` grammar live here; the resize affordance and the
 * grid template consume `getWidth`.
 */

const STORAGE_KEY = "pbe.book.directory.columns.v1";
const MIN_WIDTH = MIN_COLUMN_WIDTH;
const MAX_WIDTH = MAX_COLUMN_WIDTH;

/** The active lens: visible data columns in order, plus per-column width overrides. */
interface Lens {
  order: ColumnKey[];
  widths: Partial<Record<ColumnKey, number>>;
}

function defaultLens(): Lens {
  return { order: [...DEFAULT_DATA_KEYS], widths: {} };
}

function clampWidth(value: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)));
}

/** Whether a lens is the pristine default (default order, no width overrides). */
function isDefaultLens(lens: Lens): boolean {
  return (
    Object.keys(lens.widths).length === 0 &&
    lens.order.length === DEFAULT_DATA_KEYS.length &&
    lens.order.every((key, i) => key === DEFAULT_DATA_KEYS[i])
  );
}

/**
 * Parse a lens from its compact string form, sanitised against the model and
 * role. Grammar: comma-separated `key` or `key:width` tokens. A **non-pinned**
 * key joins the visible order (its width, if given, overrides the default); a
 * **pinned** key (e.g. `name`) is a width-only override and does not affect order.
 */
export function parseLens(raw: string, role: Role): Lens {
  const order: ColumnKey[] = [];
  const widths: Partial<Record<ColumnKey, number>> = {};
  const seen = new Set<ColumnKey>();
  for (const token of raw.split(",")) {
    const [rawKey, rawWidth] = token.split(":");
    const key = rawKey as ColumnKey;
    const column = COLUMNS[key];
    if (!column || seen.has(key) || !columnAllowsRole(column, role)) {
      continue;
    }
    seen.add(key);
    if (rawWidth !== undefined && rawWidth !== "") {
      const width = Number.parseInt(rawWidth, 10);
      if (Number.isFinite(width)) {
        widths[key] = clampWidth(width);
      }
    }
    if (!column.pinned) {
      order.push(key);
    }
  }
  // A lens that parsed to no visible data columns is treated as the default, so
  // a malformed — or pinned-width-only (e.g. `?cols=name:300`) — `cols` can never
  // leave the grid showing the identity block alone (OFC-100). The check is on
  // `order` only: a non-empty `widths` (a pinned override with no data columns)
  // must NOT suppress the fallback, or the grid renders zero data columns.
  return order.length === 0 ? defaultLens() : { order, widths };
}

/** Serialise a lens to its `cols` string (pinned width overrides lead, then the order). */
export function serializeLens(lens: Lens): string {
  const tokens: string[] = [];
  // Pinned (e.g. name) width overrides — width-only tokens that don't affect order.
  for (const key of Object.keys(lens.widths) as ColumnKey[]) {
    if (COLUMNS[key]?.pinned) {
      tokens.push(`${key}:${lens.widths[key]}`);
    }
  }
  for (const key of lens.order) {
    const width = lens.widths[key];
    tokens.push(width === undefined ? key : `${key}:${width}`);
  }
  return tokens.join(",");
}

/** The raw persisted `cols` string, exactly as `saveLens` wrote it (unparsed). */
function loadSavedRaw(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function loadSaved(role: Role): Lens | null {
  const raw = loadSavedRaw();
  return raw ? parseLens(raw, role) : null;
}

function saveLens(lens: Lens): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, serializeLens(lens));
  } catch {
    // localStorage unavailable or full — the lens simply won't persist.
  }
}

export interface ColumnLens {
  /** Visible data columns, in display order (excludes the pinned identity block). */
  visible: ColumnKey[];
  /** Every non-pinned column this role may select, for the picker menu. */
  available: ReturnType<typeof selectableColumns>;
  /** The effective width of a column (override, else the model default). */
  getWidth: (key: ColumnKey) => number;
  isVisible: (key: ColumnKey) => boolean;
  /** Show/hide a data column; showing appends it at the end of the order. */
  toggle: (key: ColumnKey) => void;
  /** Replace the visible-column order (the drag-reorder commit). */
  setOrder: (keys: ColumnKey[]) => void;
  /** Set (and persist) a column's width — the resize commit. */
  setWidth: (key: ColumnKey, width: number) => void;
  /** Restore the default columns, order, and widths. */
  reset: () => void;
}

export function useColumnLens(role: Role): ColumnLens {
  // The URL carries the lens (push history on edits, so back/forward walk them).
  const [cols, setCols] = useQueryState("cols", { history: "push" });

  // The saved default, read once; seeds the URL and absorbs edits.
  const savedRef = useRef<Lens | null>(null);
  if (savedRef.current === null) {
    savedRef.current = loadSaved(role) ?? defaultLens();
  }

  // Whether this view arrived carrying a *foreign* shared `?cols=` link — a lens
  // that differs from the user's own saved default. Captured once, from the initial
  // URL, on first render. Edits to a shared-link view update the URL (so the view
  // stays shareable and walks history) but must NEVER be written back to the
  // recipient's own localStorage default: opening someone's shared link and
  // tweaking a column must not clobber the column setup the recipient had saved
  // (D30/D31, OFC-101). Only edits to the user's *own* view persist.
  //
  // The discriminator is a comparison against the persisted raw value, NOT mere URL
  // presence (OFC-263/N104). `apply` writes the URL and localStorage from the same
  // serialisation, so the user's own view has `cols === saved` after any reload —
  // including "View as" impersonation's hard reload (N31), which keeps the URL. The
  // comparison is on the raw strings, before role-parsing, so a saved staff-only
  // column (filtered out of a brother's *displayed* lens) can't make the own view
  // look foreign. A shared link — a lens the recipient never saved — differs, and
  // stays transient.
  const fromSharedLink = useRef<boolean | null>(null);
  if (fromSharedLink.current === null) {
    fromSharedLink.current = cols != null && cols !== loadSavedRaw();
  }

  // Active lens = the URL when present, else the saved default.
  const active = useMemo<Lens>(
    () => (cols != null ? parseLens(cols, role) : (savedRef.current ?? defaultLens())),
    [cols, role],
  );

  // On first load with a clean URL, reflect a non-default saved lens into the URL
  // (replace, no history entry) so the URL is authoritative thereafter. A URL that
  // already carries `cols` (a shared link) is left as-is and never persisted.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) {
      return;
    }
    seeded.current = true;
    const saved = savedRef.current;
    if (cols == null && saved && !isDefaultLens(saved)) {
      void setCols(serializeLens(saved), { history: "replace" });
    }
  }, [cols, setCols]);

  const apply = useCallback(
    (next: Lens) => {
      // Persist to the user's own saved default only when this is their own view;
      // a shared-link view is transient (URL-only) and never touches localStorage.
      if (!fromSharedLink.current) {
        saveLens(next);
        savedRef.current = next;
      }
      void setCols(isDefaultLens(next) ? null : serializeLens(next), { history: "push" });
    },
    [setCols],
  );

  const getWidth = useCallback(
    (key: ColumnKey) => active.widths[key] ?? COLUMNS[key].width,
    [active],
  );
  const isVisible = useCallback((key: ColumnKey) => active.order.includes(key), [active]);

  const toggle = useCallback(
    (key: ColumnKey) => {
      const column = COLUMNS[key];
      if (!column || column.pinned || !columnAllowsRole(column, role)) {
        return;
      }
      const order = active.order.includes(key)
        ? active.order.filter((k) => k !== key)
        : [...active.order, key];
      apply({ order, widths: active.widths });
    },
    [active, role, apply],
  );

  const setOrder = useCallback(
    (keys: ColumnKey[]) => {
      const current = new Set(active.order);
      const reordered = keys.filter((key) => current.has(key));
      if (reordered.length === active.order.length) {
        apply({ order: reordered, widths: active.widths });
      }
    },
    [active, apply],
  );

  const setWidth = useCallback(
    (key: ColumnKey, width: number) => {
      if (!COLUMNS[key]) {
        return;
      }
      apply({ order: active.order, widths: { ...active.widths, [key]: clampWidth(width) } });
    },
    [active, apply],
  );

  const reset = useCallback(() => apply(defaultLens()), [apply]);

  const available = useMemo(() => selectableColumns(role), [role]);

  return {
    visible: active.order,
    available,
    getWidth,
    isVisible,
    toggle,
    setOrder,
    setWidth,
    reset,
  };
}
