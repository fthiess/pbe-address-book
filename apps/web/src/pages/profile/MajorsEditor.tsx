import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MAJORS, compareCourseCodes, courseName } from "@pbe/shared";
import { type CSSProperties, type KeyboardEvent, useId } from "react";
import { Combobox } from "../../components/Combobox.js";
import { cn } from "../../lib/utils.js";
import { type ChipFamily, courseFamily, familyStyle } from "../directory/Chips.js";
import { FIELD_LABEL_CLASS } from "./fields.js";

/**
 * The **majors chip editor** (§5.7.4, D46; COMPONENTS.md "Chip editor"). Majors
 * are reorderable colored chips: drag to reorder (pointer), or move by keyboard
 * with the grip's ←/→ (and Home = make first) — the order matters because **the
 * major listed first is what appears in the directory** (the copy deliberately
 * never says "primary"). New majors come from an "Add major…" {@link Combobox}
 * over the bundled vocabulary, retired codes de-emphasized and already-chosen
 * codes excluded, with no duplicates by construction.
 */

export function MajorsEditor({
  codes,
  onChange,
  error,
}: {
  codes: string[];
  onChange: (codes: string[]) => void;
  error?: string;
}) {
  const helpId = useId();
  const errorId = useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function move(from: number, to: number) {
    if (to < 0 || to >= codes.length || to === from) {
      return;
    }
    onChange(arrayMove(codes, from, to));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      move(codes.indexOf(String(active.id)), codes.indexOf(String(over.id)));
    }
  }

  const remaining = MAJORS.filter((major) => !codes.includes(major.code)).sort((a, b) =>
    compareCourseCodes(a.code, b.code),
  );
  const options = remaining.map((major) => ({
    value: major.code,
    label: major.code,
    hint: major.displayName,
    muted: !major.active,
    ariaLabel: major.active
      ? `Course ${major.code}, ${major.displayName}`
      : `Course ${major.code}, ${major.displayName} (retired)`,
  }));

  return (
    <div>
      <p id={helpId} className={cn("mb-1 block", FIELD_LABEL_CLASS)}>
        Courses
      </p>
      <div
        className={cn(
          "flex min-h-12 flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-input bg-background p-2",
          error && "border-destructive",
        )}
      >
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <SortableContext items={codes} strategy={rectSortingStrategy}>
            <ul className="contents">
              {codes.map((code, index) => (
                <MajorChip
                  key={code}
                  code={code}
                  index={index}
                  total={codes.length}
                  onMove={move}
                  onRemove={() => onChange(codes.filter((c) => c !== code))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <div className="min-w-[160px] flex-1">
          <Combobox
            options={options}
            onSelect={(code) => onChange([...codes, code])}
            inputLabel="Add a course"
            placeholder="Add a course…"
            emptyMessage="No more courses to add."
            describedBy={error ? errorId : helpId}
            adornment={<PlusIcon />}
          />
        </div>
      </div>
      {error ? (
        <p id={errorId} className="mt-1 text-[length:var(--text-body-sm)] text-destructive">
          {error}
        </p>
      ) : (
        <p className="mt-1 text-[length:var(--text-body-sm)] text-muted-foreground">
          Drag to reorder; the course listed first appears in the directory.
        </p>
      )}
    </div>
  );
}

function MajorChip({
  code,
  index,
  total,
  onMove,
  onRemove,
}: {
  code: string;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: code });
  const family: ChipFamily = courseFamily(code);
  const name = courseName(code);

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    ...familyStyle(family),
  };

  function onGripKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        onMove(index, index - 1);
        break;
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        onMove(index, index + 1);
        break;
      case "Home":
        event.preventDefault();
        onMove(index, 0);
        break;
      case "End":
        event.preventDefault();
        onMove(index, total - 1);
        break;
    }
  }

  // The discarded dnd-kit keyboard attributes (it ships space-to-lift instructions
  // that don't match our ←/→ move model — we use only the pointer sensor), so the
  // grip carries its own button role and an instruction-bearing accessible name.
  const { role: _role, tabIndex: _tabIndex, ...dragAttributes } = attributes;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-semibold tabular-nums"
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...dragAttributes}
        {...listeners}
        onKeyDown={onGripKeyDown}
        aria-label={`Reorder ${name ? `Course ${code}, ${name}` : `Course ${code}`}, position ${index + 1} of ${total}. Use the arrow keys to move it; Home makes it first.`}
        className="flex size-5 cursor-grab touch-none items-center justify-center rounded text-current opacity-60 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <span aria-hidden="true">{code}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name ? `Course ${code}, ${name}` : `Course ${code}`}`}
        className="flex size-5 items-center justify-center rounded-full text-current opacity-70 outline-none hover:bg-black/5 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true">×</span>
      </button>
    </li>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <line x1="7" y1="2.5" x2="7" y2="11.5" />
      <line x1="2.5" y1="7" x2="11.5" y2="7" />
    </svg>
  );
}
