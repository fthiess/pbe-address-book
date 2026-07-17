import * as Popover from "@radix-ui/react-popover";
import { type KeyboardEvent, type ReactNode, useId, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils.js";

/**
 * The app's one accessible **combobox** (Phase 4b-1). A text input that filters a
 * list of options shown in a floating panel — Book's single landing for the
 * headless-library call (DECISIONS N36 / CODING-PROJECT-PLAN §4b-1): the floating
 * panel, its portal, collision handling, and outside-click dismissal are Radix
 * Popover; the *listbox keyboarding* (`role="listbox"`/`option`,
 * `aria-activedescendant`, ↑/↓/Home/End/Enter/Esc, type-to-filter) is composed
 * here, in one place, because Radix has no `aria-activedescendant` combobox
 * primitive. The majors "Add major…" picker and the Big-Brother typeahead both
 * consume it; the Radix dependency it lands is what the 4c crop modal (Dialog) and
 * the Phase 6 `?` toggle-tips (Popover) build on.
 *
 * Focus stays in the input the whole time (the activedescendant pattern), so
 * Radix's auto-focus is suppressed and interacting with the input never counts as
 * an outside dismissal. Selecting an option clears the query and closes the panel;
 * the caller decides what selection *does* (add a chip, set a pointer).
 */

export interface ComboboxOption {
  /** The stable value handed to {@link ComboboxProps.onSelect}. */
  value: string;
  /** The visible primary label. */
  label: string;
  /** Optional secondary text (e.g. a course name, a class year). */
  hint?: string;
  /** Render de-emphasized (e.g. a retired major) while staying selectable. */
  muted?: boolean;
  /** Accessible name override; defaults to `label` (plus `hint` when present). */
  ariaLabel?: string;
}

interface ComboboxProps {
  /** The full option set; filtered live by the typed query. */
  options: ComboboxOption[];
  /** Called with the chosen option's `value`. The query and panel reset after. */
  onSelect: (value: string) => void;
  placeholder?: string;
  /** Accessible name for the text input (there is no visible `<label>`). */
  inputLabel: string;
  /** Shown in the panel when nothing matches the query. */
  emptyMessage?: string;
  /** Match predicate; defaults to a case-insensitive substring over label + hint. */
  filter?: (option: ComboboxOption, query: string) => boolean;
  /**
   * Notified whenever the typed query changes (and reset to "" on select). Lets a
   * parent run a richer matcher (e.g. the Directory's fuzzy/phonetic Name Search)
   * and feed the result back through {@link ComboboxProps.filter}.
   */
  onQueryChange?: (query: string) => void;
  id?: string;
  /** Forwarded to `aria-describedby` (a helper/error association). */
  describedBy?: string;
  disabled?: boolean;
  /** A leading adornment inside the input frame (e.g. a search glyph). */
  adornment?: ReactNode;
  /**
   * Custom option-row content; defaults to the `label` with the `hint` right-
   * aligned. When provided, the row left-aligns and top-aligns its content (so a
   * wrapping renderer reads cleanly). The option's accessible name still comes
   * from `ariaLabel`/`label`, so a custom renderer is purely visual.
   */
  renderOption?: (option: ComboboxOption) => ReactNode;
}

function defaultFilter(option: ComboboxOption, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") {
    return true;
  }
  return (
    option.label.toLocaleLowerCase().includes(q) ||
    (option.hint?.toLocaleLowerCase().includes(q) ?? false)
  );
}

export function Combobox({
  options,
  onSelect,
  placeholder,
  inputLabel,
  emptyMessage = "No matches.",
  filter = defaultFilter,
  onQueryChange,
  id: providedId,
  describedBy,
  disabled = false,
  adornment,
  renderOption,
}: ComboboxProps) {
  const fallbackId = useId();
  const id = providedId ?? fallbackId;
  const listboxId = `${id}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(
    () => options.filter((option) => filter(option, query)),
    [options, query, filter],
  );

  // Keep the active option in range as the match set shrinks/grows under typing.
  const clampedActive = matches.length === 0 ? 0 : Math.min(activeIndex, matches.length - 1);
  const activeOptionId = open && matches.length > 0 ? `${id}-opt-${clampedActive}` : undefined;

  function show() {
    if (!disabled) {
      setOpen(true);
    }
  }

  function choose(index: number) {
    const option = matches[index];
    if (!option) {
      return;
    }
    onSelect(option.value);
    setQuery("");
    onQueryChange?.("");
    setActiveIndex(0);
    setOpen(false);
    // Stay on the field so several picks in a row need no re-focus.
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          show();
          return;
        }
        setActiveIndex((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length));
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          show();
          return;
        }
        setActiveIndex((i) =>
          matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length,
        );
        break;
      case "Home":
        if (open) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (open) {
          event.preventDefault();
          setActiveIndex(Math.max(0, matches.length - 1));
        }
        break;
      case "Enter":
        if (open && matches.length > 0) {
          event.preventDefault();
          choose(clampedActive);
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        break;
    }
  }

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative flex items-center">
          {adornment && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3 text-muted-foreground"
            >
              {adornment}
            </span>
          )}
          <input
            ref={inputRef}
            id={id}
            type="text"
            role="combobox"
            aria-expanded={open && !disabled}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            aria-label={inputLabel}
            aria-describedby={describedBy}
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              onQueryChange?.(event.target.value);
              setActiveIndex(0);
              show();
            }}
            onFocus={show}
            onClick={show}
            onKeyDown={onKeyDown}
            className={cn(
              "w-full rounded-[var(--radius-md)] border border-input bg-background py-2.5 text-[length:var(--text-body-lg)] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring",
              adornment ? "pl-9 pr-3" : "px-3",
              disabled && "bg-muted text-muted-foreground",
            )}
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          // Focus stays in the input: suppress Radix's open/close auto-focus, and
          // never treat interacting with our own input as an outside dismissal.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (
              inputRef.current &&
              event.target instanceof Node &&
              inputRef.current.contains(event.target)
            ) {
              event.preventDefault();
            }
          }}
          className="z-40 max-h-64 w-[var(--radix-popover-trigger-width)] overflow-y-auto overscroll-contain rounded-[var(--radius-lg)] border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-popover)]"
        >
          {/* The listbox uses <div>s, not <ul>/<li>: a list element may not carry
              the interactive `option` role (the canonical ARIA combobox pattern). */}
          <div id={listboxId} role="listbox" aria-label={inputLabel} className="m-0 p-0">
            {matches.length === 0 ? (
              // Plain status text, not an option — there is nothing to select.
              <div className="px-3 py-2 text-[length:var(--text-body-sm)] text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              matches.map((option, index) => (
                <div
                  key={option.value}
                  id={`${id}-opt-${index}`}
                  role="option"
                  // Not in the tab order — focus stays on the input (aria-activedescendant);
                  // tabIndex={-1} is the focusable marker the pattern uses.
                  tabIndex={-1}
                  aria-selected={index === clampedActive}
                  aria-label={option.ariaLabel}
                  // Pointer down (not click) so selection beats the input's blur.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(index);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-[var(--radius-md)] px-3 py-2 text-[length:var(--text-body)]",
                    renderOption ? "items-start" : "items-baseline justify-between",
                    index === clampedActive && "bg-accent text-accent-foreground",
                  )}
                >
                  {renderOption ? (
                    renderOption(option)
                  ) : (
                    <>
                      <span className={cn(option.muted && "text-muted-foreground")}>
                        {option.label}
                      </span>
                      {option.hint && (
                        <span className="shrink-0 text-[length:var(--text-body-sm)] text-muted-foreground">
                          {option.hint}
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
