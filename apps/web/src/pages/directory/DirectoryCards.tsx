import type { HighlightRange } from "@pbe/name-search";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { Link } from "react-router-dom";
import type { DirectoryProfile } from "../../lib/types.js";
import { cn } from "../../lib/utils.js";
import { CourseChip, DebrotheredBadge, InMemoriamBadge, UnlistedBadge } from "./Chips.js";
import type { GridColumn } from "./grid-model.js";
import { HighlightedName } from "./search/HighlightedName.js";
import { Thumbnail } from "./thumbnail.js";
import { useIdlePrefetch } from "./useIdlePrefetch.js";
import { useScrollRestoration } from "./useScrollRestoration.js";

/**
 * The Directory's small-screen layout (§5.5/§5.6.9): below `md` the grid
 * collapses to **stacked, tappable cards**, following the same model — a single
 * **virtualized** vertical list of the entire result set, so it scales to the
 * full roster on a phone. Cards carry the same identity (thumbnail + Canonical
 * Name) and the lens's visible data fields as label/value pairs. Each card is a
 * real link to the profile (§5.6.7); scroll restoration and idle thumbnail
 * prefetch work exactly as on the grid.
 *
 * Card heights vary with content, so the virtualizer measures each rendered card
 * (`measureElement`). Assistive tech gets the true totals via `aria-setsize` /
 * `aria-posinset` on each list item (finding U6, §5.5).
 */

export interface DirectoryCardsProps {
  rows: DirectoryProfile[];
  /** The lens's visible data columns (the pinned identity block is implicit). */
  dataColumns: GridColumn[];
  nameOf: (profile: DirectoryProfile) => string;
  /** Character ranges to mark in a brother's display name for the active search (D35). */
  highlight: (display: string) => HighlightRange[];
  myId: number | null;
  viewKey: string;
}

export function DirectoryCards({
  rows,
  dataColumns,
  nameOf,
  highlight,
  myId,
  viewKey,
}: DirectoryCardsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 132,
    overscan: 6,
  });

  useScrollRestoration(scrollRef, viewKey, rows.length > 0);
  useIdlePrefetch(rows);

  return (
    <div
      ref={scrollRef}
      className="overflow-auto rounded-xl"
      style={{ maxHeight: "calc(100dvh - 13rem)" }}
    >
      <ul
        aria-label="Brothers directory"
        className="relative m-0 list-none p-0"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const profile = rows[virtualRow.index];
          if (!profile) {
            return null;
          }
          const name = nameOf(profile);
          const deceased = profile.deceased?.isDeceased === true;
          const unlisted = profile.unlisted === true;
          const debrothered = profile.debrothered?.isDebrothered === true;
          return (
            <li
              key={profile.id}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              aria-setsize={rows.length}
              aria-posinset={virtualRow.index + 1}
              className="absolute left-0 top-0 w-full px-0.5 pb-2"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <Link
                to={`/brother/${profile.id}`}
                className="block rounded-xl border border-border bg-card p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-3">
                  <Thumbnail profile={profile} name={name} />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "truncate font-semibold",
                          debrothered && "text-muted-foreground line-through decoration-1",
                        )}
                      >
                        <HighlightedName text={name} ranges={highlight(name)} />
                      </span>
                      {profile.id === myId && (
                        <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">
                          You
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {deceased && <InMemoriamBadge />}
                      {unlisted && <UnlistedBadge />}
                      {debrothered && <DebrotheredBadge />}
                    </span>
                  </span>
                </span>

                {dataColumns.length > 0 && (
                  <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-sm">
                    {dataColumns.map((column) => {
                      const value = column.display(profile, name);
                      if (value === "—") {
                        return null;
                      }
                      const code = column.key === "major" ? profile.majors?.[0] : undefined;
                      return (
                        <div key={column.key} className="contents">
                          <dt className="text-muted-foreground">{column.label}</dt>
                          <dd className="m-0 min-w-0 truncate">
                            {code ? <CourseChip code={code} /> : value}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
