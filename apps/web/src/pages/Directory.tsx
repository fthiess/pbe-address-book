import { getHelpEntry } from "@pbe/help-content";
import type { NameRecord } from "@pbe/name-search";
import {
  DEFAULT_RADIUS_MILES,
  type RadiusMiles,
  isRadiusMiles,
  resolveCanonicalNames,
} from "@pbe/shared";
import { ChevronRight } from "lucide-react";
import { parseAsBoolean, parseAsInteger, useQueryState } from "nuqs";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";
import { ClearButton } from "../components/ClearButton.js";
import { ControlHelp } from "../components/ControlHelp.js";
import {
  LoadingOverlay,
  OVERLAY_DELAY_MS,
  REASSURANCE_DELAY_MS,
  STILL_LOADING_REASSURANCE,
} from "../components/LoadingOverlay.js";
import { trackMobileOptionsOpened } from "../lib/analytics.js";
import type { DirectoryProfile } from "../lib/types.js";
import { useFilterTracking, useSearchTracking } from "../lib/useAnalytics.js";
import { useDelayedFlag } from "../lib/useDelayedFlag.js";
import { useHistoryFlag } from "../lib/useHistoryFlag.js";
import { useMediaQuery } from "../lib/useMediaQuery.js";
import { revalidateRoster, useRoster } from "../lib/useRoster.js";
import { ActionBar } from "./directory/ActionBar.js";
import { ColumnPicker } from "./directory/ColumnPicker.js";
import { DirectoryCards } from "./directory/DirectoryCards.js";
import { DirectoryGrid } from "./directory/DirectoryGrid.js";
import { FilterPanel } from "./directory/FilterPanel.js";
import { useSelection } from "./directory/SelectionContext.js";
import { SortControl } from "./directory/SortControl.js";
import { useStars } from "./directory/StarsContext.js";
import {
  autoFitChipStripWidth,
  autoFitWidth,
  gridCellFont,
  makeTextMeasurer,
} from "./directory/autofit.js";
import { collectFilterOptions } from "./directory/filters.js";
import {
  COLUMNS,
  type ColumnKey,
  HIGHLIGHTED_COLUMN_KEYS,
  PINNED_COLUMNS,
  sortRows,
} from "./directory/grid-model.js";
import { filterRows } from "./directory/query.js";
import { useNameSearch } from "./directory/search/useNameSearch.js";
import { useColumnLens } from "./directory/useColumnLens.js";
import { useDirectoryFilters } from "./directory/useDirectoryFilters.js";
import { useDirectorySort } from "./directory/useDirectorySort.js";
import { useNearFilter } from "./directory/useNearFilter.js";
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

  // The one shared roster store (Phase 7.5a, ENGINEERING-DESIGN §1.7): the
  // Directory renders from the same module-level store the Profile page derives
  // relationships from, so the two can never drift and a return trip re-renders
  // instantly from the retained data instead of re-downloading ~1 MB.
  const { profiles, error } = useRoster();
  const [q, setQ] = useQueryState("q", { defaultValue: "" });
  const [includeDeceased, setIncludeDeceased] = useQueryState(
    "deceased",
    parseAsBoolean.withDefault(false),
  );
  // The proximity radius (OFC-378). It lives here rather than in `DirectoryFilters`
  // — alongside "Include deceased", which is the same kind of thing — because it
  // narrows nothing by itself: it is a parameter of the Near filter, so counting it
  // in the panel badge or reporting it as a Mixpanel filter dimension would both
  // be wrong. See the `near` field's note in `filters.ts`.
  const [rawRadius, setRawRadius] = useQueryState(
    "radius",
    parseAsInteger.withDefault(DEFAULT_RADIUS_MILES),
  );
  // A hand-edited `?radius=37` must not reach the haversine: validate against the
  // offered set and fall back rather than honouring an arbitrary number, so the
  // control and the filter can never disagree about what is applied.
  const radiusMiles: RadiusMiles = isRadiusMiles(rawRadius) ? rawRadius : DEFAULT_RADIUS_MILES;

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

  // Proximity (OFC-378, D172): the `near` token, the lazily-fetched tables, and
  // the filter they resolve to. All of it — including the three load triggers and
  // the "why isn't this applied" copy — lives in the hook.
  const near = useNearFilter(filters.filters.near, radiusMiles, profiles, nameOf);
  const predicate = useMemo(
    () => filters.buildPredicate(near.proximity),
    [filters.buildPredicate, near.proximity],
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
        nickname: p.nickname,
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

  // Revalidate on every Directory mount — the freshness cadence the old
  // unconditional remount refetch gave, now as a background swap over the shared
  // store (and, from Phase 7.5b, usually a `304` instead of a full transfer).
  useEffect(() => {
    revalidateRoster();
  }, []);

  // The render columns: the pinned block (Select, Star, Thumbnail, Name), then
  // the lens's data columns in the user's order.
  const dataColumns = useMemo(() => lens.visible.map((key) => COLUMNS[key]), [lens.visible]);
  const columns = useMemo(() => [...PINNED_COLUMNS, ...dataColumns], [dataColumns]);

  // The multi-select vocabularies for the filter panel, drawn from the data.
  const filterOptions = useMemo(() => collectFilterOptions(profiles ?? []), [profiles]);

  // The unified query: search ∩ filters ∩ starred-only ∩ deceased default (D36/
  // D38/D39), then sorted by the active column with the canonical secondary key.
  const rows = useMemo(() => {
    const matched = filterRows(profiles ?? [], {
      matchedIds,
      predicate,
      includeDeceased,
      // Asking for deceased brothers by name carries its own inclusion (D171) —
      // otherwise this filter would return an empty grid in its default state. See
      // `DirectoryQuery.deceasedRequested`.
      deceasedRequested: filters.filters.deceasedOnly === "yes",
      starredOnly,
      stars: stars.set,
    });
    return sortRows(matched, sort.sortKey, sort.direction);
  }, [
    profiles,
    matchedIds,
    predicate,
    filters.filters.deceasedOnly,
    includeDeceased,
    starredOnly,
    stars.set,
    sort.sortKey,
    sort.direction,
  ]);

  // Report the settled search to analytics — a bucketed count only, never the
  // query text or the matched ids (P6; see lib/analytics.ts).
  //
  // `matchedIds` (the name-search match set), NOT `rows` (search ∩ filters ∩
  // starred ∩ deceased default): the event answers "did search find anyone?", and
  // a filter hiding the matches is a different question. Gated on `profiles` being
  // loaded, so a `?q=…` deep link doesn't report a match against an empty index.
  useSearchTracking(q, matchedIds?.size ?? 0, searchSettled, profiles !== null);
  // Report each filter dimension the moment it's engaged — dimension names only,
  // never the selected values (P6; 7a-4). See useFilterTracking.
  useFilterTracking(filters.filters);

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
      // Measured at the font the column's cells actually render in — which for the
      // Name column is a heavier weight than the rest of the grid (OFC-358).
      const measure = makeTextMeasurer(gridCellFont(key));
      // The Course column renders every course as a chip (OFC-269), so it fits to
      // the widest full chip strip, not the primary-only display string (OFC-277);
      // every other column fits its plain-text display value — plus, for the
      // searched name columns, the padding of any highlight marks drawn in it.
      const highlighted = HIGHLIGHTED_COLUMN_KEYS.has(key);
      const width =
        key === "major"
          ? autoFitChipStripWidth(
              column.label,
              rows.map((p) => p.majors ?? []),
              measure,
            )
          : autoFitWidth(
              column.label,
              rows.map((p) => {
                const text = column.display(p, nameOf(p));
                return highlighted ? { text, marks: highlight(text, p.id).length } : { text };
              }),
              measure,
            );
      lens.setWidth(key, width);
    },
    [rows, nameOf, highlight, lens],
  );

  // Reset clears Name Search, all filters, and the sort — but not the column lens (D38).
  // Reset clears every dimension that narrows *which brothers are listed*, wherever
  // it is held — the URL, History state, or a checkbox (N169, Forrest's call after
  // live-testing N166). ⚠ "Starred only" was originally left out because it is a
  // view toggle rather than a structured filter. That distinction is real but not
  // one a user has any reason to draw: it sits in the same control group as
  // "Include deceased", which Reset does clear, so leaving exactly one of an
  // adjacent pair standing read as a bug rather than as a principle.
  // ⚠ The radius is cleared here explicitly: `filters.reset()` clears the `near`
  // token, but the radius is a separate query key this component owns, so without
  // this line a Reset would leave `?radius=100` standing to be silently inherited
  // by the next place the brother picks.
  const onReset = useCallback(() => {
    void setQ("");
    void setIncludeDeceased(false);
    setStarredOnly(false);
    void setRawRadius(null);
    filters.reset();
    sort.reset();
  }, [setQ, setIncludeDeceased, setStarredOnly, setRawRadius, filters, sort]);

  // Whether Reset would change anything — one term per thing `onReset` clears, so
  // the two stay honest together (OFC-394). ⚠ The column lens stays absent: Reset
  // does not touch it and the label does not claim to. ⚠ This is deliberately NOT
  // the masthead clean-slate's list either — that also drops the row selection,
  // which persists across views by design and has its own explicit Clear in the
  // action bar (N79), so it is not something Reset should silently discard.
  const canReset =
    filters.activeCount > 0 ||
    q.trim() !== "" ||
    includeDeceased ||
    starredOnly ||
    !sort.isDefault ||
    // One term per thing `onReset` clears — including the radius, which Reset does
    // touch. A non-default radius with no origin narrows nothing, so this enables
    // Reset for a view that looks pristine; that is the honest reading, because
    // Reset would in fact change the URL.
    //
    // ⚠ Reads `rawRadius`, **not** the validated `radiusMiles`. Validation folds a
    // hand-typed `?radius=37` down to the default, so testing the validated value
    // would have left Reset disabled on a URL that Reset does in fact change —
    // the exact dishonesty OFC-394 removed from this button once already. Found in
    // the OFC-378 review round. (A non-*numeric* `?radius=abc` still parses to the
    // default and so still slips through; that is one edge past what the URL can
    // tell us without giving up `clearOnDefault`, and it is knowingly left.)
    rawRadius !== DEFAULT_RADIUS_MILES;

  const loading = profiles === null && !error;
  const showOverlay = useDelayedFlag(loading, OVERLAY_DELAY_MS);
  // The neutral line, not the wake-the-server one: the session fetch has already
  // succeeded by the time this runs, so the instance is warm — and the bulk roster
  // is ~1 MB, so a long wait here may simply be the transfer (OFC-324).
  const showReassurance = useDelayedFlag(loading, REASSURANCE_DELAY_MS);
  const help = getHelpEntry("directory.search");

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
  // Two vocabularies for one control: a phone shows cards, so what the desktop
  // calls Columns are Fields there (OFC-364). The picker itself is identical.
  const columnPicker = <ColumnPicker lens={lens} wording={wide ? "columns" : "fields"} />;
  const filterPanel = (
    <FilterPanel
      filters={filters.filters}
      setFilter={filters.setFilter}
      options={filterOptions}
      role={role}
      activeCount={filters.activeCount}
      onReset={onReset}
      canReset={canReset}
      nearContext={near.context}
      geoStatus={near.status}
      nearOrigin={near.origin}
      nearResolved={near.proximity !== undefined}
      radiusMiles={radiusMiles}
      onRadiusChange={(miles) => void setRawRadius(miles)}
      onNearEngaged={near.engage}
    />
  );
  // Rendered for every role since OFC-411 (it was staff-only, alongside the Select
  // column). The bar decides internally which of its actions this role has — a
  // brother sees Copy Emails and, with a selection, Clear.
  const actionBar = (
    <ActionBar
      role={role}
      viewRows={rows}
      visibleColumns={lens.visible}
      nameOf={nameOf}
      selectedRows={selectedRows}
      selectedCount={selection.count}
      onClear={clearSelection}
    />
  );

  if (error) {
    return (
      <p className="max-w-2xl rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        We couldn't load the directory just now. Please refresh to try again.
      </p>
    );
  }

  return (
    <section aria-labelledby="directory-heading" data-search-ready={searchReady}>
      {showOverlay && (
        <LoadingOverlay reassurance={STILL_LOADING_REASSURANCE} showReassurance={showReassurance} />
      )}

      {/* Between `sm` and `lg` the break is pinned to the breakpoint rather than
          left to `flex-wrap` (OFC-375). While this row wrapped purely on content,
          whether the control group sat beside the heading or below it depended on
          the *rendered width of the count line* — which changes with the filter
          state ("1089 of 1207 brothers" vs "1207 brothers"). At tablet width the
          row sits a few px from that wrap point, so ticking a filter jumped the
          whole group 60px up onto the heading line. (The reported trigger was
          "Include deceased", but any filter that narrows the count does it —
          "Starred only" included.)

          Deliberately scoped to the tablet band. On a phone the group is just the
          search box (the toggles and picker live in the Options fold, OFC-211) and
          it already shares the heading line; stacking it there would cost the
          brother list a row of vertical space that OFC-211 went to some trouble to
          win back. At `lg` the longest count and the full group fit side by side
          with room to spare, so desktop keeps its compact two-column header. */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:flex-col sm:items-stretch lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 id="directory-heading" className="text-xl font-bold tracking-tight">
            Directory
          </h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {profiles ? countLabel(rows.length, profiles.length) : "Loading…"}
          </p>
          {/* Why the Directory may be showing more brothers than the URL asked
              for. The Near control carries this line too, but that one is inside a
              fold that starts collapsed on every mount — and a *shared proximity
              link* arrives with the fold closed, which is precisely the case where
              an unexplained full result set reads as the link being broken.

              ⚠ **Its own live region, and always mounted.** The first draft leaned
              on the count line above, reasoning that it is already polite and
              announces when the rows narrow. That is exactly backwards for the two
              states this line actually covers: when the tables fail or the place is
              unknown the Directory stays UNNARROWED by design (D178), so the count
              text never changes and its region never fires — and the panel's copy of
              this message is not mounted either, because `FilterPanel` renders its
              body only when open. A screen-reader user following a shared link to an
              unresolvable place would have been told nothing at all while a sighted
              one read the notice. Mounted unconditionally because a live region
              created *with* its content is not reliably announced; the default
              `aria-relevant` is "additions text", so the region emptying when the
              origin finally resolves announces nothing and cannot double up with the
              count. Found in the OFC-378 review round. */}
          <p aria-live="polite" className="text-sm text-muted-foreground empty:hidden">
            {near.notice ?? ""}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-72">
            <div className="mb-1 flex items-center gap-1.5">
              <label htmlFor="directory-search" className="block text-xs font-medium">
                {help?.label ?? "Name Search"}
              </label>
              <ControlHelp entryKey="directory.search" />
            </div>
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
              onClick={() => {
                const next = !optionsOpen;
                setOptionsOpen(next);
                if (next) {
                  trackMobileOptionsOpened();
                }
              }}
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
              {/* Sort is a phone-only control: on desktop the column headers are
                  the sort affordance, and below `md` there are no headers at all
                  (OFC-364). It sits directly under the Fields picker — the two
                  together are "what these cards show, and in what order". */}
              <SortControl sort={sort} lens={lens} role={role} />
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
          selection={selection}
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
          selection={selection}
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
    <ChevronRight
      size={14}
      strokeWidth={1.6}
      aria-hidden="true"
      className={open ? "rotate-90 transition-transform" : "transition-transform"}
    />
  );
}
