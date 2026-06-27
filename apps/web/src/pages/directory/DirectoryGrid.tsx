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
import { useVirtualizer } from "@tanstack/react-virtual";
import { type CSSProperties, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import type { DirectoryProfile } from "../../lib/types.js";
import { cn } from "../../lib/utils.js";
import type { ColumnKey, GridColumn } from "./grid-model.js";
import { Thumbnail } from "./thumbnail.js";
import type { DirectorySort } from "./useDirectorySort.js";
import { useIdlePrefetch } from "./useIdlePrefetch.js";
import { useScrollRestoration } from "./useScrollRestoration.js";

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
  myId: number | null;
  sort: DirectorySort;
  /** Commit a new order of the (non-pinned) data columns after a drag. */
  onReorder: (dataKeys: ColumnKey[]) => void;
  /** The active view identity (URL search string) — keys scroll restoration. */
  viewKey: string;
}

export function DirectoryGrid({
  rows,
  columns,
  nameOf,
  myId,
  sort,
  onReorder,
  viewKey,
}: DirectoryGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const totalWidth = useMemo(() => columns.reduce((sum, c) => sum + c.width, 0), [columns]);
  // Cumulative left offset for each frozen column, so the pinned block stays a
  // contiguous, correctly-stacked strip during horizontal scroll.
  const pinnedLeft = useMemo(() => {
    const offsets = new Map<ColumnKey, number>();
    let acc = 0;
    for (const column of columns) {
      if (column.pinned) {
        offsets.set(column.key, acc);
        acc += column.width;
      }
    }
    return offsets;
  }, [columns]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  useScrollRestoration(scrollRef, viewKey, rows.length > 0);
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
      className="overflow-auto rounded-xl border border-border bg-card"
      style={{ maxHeight: "calc(100dvh - 13rem)" }}
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <table
          aria-label="Brothers directory"
          aria-rowcount={rows.length + 1}
          aria-colcount={columns.length}
          className="border-separate border-spacing-0 text-sm"
          style={{ tableLayout: "fixed", width: totalWidth }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
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
                  isSelf={profile.id === myId}
                  rowIndex={virtualRow.index + 2}
                  striped={virtualRow.index % 2 === 1}
                  columns={columns}
                  pinnedLeft={pinnedLeft}
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
}: {
  column: GridColumn;
  colIndex: number;
  sort: DirectorySort;
  left: number | undefined;
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
        {column.sortable ? (
          <button
            type="button"
            onClick={() => sort.toggleSort(column.key)}
            className="flex min-h-6 min-w-0 items-center gap-1 rounded px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate">{column.label}</span>
            <SortGlyph active={isActive} direction={sort.direction} />
          </button>
        ) : (
          // Non-sortable (thumbnail): the label is for assistive tech only.
          <span className="sr-only">{column.label}</span>
        )}
      </span>
    </th>
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
  isSelf: boolean;
  rowIndex: number;
  striped: boolean;
  columns: GridColumn[];
  pinnedLeft: Map<ColumnKey, number>;
}

function Row({ profile, name, isSelf, rowIndex, striped, columns, pinnedLeft }: RowProps) {
  return (
    <tr
      aria-rowindex={rowIndex}
      className={cn(
        striped ? "[--row-bg:var(--color-muted)]" : "[--row-bg:var(--color-card)]",
        "hover:[--row-bg:var(--color-accent)] focus-within:[--row-bg:var(--color-accent)]",
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
          isSelf={isSelf}
          left={pinnedLeft.get(column.key)}
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
  isSelf,
  left,
}: {
  column: GridColumn;
  colIndex: number;
  profile: DirectoryProfile;
  name: string;
  isSelf: boolean;
  left: number | undefined;
}) {
  const common = cn(
    "overflow-hidden whitespace-nowrap border-b border-border px-3 align-middle bg-[var(--row-bg)]",
    column.align === "end" ? "text-right tabular-nums" : "text-left",
  );

  if (column.key === "thumbnail") {
    return (
      <td aria-colindex={colIndex} className={common} style={frozenStyle(left, false)}>
        <Thumbnail profile={profile} name={name} />
      </td>
    );
  }

  if (column.key === "name") {
    const deceased = profile.deceased?.isDeceased === true;
    return (
      <th
        scope="row"
        aria-colindex={colIndex}
        className={cn(common, "font-normal")}
        style={frozenStyle(left, false)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {/* The Canonical Name is the row-open affordance (§5.6.7): a real anchor
              for keyboard, Enter, and modifier/new-tab. Whole-row click and the
              interactive Star/Select cells land with their behaviour in 3c. */}
          <Link
            to={`/brother/${profile.id}`}
            className="truncate font-medium underline-offset-2 outline-none hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
          >
            {name}
          </Link>
          {isSelf && (
            <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">
              You
            </span>
          )}
          {deceased && (
            <span className="shrink-0 text-[length:var(--text-micro)] font-bold uppercase tracking-wide text-[var(--memorial-fg)]">
              In Memoriam
            </span>
          )}
        </span>
      </th>
    );
  }

  const value = column.display(profile, name);
  return (
    <td aria-colindex={colIndex} className={cn(common, "text-muted-foreground")}>
      <span className="block truncate">{value}</span>
    </td>
  );
}
