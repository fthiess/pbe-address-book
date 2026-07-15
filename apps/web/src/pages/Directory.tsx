import { getHelpEntry } from "@pbe/help-content";
import type { NameRecord } from "@pbe/name-search";
import { resolveCanonicalNames } from "@pbe/shared";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";
import { ClearButton } from "../components/ClearButton.js";
import { LoadingOverlay } from "../components/LoadingOverlay.js";
import { fetchProfiles } from "../lib/api.js";
import type { DirectoryProfile } from "../lib/types.js";
import { useDelayedFlag } from "../lib/useDelayedFlag.js";
import { useHistoryFlag } from "../lib/useHistoryFlag.js";
import { useMediaQuery } from "../lib/useMediaQuery.js";
import { ActionBar } from "./directory/ActionBar.js";
import { ColumnPicker } from "./directory/ColumnPicker.js";
import { DirectoryCards } from "./directory/DirectoryCards.js";
import { DirectoryGrid } from "./directory/DirectoryGrid.js";
import { FilterPanel } from "./directory/FilterPanel.js";
import { useSelection } from "./directory/SelectionContext.js";
import { useStars } from "./directory/StarsContext.js";
import {
  autoFitWidth,
  extraWidthFor,
  gridCellFont,
  makeTextMeasurer,
} from "./directory/autofit.js";
import { collectFilterOptions } from "./directory/filters.js";
import {
  COLUMNS,
  type ColumnKey,
  canSelectRows,
  pinnedColumnsForRole,
  sortRows,
} from "./directory/grid-model.js";
import { filterRows } from "./directory/query.js";
import { useNameSearch } from "./directory/search/useNameSearch.js";
import { useColumnLens } from "./directory/useColumnLens.js";
import { useDirectoryFilters } from "./directory/useDirectoryFilters.js";
import { useDirectorySort } from "./directory/useDirectorySort.js";
import { clearDirectoryStashes } from "./profile/directory-stash.js";

/**
 * The Directory — Book's home page and primary workspace (PRD §5.6). Phase 3a
 * built the grid; 3b the Name Search. **Phase 3c** completes it: the typed filter
 * panel (D38), the universal Star column and "Starred only" toggle (D39), the
 * Include-deceased toggle (D36), the manager/admin action bar with client-side
 * CSV export (D41/D92), and double-click-to-auto-fit columns (N27).
 *
 * Every operation runs client-side over the in-memory, already-projected dataset
 * (D4/D5): the unified {@link filterRows} query engine narrows it (search ∩
 * filters ∩ starred ∩ deceased default), then the comparator sorts it.
 */
export function Directory() {
  const { state } = useSession();
  const role = state.status === "authenticated" ? state.me.role : "brother";
  const myId = state.status === "authenticated" ? state.me.profileId : null;
  const location = useLocation();

  const [profiles, setProfiles] = useState<DirectoryProfile[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useQueryState("q", { defaultValue: "" });
  const [includeDeceased, setIncludeDeceased] = useQueryState(
    "deceased",
    parseAsBoolean.withDefault(false),
  );

  // Once we're back on the Directory, any prev/next stash is for a profile we've
  // left; drop them all (the next click-through regenerates one). Keeps
  // sessionStorage from filling with abandoned, identical stashes (OFC-141
  // follow-up). A *layout* effect so the clear runs synchronously on the
  // Directory's mount — before paint and before a row can be clicked — so a fast
  // click-through can't be written and then immediately wiped. Mount-only: the
  // Directory route remounts on every return.
  useLayoutEffect(() => {
    clearDirectoryStashes();
  }, []);

  const lens = useColumnLens(role);
  const sort = useDirectorySort();
  const filters = useDirectoryFilters(role);
  const stars = useStars();
  const [starredOnly, setStarredOnly] = useHistoryFlag("directoryStarredOnly");
  const wide = useMediaQuery("(min-width: 768px)");
  // The mobile "Options" fold (OFC-211). Starts closed on every mount —
  // like the FilterPanel (deliberately not persisted), so a Back-navigation to the
  // Directory always returns a compact, folded view; the header badge still signals
  // when options are active while it's closed.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRegionId = useId();

  // Row selection persists across search/filter/sort/navigation (N79/OFC-196), so
  // it lives in a context above the route rather than local state — no view-key
  // clear. The masthead's clean-slate reset (below) is what empties it deliberately.
  const selection = useSelection();
  // A stable reference to the clear action (the context value's identity changes on
  // every selection mutation, so depending on the whole `selection` in effects would
  // re-run them needlessly).
  const clearSelection = selection.clear;

  // The masthead logo navigates to "/" with a one-shot `reset` intent (OFC-194):
  // "home, fresh" clears every transient view dimension. The bare "/" URL already
  // resets the URL-held state (search, filters, sort, deceased); here we also clear
  // the History-held "Starred only" flag and the persisted selection — the two
  // things a plain link to "/" would otherwise leave standing. The "← Directory"
  // back-navigation carries no such intent, so it still restores the working view.
  const navigate = useNavigate();
  // Guard on the history entry's `key`, not a once-per-mount flag: two masthead
  // clicks must each reset (the Directory doesn't remount when already on "/"),
  // while the redundant re-renders from clearing must not re-fire for one intent.
  const resetHandledKey = useRef<string | null>(null);
  useEffect(() => {
    const wantsReset = (location.state as { reset?: boolean } | null)?.reset === true;
    if (!wantsReset || resetHandledKey.current === location.key) {
      return;
    }
    resetHandledKey.current = location.key;
    setStarredOnly(false);
    clearSelection();
    // Consume the one-shot intent (replace the entry's state with null) so a later
    // Back never re-resets a view the user has since rebuilt.
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [
    location.key,
    location.state,
    location.pathname,
    location.search,
    navigate,
    setStarredOnly,
    clearSelection,
  ]);

  // Resolve every visible brother's Canonical Name in one O(n) ambiguity pass
  // when the dataset arrives; a name is then an O(1) lookup by Constitution ID.
  const names = useMemo(
    () =>
      resolveCanonicalNames(
        (profiles ?? []).map((p) => ({
          id: p.id,
          firstName: p.firstName ?? "",
          lastName: p.lastName ?? "",
          classYear: p.classYear ?? null,
        })),
      ),
    [profiles],
  );
  const nameOf = useCallback(
    (p: DirectoryProfile): string =>
      names.get(p.id) ?? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
    [names],
  );

  // The lean name-only records the Name-Search worker indexes (D35/D110).
  const nameRecords = useMemo<NameRecord[]>(
    () =>
      (profiles ?? []).map((p) => ({
        id: p.id,
        firstName: p.firstName,
        middleName: p.middleName,
        lastName: p.lastName,
        fullLegalName: p.fullLegalName,
        mugName: p.mugName,
        canonicalName: names.get(p.id),
      })),
    [profiles, names],
  );

  const {
    matchedIds,
    highlight,
    ready: searchReady,
    settled: searchSettled,
  } = useNameSearch(nameRecords, q);

  useEffect(() => {
    const controller = new AbortController();
    fetchProfiles(controller.signal)
      .then((response) => setProfiles(response.profiles))
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
        }
      });
    return () => controller.abort();
  }, []);

  // The render columns: the pinned block (Select for staff, Star, Thumbnail,
  // Name), then the lens's data columns in the user's order.
  const dataColumns = useMemo(() => lens.visible.map((key) => COLUMNS[key]), [lens.visible]);
  const columns = useMemo(
    () => [...pinnedColumnsForRole(role), ...dataColumns],
    [role, dataColumns],
  );

  // The multi-select vocabularies for the filter panel, drawn from the data.
  const filterOptions = useMemo(() => collectFilterOptions(profiles ?? []), [profiles]);

  // The unified query: search ∩ filters ∩ starred-only ∩ deceased default (D36/
  // D38/D39), then sorted by the active column with the canonical secondary key.
  const rows = useMemo(() => {
    const matched = filterRows(profiles ?? [], {
      matchedIds,
      predicate: filters.predicate,
      includeDeceased,
      starredOnly,
      stars: stars.set,
    });
    return sortRows(matched, sort.sortKey, sort.direction);
  }, [
    profiles,
    matchedIds,
    filters.predicate,
    includeDeceased,
    starredOnly,
    stars.set,
    sort.sortKey,
    sort.direction,
  ]);

  // The export scope for a non-empty selection: every selected brother across the
  // *whole* dataset — not just the current view — so a disjoint set built across
  // several filters exports in full (N79/OFC-196). Sorted by the active sort so the
  // CSV order matches what the user last saw.
  const selectedRows = useMemo(
    () =>
      selection.selected.size === 0
        ? []
        : sortRows(
            (profiles ?? []).filter((p) => selection.selected.has(p.id)),
            sort.sortKey,
            sort.direction,
          ),
    [profiles, selection.selected, sort.sortKey, sort.direction],
  );

  // Auto-fit a column to its widest data value, measured over the *whole* dataset
  // (cheap, off the DOM) and persisted in the lens (N27).
  const onAutoFit = useCallback(
    (key: ColumnKey) => {
      const column = COLUMNS[key];
      if (column.resizable === false) {
        return;
      }
      const measure = makeTextMeasurer(gridCellFont());
      const values = rows.map((p) => column.display(p, nameOf(p)));
      lens.setWidth(key, autoFitWidth(column.label, values, measure, extraWidthFor(key)));
    },
    [rows, nameOf, lens],
  );

  // Reset clears Name Search, all filters, and the sort — but not the column lens (D38).
  const onReset = useCallback(() => {
    void setQ("");
    void setIncludeDeceased(false);
    filters.reset();
    sort.reset();
  }, [setQ, setIncludeDeceased, filters, sort]);

  const loading = profiles === null && !error;
  const showOverlay = useDelayedFlag(loading, 500);
  const help = getHelpEntry("directory.search");
  const staff = canSelectRows(role);

  // The badge on the collapsed mobile "Options" fold: how many of the
  // folded controls are currently narrowing the view — typed filters plus the two
  // view toggles — so the brother knows something is applied without opening it.
  const activeOptionCount = filters.activeCount + (starredOnly ? 1 : 0) + (includeDeceased ? 1 : 0);

  // The chrome pieces below the search box are the same elements whether shown
  // inline (desktop) or inside the mobile fold (OFC-211) — build them once and
  // place them in the branch that renders this width.
  const quickToggles = (
    <div className="flex items-center gap-4 pb-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={starredOnly}
          onChange={(e) => setStarredOnly(e.target.checked)}
          className="size-4 rounded border-input accent-[var(--brand-gold)]"
        />
        Starred only
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeDeceased}
          onChange={(e) => void setIncludeDeceased(e.target.checked)}
          className="size-4 rounded border-input accent-[var(--brand-gold)]"
        />
        Include deceased
      </label>
    </div>
  );
  const columnPicker = <ColumnPicker lens={lens} />;
  const filterPanel = (
    <FilterPanel
      filters={filters.filters}
      setFilter={filters.setFilter}
      options={filterOptions}
      role={role}
      activeCount={filters.activeCount}
      onReset={onReset}
    />
  );
  const actionBar = staff ? (
    <ActionBar
      role={role}
      viewRows={rows}
      selectedRows={selectedRows}
      selectedCount={selection.count}
      onClear={clearSelection}
    />
  ) : null;

  if (error) {
    return (
      <p className="max-w-2xl rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        We couldn't load the directory just now. Please refresh to try again.
      </p>
    );
  }

  return (
    <section aria-labelledby="directory-heading" data-search-ready={searchReady}>
      {showOverlay && <LoadingOverlay />}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="directory-heading" className="text-xl font-bold tracking-tight">
            Directory
          </h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {profiles ? countLabel(rows.length, profiles.length) : "Loading…"}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-72">
            <label htmlFor="directory-search" className="mb-1 block text-xs font-medium">
              {help?.label ?? "Name Search"}
            </label>
            <div className="relative">
              <input
                id="directory-search"
                type="search"
                value={q}
                onChange={(event) => void setQ(event.target.value)}
                placeholder={help?.placeholder}
                aria-describedby="directory-search-help"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {q !== "" && (
                <span className="absolute inset-y-0 right-1 flex items-center">
                  <ClearButton label={help?.label ?? "Name Search"} onClick={() => void setQ("")} />
                </span>
              )}
            </div>
            <p id="directory-search-help" className="sr-only">
              {help?.helperText}
            </p>
          </div>

          {/* On desktop the quick toggles + Columns picker sit beside the search;
              on a phone they move into the "Options" fold below (OFC-211). */}
          {wide && (
            <>
              {quickToggles}
              {columnPicker}
            </>
          )}
        </div>
      </div>

      {/* Desktop shows the filter panel + action bar inline; a phone folds them
          (together with the quick toggles + Columns picker) into one disclosure,
          closed by default, so the brother list gets the vertical space (OFC-211).
          Built as a button + region (mirroring the FilterPanel disclosure, D38) for
          reliable keyboard + AT behaviour under the a11y gate (D79). */}
      {wide ? (
        <>
          {filterPanel}
          {actionBar}
        </>
      ) : (
        <div className="mb-4">
          <h2>
            <button
              type="button"
              aria-expanded={optionsOpen}
              aria-controls={optionsRegionId}
              onClick={() => setOptionsOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center gap-2">
                <FoldChevron open={optionsOpen} />
                Options
                {activeOptionCount > 0 && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                    {activeOptionCount} active
                  </span>
                )}
              </span>
            </button>
          </h2>
          {optionsOpen && (
            <div id={optionsRegionId} className="mt-3 flex flex-col gap-3">
              {quickToggles}
              {columnPicker}
              {filterPanel}
              {actionBar}
            </div>
          )}
        </div>
      )}

      {profiles && rows.length === 0 ? (
        <EmptyState q={q} starredOnly={starredOnly} hasStars={stars.set.size > 0} />
      ) : wide ? (
        <DirectoryGrid
          rows={rows}
          columns={columns}
          nameOf={nameOf}
          highlight={highlight}
          myId={myId}
          sort={sort}
          onReorder={lens.setOrder}
          widthOf={lens.getWidth}
          onResize={lens.setWidth}
          onAutoFit={onAutoFit}
          stars={stars}
          selection={staff ? selection : undefined}
          viewKey={location.key}
          restoreReady={searchSettled}
        />
      ) : (
        <DirectoryCards
          rows={rows}
          dataColumns={dataColumns}
          nameOf={nameOf}
          highlight={highlight}
          myId={myId}
          stars={stars}
          selection={staff ? selection : undefined}
          viewKey={location.key}
          restoreReady={searchSettled}
        />
      )}
    </section>
  );
}

/** The Directory's various empty states (§5.6.6/§5.6.9). */
function EmptyState({
  q,
  starredOnly,
  hasStars,
}: {
  q: string;
  starredOnly: boolean;
  hasStars: boolean;
}) {
  let message: string;
  if (starredOnly && !hasStars) {
    message = "You haven't starred anyone yet — click a star to add them.";
  } else if (starredOnly) {
    message = "None of your starred brothers match the current view.";
  } else if (q.trim() !== "") {
    message = `No brothers match “${q}”.`;
  } else {
    message = "No brothers match the current filters.";
  }
  return (
    <p className="max-w-2xl rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
      {message}
    </p>
  );
}

/** The result-count readout (§5.6.9): "248 brothers", narrowing to "of N" when filtered. */
function countLabel(shown: number, total: number): string {
  const word = total === 1 ? "brother" : "brothers";
  return shown === total ? `${total} ${word}` : `${shown} of ${total} ${word}`;
}

/** The disclosure chevron on the mobile "Options" fold (mirrors FilterPanel). */
function FoldChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={open ? "rotate-90 transition-transform" : "transition-transform"}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
