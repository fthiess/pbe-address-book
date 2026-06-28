import { getHelpEntry } from "@pbe/help-content";
import type { NameRecord } from "@pbe/name-search";
import { resolveCanonicalNames } from "@pbe/shared";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
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
  makeComparator,
  pinnedColumnsForRole,
} from "./directory/grid-model.js";
import { filterRows } from "./directory/query.js";
import { useNameSearch } from "./directory/search/useNameSearch.js";
import { useColumnLens } from "./directory/useColumnLens.js";
import { useDirectoryFilters } from "./directory/useDirectoryFilters.js";
import { useDirectorySort } from "./directory/useDirectorySort.js";
import { useSelection } from "./directory/useSelection.js";
import { useStars } from "./directory/useStars.js";

const NO_STARS: readonly number[] = [];

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
  const myStars = state.status === "authenticated" ? state.me.stars : NO_STARS;
  const location = useLocation();

  const [profiles, setProfiles] = useState<DirectoryProfile[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useQueryState("q", { defaultValue: "" });
  const [includeDeceased, setIncludeDeceased] = useQueryState(
    "deceased",
    parseAsBoolean.withDefault(false),
  );

  const lens = useColumnLens(role);
  const sort = useDirectorySort();
  const filters = useDirectoryFilters(role);
  const stars = useStars(myStars);
  const [starredOnly, setStarredOnly] = useHistoryFlag("directoryStarredOnly");
  const wide = useMediaQuery("(min-width: 768px)");

  // Selection clears whenever the search/filter view changes (§5.6.8) — keyed on
  // the dimensions that change the row *set* (not sort or the column lens).
  const selectionKey = useMemo(
    () => JSON.stringify([q, filters.filters, includeDeceased, starredOnly]),
    [q, filters.filters, includeDeceased, starredOnly],
  );
  const selection = useSelection(selectionKey);

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

  const { matchedIds, highlight, ready: searchReady } = useNameSearch(nameRecords, q);

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
    return matched.sort(makeComparator(sort.sortKey, sort.direction));
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

          <ColumnPicker lens={lens} />
        </div>
      </div>

      <FilterPanel
        filters={filters.filters}
        setFilter={filters.setFilter}
        options={filterOptions}
        role={role}
        activeCount={filters.activeCount}
        onReset={onReset}
      />

      {staff && <ActionBar role={role} rows={rows} selectedIds={selection.selected} />}

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
          viewKey={location.search}
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
          viewKey={location.search}
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
