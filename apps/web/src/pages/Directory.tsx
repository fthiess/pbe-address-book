import { getHelpEntry } from "@pbe/help-content";
import type { NameRecord } from "@pbe/name-search";
import { resolveCanonicalNames } from "@pbe/shared";
import { useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";
import { LoadingOverlay } from "../components/LoadingOverlay.js";
import { fetchProfiles } from "../lib/api.js";
import type { DirectoryProfile } from "../lib/types.js";
import { useDelayedFlag } from "../lib/useDelayedFlag.js";
import { useMediaQuery } from "../lib/useMediaQuery.js";
import { ColumnPicker } from "./directory/ColumnPicker.js";
import { DirectoryCards } from "./directory/DirectoryCards.js";
import { DirectoryGrid } from "./directory/DirectoryGrid.js";
import { COLUMNS, makeComparator } from "./directory/grid-model.js";
import { useNameSearch } from "./directory/search/useNameSearch.js";
import { useColumnLens } from "./directory/useColumnLens.js";
import { useDirectorySort } from "./directory/useDirectorySort.js";

/**
 * The Directory — Book's home page and primary workspace (PRD §5.6). Phase 3a
 * delivers the grid: the frozen identity columns, the role-aware reorderable
 * column lens, single-column sorting with the canonical secondary key, full
 * virtualization with scroll restoration, and the responsive card collapse.
 *
 * Session 3b delivers Name Search: typo-tolerant + phonetic + common-nickname
 * matching over the tokenized name fields, with the index built in a Web Worker
 * (D35/D110/D123) so the grid renders immediately on exact/substring matching and
 * the richer matching switches on when the worker signals ready. The structured
 * filter panel, the Star and Select columns, the Include-deceased toggle, and the
 * manager/administrator action bar with CSV export are Session 3c. The whole
 * dataset is held in memory and every operation runs client-side over it (D4).
 */
export function Directory() {
  const { state } = useSession();
  const role = state.status === "authenticated" ? state.me.role : "brother";
  const myId = state.status === "authenticated" ? state.me.profileId : null;
  const location = useLocation();

  const [profiles, setProfiles] = useState<DirectoryProfile[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useQueryState("q", { defaultValue: "" });

  const lens = useColumnLens(role);
  const sort = useDirectorySort();
  const wide = useMediaQuery("(min-width: 768px)");

  // Resolve every visible brother's Canonical Name in one O(n) ambiguity pass
  // when the dataset arrives; a name is then an O(1) lookup by Constitution ID.
  // The projection always carries the (public) name fields, but the wire type is
  // structurally `Partial<Profile>`, so they are defaulted into the required
  // CanonicalNameInput shape.
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

  // The lean name-only records the Name-Search worker indexes (D35/D110) — the
  // searched fields plus each brother's resolved Canonical Name. Rebuilt only
  // when the dataset changes, so the worker's index isn't churned on every keystroke.
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

  // Name Search, with the worker-reported highlight builder it returns — so a
  // result's matched words are marked across every name column (D35).
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

  // The render columns: the two frozen identity columns, then the lens's data
  // columns in the user's order.
  const dataColumns = useMemo(() => lens.visible.map((key) => COLUMNS[key]), [lens.visible]);
  const columns = useMemo(() => [COLUMNS.thumbnail, COLUMNS.name, ...dataColumns], [dataColumns]);

  // Name Search (D35) AND-ed with nothing else yet (filters arrive in 3c), then
  // sorted by the active column with the canonical secondary key. `matchedIds` is
  // null for an empty query (show all); otherwise it's the worker's (or, until
  // ready, the main thread's substring) match set. All client-side over the
  // in-memory set (D4).
  const rows = useMemo(() => {
    const all = profiles ?? [];
    const filtered = matchedIds === null ? all : all.filter((p) => matchedIds.has(p.id));
    return [...filtered].sort(makeComparator(sort.sortKey, sort.direction));
  }, [profiles, matchedIds, sort.sortKey, sort.direction]);

  const loading = profiles === null && !error;
  const showOverlay = useDelayedFlag(loading, 500);
  const help = getHelpEntry("directory.search");

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

        <div className="flex items-end gap-2">
          <div className="w-full sm:w-72">
            <label htmlFor="directory-search" className="mb-1 block text-xs font-medium">
              {help?.label ?? "Name Search"}
            </label>
            <input
              id="directory-search"
              type="search"
              value={q}
              onChange={(event) => void setQ(event.target.value)}
              placeholder={help?.placeholder}
              aria-describedby="directory-search-help"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p id="directory-search-help" className="sr-only">
              {help?.helperText}
            </p>
          </div>
          <ColumnPicker lens={lens} />
        </div>
      </div>

      {profiles && rows.length === 0 ? (
        <p className="max-w-2xl rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {q.trim() === "" ? "No brothers to show." : `No brothers match “${q}”.`}
        </p>
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
          viewKey={location.search}
        />
      ) : (
        <DirectoryCards
          rows={rows}
          dataColumns={dataColumns}
          nameOf={nameOf}
          highlight={highlight}
          myId={myId}
          viewKey={location.search}
        />
      )}
    </section>
  );
}

/** The result-count readout (§5.6.9): "248 brothers", narrowing to "of N" when filtered. */
function countLabel(shown: number, total: number): string {
  const word = total === 1 ? "brother" : "brothers";
  return shown === total ? `${total} ${word}` : `${shown} of ${total} ${word}`;
}
