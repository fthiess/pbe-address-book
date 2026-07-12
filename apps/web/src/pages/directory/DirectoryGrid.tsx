import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { HighlightRange } from "@pbe/name-search";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import type { DirectoryProfile } from "../../lib/types.js";
import { cn } from "../../lib/utils.js";
import type { DirectoryNavState } from "../profile/directory-nav.js";
import { entryNavState, newStashId, putDirectoryStash } from "../profile/directory-stash.js";
import { CourseChip, DebrotheredBadge, InMemoriamBadge, UnlistedBadge } from "./Chips.js";
import { SelectCheckbox, StarButton } from "./RowControls.js";
import type { Selection } from "./SelectionContext.js";
import type { ColumnKey, GridColumn } from "./grid-model.js";
import { HighlightedName } from "./search/HighlightedName.js";
import { Thumbnail } from "./thumbnail.js";
import type { DirectorySort } from "./useDirectorySort.js";
import { useIdlePrefetch } from "./useIdlePrefetch.js";
import { useScrollRestoration } from "./useScrollRestoration.js";
import type { Stars } from "./useStars.js";

/**
 * The virtualized Directory grid (PRD §5.6.1/§5.6.2/§5.6.9). A single continuous
 * virtualized list of the **entire** current result set (TanStack Virtual, D29) —
 * no pagination, because the whole dataset is already in memory (D4).
 *
 * It is a **real semantic `<table>`** in ordinary table layout: virtualization is
 * done with top/bottom spacer rows rather than `display` overrides, so the native
 * table semantics survive in the accessibility tree and the programmatic
 * `aria-rowcount`/`aria-rowindex` report true position within the full set even
 * though only the near-viewport rows are in the DOM (finding U6, §5.5). The two
 * identity columns (Thumbnail, Canonical Name) **freeze** as a contiguous block on
 * horizontal scroll (sticky-left); the header row stays **sticky** on vertical
 * scroll. Data-column headers are **drag-reorderable** via a keyboard-operable
 * grip handle (dnd-kit), separate from the header's sort button. Each row's
 * Canonical Name is a real profile anchor (§5.6.7); the scroll offset is saved and
 * restored on Back (D31).
 */

const ROW_HEIGHT = 56;

export interface DirectoryGridProps {
  rows: DirectoryProfile[];
  /** Ordered render columns: the pinned identity block followed by the lens. */
  columns: GridColumn[];
  nameOf: (profile: DirectoryProfile) => string;
  /** Character ranges to mark in a brother's name-column text for the active search (D35). */
  highlight: (display: string, profileId: number) => HighlightRange[];
  myId: number | null;
  sort: DirectorySort;
  /** Commit a new order of the (non-pinned) data columns after a drag. */
  onReorder: (dataKeys: ColumnKey[]) => void;
  /** The effective (possibly user-resized) width of a column. */
  widthOf: (key: ColumnKey) => number;
  /** Commit a column's new width after a resize (drag end or keyboard step). */
  onResize: (key: ColumnKey, width: number) => void;
  /** Auto-fit a column to its widest data value (the double-click / Enter gesture). */
  onAutoFit: (key: ColumnKey) => void;
  /** The viewer's personal stars — the universal Star column (D39). */
  stars: Stars;
  /** Row selection, present only when the Select column is shown (manager/admin, D41). */
  selection?: Selection;
  /** The active view identity (the history-entry `location.key`) — keys scroll restoration. */
  viewKey: string;
  /** Whether the row set is final (search settled) so scroll restoration may apply. */
  restoreReady: boolean;
}

export function DirectoryGrid({
  rows,
  columns,
  nameOf,
  highlight,
  myId,
  sort,
  onReorder,
  widthOf,
  onResize,
  onAutoFit,
  stars,
  selection,
  viewKey,
  restoreReady,
}: DirectoryGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fill the grid to the viewport bottom so its *horizontal* scrollbar — pinned to
  // the container's bottom edge — is always on-screen (OFC-205). A fixed
  // `100dvh − Nrem` cap can't: the chrome above the grid (masthead, system banner,
  // heading/search, the collapsible Filters panel, the action bar) varies in
  // height, so any constant either overruns the viewport (scrollbar below the
  // fold, unreachable) or wastes space. Instead measure the grid's live top and
  // set its max-height to the remaining space, re-measuring on window resize and —
  // via a ResizeObserver on <body> — whenever the chrome above changes height
  // (banner appears, Filters expands). Recomputing from the grid's *top* (which the
  // grid's own height never moves) keeps this idempotent, so no feedback loop.
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const BOTTOM_GAP = 24; // breathing room below the grid, matching the shell's rhythm
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const next = Math.max(240, Math.round(window.innerHeight - top - BOTTOM_GAP));
      setMaxHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, []);

  // The stash carried into a Profile page so it can step Prev/Next through the
  // current displayed set (search ∩ filter ∩ sort) and "← Directory" can pop back
  // (4d, N45). The handle (`stashId` in `linkState`) is computed at render, but
  // the id-list is written to the store ONLY when a row is actually navigated
  // from (`commitStash`, OFC-141 follow-up) — so searching/filtering/sorting
  // without opening a profile writes nothing. Shared by every row/link.
  // A fresh handle per distinct displayed set (mint the id alongside the id-list
  // so `rows` is a real dependency); the id-list is written to the store only on
  // an actual navigation (`commitStash`).
  const { orderedIds, stashId } = useMemo(
    () => ({ orderedIds: rows.map((r) => r.id), stashId: newStashId() }),
    [rows],
  );
  const linkState = useMemo(() => entryNavState(stashId), [stashId]);
  const commitStash = useCallback(
    () => putDirectoryStash(stashId, orderedIds),
    [stashId, orderedIds],
  );

  // Header select-all spans the whole filtered view (every row, not just the
  // virtualized window — §5.6.8). Its tri-state reflects the **visible** rows only:
  // selection now persists across views (N79), so it can hold off-view ids the
  // header must ignore. Toggling unions the visible rows in, or removes just those
  // rows out — never disturbing off-view picks (the disjoint-set workflow, OFC-196).
  const allSelected =
    selection !== undefined && rows.length > 0 && rows.every((r) => selection.isSelected(r.id));
  const someSelected =
    selection !== undefined && !allSelected && rows.some((r) => selection.isSelected(r.id));
  const toggleSelectAll = useCallback(() => {
    if (!selection) {
      return;
    }
    const viewIds = rows.map((r) => r.id);
    if (allSelected) {
      selection.removeAll(viewIds);
    } else {
      selection.addAll(viewIds);
    }
  }, [selection, allSelected, rows]);

  // A live width while a resize drag is in flight (committed to the lens on
  // drop), so the grid reflows under the cursor without persisting every pixel.
  const [drag, setDrag] = useState<{ key: ColumnKey; width: number } | null>(null);
  const effWidth = useCallback(
    (key: ColumnKey) => (drag?.key === key ? drag.width : widthOf(key)),
    [drag, widthOf],
  );

  const totalWidth = useMemo(
    () => columns.reduce((sum, c) => sum + effWidth(c.key), 0),
    [columns, effWidth],
  );
  // Cumulative left offset for each frozen column, so the pinned block stays a
  // contiguous, correctly-stacked strip during horizontal scroll.
  const pinnedLeft = useMemo(() => {
    const offsets = new Map<ColumnKey, number>();
    let acc = 0;
    for (const column of columns) {
      if (column.pinned) {
        offsets.set(column.key, acc);
        acc += effWidth(column.key);
      }
    }
    return offsets;
  }, [columns, effWidth]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  useScrollRestoration(scrollRef, viewKey, rows.length > 0 && restoreReady);
  useIdlePrefetch(rows);

  const dataKeys = useMemo(() => columns.filter((c) => !c.pinned).map((c) => c.key), [columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const from = dataKeys.indexOf(active.id as ColumnKey);
    const to = dataKeys.indexOf(over.id as ColumnKey);
    if (from === -1 || to === -1) {
      return;
    }
    const next = [...dataKeys];
    const [moved] = next.splice(from, 1);
    if (!moved) {
      return;
    }
    next.splice(to, 0, moved);
    onReorder(next);
  };

  // Spacer-row virtualization: a leading and trailing empty row reserve the
  // off-screen scroll height while only the windowed rows render (native table
  // layout, so semantics are preserved — see the header comment).
  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0;

  return (
    <div
      ref={scrollRef}
      data-testid="directory-scroll"
      // `always-scrollbars` forces classic, always-visible scrollbars so the
      // horizontal scrollbar stays discoverable when the columns overflow —
      // overlay scrollbars auto-hide and hid it entirely (OFC-205, see index.css).
      className="always-scrollbars overflow-auto rounded-xl border border-border bg-card"
      // Measured to fill the viewport (OFC-205); the calc is only the first-paint
      // fallback before the layout effect runs.
      style={{ maxHeight: maxHeight === null ? "calc(100dvh - 13rem)" : `${maxHeight}px` }}
    >
      {/* autoScroll disabled: a column drag must never scroll the grid (the
          header is always in view; reordering off-screen columns isn't needed). */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        autoScroll={false}
      >
        <table
          aria-label="Brothers directory"
          aria-rowcount={rows.length + 1}
          aria-colcount={columns.length}
          className="border-separate border-spacing-0 text-sm"
          style={{ tableLayout: "fixed", width: totalWidth }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={{ width: effWidth(column.key) }} />
            ))}
          </colgroup>
          <thead>
            <tr aria-rowindex={1}>
              <SortableContext items={dataKeys} strategy={horizontalListSortingStrategy}>
                {columns.map((column, index) => (
                  <HeaderCell
                    key={column.key}
                    column={column}
                    colIndex={index + 1}
                    sort={sort}
                    left={pinnedLeft.get(column.key)}
                    width={effWidth(column.key)}
                    onPreview={(width) => setDrag({ key: column.key, width })}
                    onResize={(width) => {
                      setDrag(null);
                      onResize(column.key, width);
                    }}
                    onAutoFit={() => onAutoFit(column.key)}
                    selectAll={
                      column.key === "select"
                        ? { all: allSelected, some: someSelected, onToggle: toggleSelectAll }
                        : undefined
                    }
                  />
                ))}
              </SortableContext>
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              // biome-ignore lint/a11y/noAriaHiddenOnFocusable: layout-only spacer row, not focusable; hidden so the aria-rowindex positions stay true
              <tr aria-hidden="true">
                <td colSpan={columns.length} style={{ height: paddingTop }} />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const profile = rows[virtualRow.index];
              if (!profile) {
                return null;
              }
              return (
                <Row
                  key={profile.id}
                  profile={profile}
                  name={nameOf(profile)}
                  highlight={highlight}
                  isSelf={profile.id === myId}
                  rowIndex={virtualRow.index + 2}
                  striped={virtualRow.index % 2 === 1}
                  columns={columns}
                  pinnedLeft={pinnedLeft}
                  stars={stars}
                  selection={selection}
                  linkState={linkState}
                  commitStash={commitStash}
                />
              );
            })}
            {paddingBottom > 0 && (
              // biome-ignore lint/a11y/noAriaHiddenOnFocusable: layout-only spacer row, not focusable; hidden so the aria-rowindex positions stay true
              <tr aria-hidden="true">
                <td colSpan={columns.length} style={{ height: paddingBottom }} />
              </tr>
            )}
          </tbody>
        </table>
      </DndContext>
    </div>
  );
}

/** Sticky-left styling for a frozen identity cell at a given offset (header z above body). */
function frozenStyle(left: number | undefined, header: boolean): CSSProperties {
  if (left === undefined) {
    return {};
  }
  return { position: "sticky", left, zIndex: header ? 21 : 10 };
}

function HeaderCell({
  column,
  colIndex,
  sort,
  left,
  width,
  onPreview,
  onResize,
  onAutoFit,
  selectAll,
}: {
  column: GridColumn;
  colIndex: number;
  sort: DirectorySort;
  left: number | undefined;
  width: number;
  onPreview: (width: number) => void;
  onResize: (width: number) => void;
  onAutoFit: () => void;
  /** Present only on the Select header — drives the select-all checkbox. */
  selectAll?: { all: boolean; some: boolean; onToggle: () => void };
}) {
  const isActive = sort.sortKey === column.key;
  const ariaSort = !column.sortable
    ? undefined
    : isActive
      ? sort.direction === "asc"
        ? "ascending"
        : "descending"
      : "none";

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.key,
    disabled: column.pinned,
  });

  // Pinned headers freeze (sticky-left); reorderable headers carry the drag
  // transform. Both stay sticky to the top of the scroll container.
  const style: CSSProperties = column.pinned
    ? {
        ...frozenStyle(left, true),
        position: "sticky",
        top: 0,
        zIndex: left === undefined ? 20 : 22,
      }
    : {
        position: "sticky",
        top: 0,
        zIndex: 20,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      };

  return (
    <th
      ref={column.pinned ? undefined : setNodeRef}
      scope="col"
      aria-colindex={colIndex}
      aria-sort={ariaSort}
      className={cn(
        "h-11 border-b border-border bg-secondary px-3 text-xs font-semibold text-secondary-foreground",
        column.align === "end" ? "text-right" : "text-left",
      )}
      style={style}
    >
      <span className={cn("flex items-center gap-1", column.align === "end" && "justify-end")}>
        {!column.pinned && (
          <button
            type="button"
            aria-label={`Reorder the ${column.label} column`}
            className={cn(
              // ≥24×24 target (WCAG 2.5.8, the audience skews 60+ — §5.5/D79).
              "-ml-1 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              isDragging && "cursor-grabbing",
            )}
            {...attributes}
            {...listeners}
          >
            <GripIcon />
          </button>
        )}
        {selectAll ? (
          // The Select header is a select-all checkbox over the whole filtered
          // view (§5.6.8); "some but not all" shows the indeterminate state.
          <input
            type="checkbox"
            checked={selectAll.all}
            ref={(el) => {
              if (el) {
                el.indeterminate = selectAll.some;
              }
            }}
            aria-label="Select all brothers in the current view"
            onChange={selectAll.onToggle}
            className="size-4 cursor-pointer rounded border-input accent-[var(--brand-gold)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : column.sortable ? (
          <button
            type="button"
            onClick={() => sort.toggleSort(column.key)}
            className="flex min-h-6 min-w-0 items-center gap-1 rounded px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate">{column.label}</span>
            <SortGlyph active={isActive} direction={sort.direction} />
          </button>
        ) : (
          // Non-sortable controls (Star, Thumbnail): label for assistive tech only.
          <span className="sr-only">{column.label}</span>
        )}
      </span>
      {/* The fixed control columns (Select, Star, Thumbnail) aren't resizable;
          every data column is, and double-click / Enter auto-fits it (N27). */}
      {column.resizable !== false && (
        <ResizeHandle
          label={column.label}
          width={width}
          onPreview={onPreview}
          onResize={onResize}
          onAutoFit={onAutoFit}
        />
      )}
    </th>
  );
}

/**
 * The column resize affordance — a thin separator at the cell's trailing edge.
 * It is keyboard-operable (the ARIA window-splitter pattern: focusable, arrow
 * keys nudge the width) so resizing never *requires* a drag, satisfying WCAG
 * 2.5.7 alongside the pointer drag (§5.5/D79). Pointer drags preview live and
 * commit on release.
 */
function ResizeHandle({
  label,
  width,
  onPreview,
  onResize,
  onAutoFit,
}: {
  label: string;
  width: number;
  onPreview: (width: number) => void;
  onResize: (width: number) => void;
  /** Snap to the widest data value — double-click (pointer) or Enter (keyboard), N27. */
  onAutoFit: () => void;
}) {
  const KEY_STEP = 16;

  const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation(); // never let a resize start a column drag or a sort
    const startX = event.clientX;
    const startWidth = width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let latest = startWidth;
    const move = (e: PointerEvent) => {
      latest = startWidth + (e.clientX - startX);
      onPreview(latest);
    };
    const up = () => {
      target.releasePointerCapture(event.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      onResize(latest);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onResize(width - KEY_STEP);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onResize(width + KEY_STEP);
    } else if (event.key === "Enter") {
      // The keyboard twin of double-click auto-fit (N27): double-click is
      // pointer-only, so Enter on the focused separator must do the same (D79).
      event.preventDefault();
      onAutoFit();
    }
  };

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${label} column. Press Enter to fit to content.`}
      aria-valuenow={Math.round(width)}
      aria-valuemin={64}
      aria-valuemax={640}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onAutoFit}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none outline-none after:absolute after:inset-y-1 after:right-[3px] after:w-px after:bg-border hover:after:bg-foreground/40 focus-visible:after:bg-ring focus-visible:after:w-0.5"
    />
  );
}

function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" fill="currentColor">
      <circle cx="2.5" cy="3" r="1.2" />
      <circle cx="7.5" cy="3" r="1.2" />
      <circle cx="2.5" cy="7" r="1.2" />
      <circle cx="7.5" cy="7" r="1.2" />
      <circle cx="2.5" cy="11" r="1.2" />
      <circle cx="7.5" cy="11" r="1.2" />
    </svg>
  );
}

/** The active-sort direction indicator — text is in aria-sort, so this is decorative. */
function SortGlyph({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  if (!active) {
    return (
      <span aria-hidden="true" className="text-muted-foreground/40">
        ↕
      </span>
    );
  }
  return <span aria-hidden="true">{direction === "asc" ? "▲" : "▼"}</span>;
}

interface RowProps {
  profile: DirectoryProfile;
  name: string;
  highlight: (display: string, profileId: number) => HighlightRange[];
  isSelf: boolean;
  rowIndex: number;
  striped: boolean;
  columns: GridColumn[];
  pinnedLeft: Map<ColumnKey, number>;
  stars: Stars;
  selection?: Selection;
  /** The prev/next stash handle carried into the Profile page (4d, N45). */
  linkState: DirectoryNavState;
  /** Write the id-list to the stash store — called only when this row is navigated from (OFC-141). */
  commitStash: () => void;
}

function Row({
  profile,
  name,
  highlight,
  isSelf,
  rowIndex,
  striped,
  columns,
  pinnedLeft,
  stars,
  selection,
  linkState,
  commitStash,
}: RowProps) {
  const navigate = useNavigate();

  // Whole-row click opens the profile (§5.6.7). The Canonical Name stays the
  // real anchor (keyboard, Enter, modified-click → new tab); this only adds the
  // pointer convenience for plain clicks on the rest of the row. The Star/Select
  // controls call stopPropagation, so their clicks never reach here; the name
  // anchor preventDefaults plain clicks, so this won't double-navigate. Modified
  // clicks fall through to the anchor's native new-tab behaviour.
  const onRowClick = (event: ReactMouseEvent<HTMLTableRowElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    commitStash();
    navigate(`/brother/${profile.id}`, { state: linkState });
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the row click is a pointer-only convenience; the keyboard path is the real Canonical Name anchor in this row (the row itself is not a focusable widget — avoiding a duplicate tab stop), so all functionality stays keyboard-reachable (§5.6.7).
    <tr
      aria-rowindex={rowIndex}
      onClick={onRowClick}
      className={cn(
        striped ? "[--row-bg:var(--color-muted)]" : "[--row-bg:var(--color-card)]",
        "cursor-pointer hover:[--row-bg:var(--color-accent)] focus-within:[--row-bg:var(--color-accent)]",
      )}
      style={{ height: ROW_HEIGHT }}
    >
      {columns.map((column, index) => (
        <Cell
          key={column.key}
          column={column}
          colIndex={index + 1}
          profile={profile}
          name={name}
          highlight={highlight}
          isSelf={isSelf}
          left={pinnedLeft.get(column.key)}
          stars={stars}
          selection={selection}
          linkState={linkState}
          commitStash={commitStash}
        />
      ))}
    </tr>
  );
}

function Cell({
  column,
  colIndex,
  profile,
  name,
  highlight,
  isSelf,
  left,
  stars,
  selection,
  linkState,
  commitStash,
}: {
  column: GridColumn;
  colIndex: number;
  profile: DirectoryProfile;
  name: string;
  highlight: (display: string, profileId: number) => HighlightRange[];
  isSelf: boolean;
  left: number | undefined;
  stars: Stars;
  selection?: Selection;
  linkState: DirectoryNavState;
  commitStash: () => void;
}) {
  const common = cn(
    "overflow-hidden whitespace-nowrap border-b border-border px-3 align-middle bg-[var(--row-bg)]",
    column.align === "end" ? "text-right tabular-nums" : "text-left",
  );

  // The control cells carry no padding, so the Star/Select control fills the cell
  // and there is no dead zone that would fall through to the row's open-profile click.
  const controlCell = cn("border-b border-border p-0 align-middle bg-[var(--row-bg)]");

  if (column.key === "select") {
    return (
      <td aria-colindex={colIndex} className={controlCell} style={frozenStyle(left, false)}>
        {selection && (
          <SelectCheckbox
            checked={selection.isSelected(profile.id)}
            label={`Select ${name}`}
            onToggle={() => selection.toggle(profile.id)}
            fill
          />
        )}
      </td>
    );
  }

  if (column.key === "star") {
    return (
      <td aria-colindex={colIndex} className={controlCell} style={frozenStyle(left, false)}>
        <StarButton
          starred={stars.isStarred(profile.id)}
          name={name}
          onToggle={() => stars.toggle(profile.id)}
          fill
        />
      </td>
    );
  }

  if (column.key === "thumbnail") {
    return (
      <td aria-colindex={colIndex} className={common} style={frozenStyle(left, false)}>
        <Thumbnail profile={profile} name={name} />
      </td>
    );
  }

  if (column.key === "name") {
    const deceased = profile.deceased?.isDeceased === true;
    const unlisted = profile.unlisted === true;
    const debrothered = profile.debrothered?.isDebrothered === true;
    return (
      <th
        scope="row"
        aria-colindex={colIndex}
        className={cn(common, "font-normal")}
        style={frozenStyle(left, false)}
      >
        {/* flex-wrap so the status badges sit inline when the column is wide and
            flow BENEATH the name when it narrows — both stay readable (§5.6.5,
            visual-design). The name truncates only when it alone exceeds the
            cell. */}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* The Canonical Name is the row-open affordance (§5.6.7): a real anchor
              for keyboard, Enter, and modifier/new-tab. Whole-row click and the
              interactive Star/Select cells land with their behaviour in 3c. */}
          <Link
            to={`/brother/${profile.id}`}
            state={linkState}
            onClick={(event) => {
              // Write the id-list only for a plain in-tab navigation (a modified
              // click opens a new tab, which doesn't carry `location.state`, so
              // there's nothing for a stash to feed — OFC-141 follow-up).
              if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                commitStash();
              }
            }}
            className={cn(
              "min-w-0 max-w-full truncate font-medium underline-offset-2 outline-none hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring",
              // De-brothered: struck through and muted (D115); managers/admins only.
              debrothered && "text-muted-foreground line-through decoration-1",
            )}
          >
            <HighlightedName text={name} ranges={highlight(name, profile.id)} />
          </Link>
          {isSelf && (
            <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">
              You
            </span>
          )}
          {deceased && <InMemoriamBadge />}
          {unlisted && <UnlistedBadge />}
          {debrothered && <DebrotheredBadge />}
        </span>
      </th>
    );
  }

  if (column.key === "major") {
    const code = profile.majors?.[0];
    return (
      <td aria-colindex={colIndex} className={common}>
        {code ? <CourseChip code={code} /> : <span className="text-muted-foreground">—</span>}
      </td>
    );
  }

  const value = column.display(profile, name);
  // The other searched name fields (Full Name, Mug Name) carry highlight marks
  // too, so a match on them is visible when their column is shown (D35).
  const searchable = column.key === "fullName" || column.key === "mugName";
  return (
    <td aria-colindex={colIndex} className={cn(common, "text-muted-foreground")}>
      <span className="block truncate">
        {searchable ? (
          <HighlightedName text={value} ranges={highlight(value, profile.id)} />
        ) : (
          value
        )}
      </span>
    </td>
  );
}
