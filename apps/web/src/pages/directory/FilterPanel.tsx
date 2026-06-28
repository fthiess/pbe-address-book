import type { Role } from "@pbe/shared";
import { useId, useState } from "react";
import {
  type BoolFilter,
  type DirectoryFilters,
  type FilterOption,
  type FilterOptions,
  type PresenceFilter,
  type VerificationFilter,
  canUseStaffFilters,
  parseNumericGrammar,
} from "./filters.js";

/**
 * The structured filter panel above the grid (§5.6.4, D38). A collapsible region
 * (column headers stay reserved for sorting) of typed controls — numeric-grammar
 * text, multi-selects drawn from the data, a substring box, and the staff-only
 * presence/consent/verification controls. "Filterable ⟺ visible": the staff
 * controls appear only for managers/admins, the same gate as their columns.
 *
 * Built from native form controls (selects, checkboxes, text/date inputs) — the
 * most robust path for the WCAG 2.2 AA gate and the 60+ audience (D79), with no
 * custom popover/listbox to keyboard-trap.
 */
export interface FilterPanelProps {
  filters: DirectoryFilters;
  setFilter: <K extends keyof DirectoryFilters>(
    key: K,
    value: DirectoryFilters[K],
    commit?: "push" | "replace",
  ) => void;
  options: FilterOptions;
  role: Role;
  activeCount: number;
  /** Clears Name Search, all filters, and the sort — but not the column lens (D38). */
  onReset: () => void;
}

export function FilterPanel({
  filters,
  setFilter,
  options,
  role,
  activeCount,
  onReset,
}: FilterPanelProps) {
  const [open, setOpen] = useState(activeCount > 0);
  const regionId = useId();
  const staff = canUseStaffFilters(role);

  return (
    <div className="mb-4 rounded-xl border border-border bg-card">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-2">
            <Chevron open={open} />
            Filters
            {activeCount > 0 && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                {activeCount} active
              </span>
            )}
          </span>
        </button>
      </h2>

      {open && (
        <div id={regionId} className="border-border border-t px-4 py-4">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumericFilter
              label="Class Year"
              placeholder="e.g. 1980, 1985-1989"
              value={filters.classYear}
              onChange={(v) => setFilter("classYear", v)}
            />
            <NumericFilter
              label="Constitution ID"
              placeholder="e.g. 5001, 5100-5200"
              value={filters.constitutionId}
              onChange={(v) => setFilter("constitutionId", v)}
            />
            <MultiSelectFilter
              label="Course"
              options={options.major}
              selected={filters.major}
              onChange={(v) => setFilter("major", v, "push")}
            />
            <MultiSelectFilter
              label="Country"
              options={options.country}
              selected={filters.country}
              onChange={(v) => setFilter("country", v, "push")}
            />
            <MultiSelectFilter
              label="State/Province"
              options={options.stateProvince}
              selected={filters.stateProvince}
              onChange={(v) => setFilter("stateProvince", v, "push")}
            />
            <TextFilter
              label="City"
              placeholder="contains…"
              value={filters.city}
              onChange={(v) => setFilter("city", v)}
            />

            {staff && (
              <>
                <PresenceSelect
                  label="Email"
                  value={filters.email}
                  onChange={(v) => setFilter("email", v, "push")}
                />
                <PresenceSelect
                  label="Telephone"
                  value={filters.phone}
                  onChange={(v) => setFilter("phone", v, "push")}
                />
                <BoolSelect
                  label="Newsletter"
                  value={filters.allowNewsletterEmail}
                  onChange={(v) => setFilter("allowNewsletterEmail", v, "push")}
                />
                <BoolSelect
                  label="Comment replies"
                  value={filters.allowCommentReplyEmail}
                  onChange={(v) => setFilter("allowCommentReplyEmail", v, "push")}
                />
                <BoolSelect
                  label="Share with MITAA"
                  value={filters.allowShareWithMITAA}
                  onChange={(v) => setFilter("allowShareWithMITAA", v, "push")}
                />
                <VerificationSelect
                  value={filters.verification}
                  onChange={(v) => setFilter("verification", v, "push")}
                />
                <DateFilter
                  label="Not verified since"
                  value={filters.verifiedBefore}
                  onChange={(v) => setFilter("verifiedBefore", v)}
                />
              </>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onReset}
              disabled={activeCount === 0}
              className="rounded-lg border border-input px-3 py-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset search &amp; filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shared label + control wrapper, so every filter field reads consistently. */
function Field({
  label,
  htmlFor,
  children,
}: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function TextFilter({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </Field>
  );
}

/** A numeric-grammar text field that flags unparseable tokens inline (§5.6.4). */
function NumericFilter({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const errorId = useId();
  const { errors } = parseNumericGrammar(value);
  const hasErrors = errors.length > 0;
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        aria-invalid={hasErrors}
        aria-describedby={hasErrors ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      {hasErrors && (
        <p id={errorId} className="text-xs text-destructive">
          Couldn't read: {errors.join(", ")}. Use numbers, commas, and ranges like 1980-1989.
        </p>
      )}
    </Field>
  );
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </Field>
  );
}

/** A compact multi-select: a disclosure showing the count, opening a checkbox list. */
function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  const selectedSet = new Set(selected);
  const toggle = (value: string) => {
    const next = new Set(selectedSet);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange([...next]);
  };
  const summary =
    selected.length === 0
      ? "Any"
      : selected.length === 1
        ? "1 selected"
        : `${selected.length} selected`;

  return (
    <Field label={label}>
      <details className="rounded-lg border border-input bg-background">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className={selected.length === 0 ? "text-muted-foreground" : undefined}>
            {summary}
          </span>
          <Chevron open={false} />
        </summary>
        <fieldset className="max-h-48 overflow-auto border-border border-t px-3 py-2">
          <legend className="sr-only">{label}</legend>
          {options.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">No values to filter by.</p>
          ) : (
            options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={selectedSet.has(option.value)}
                  onChange={() => toggle(option.value)}
                  className="size-4 rounded border-input accent-[var(--brand-gold)]"
                />
                {option.label}
              </label>
            ))
          )}
        </fieldset>
      </details>
    </Field>
  );
}

function PresenceSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PresenceFilter;
  onChange: (value: PresenceFilter) => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as PresenceFilter)}
        className={inputClass}
      >
        <option value="">Any</option>
        <option value="has">Has {label.toLocaleLowerCase()}</option>
        <option value="missing">Missing {label.toLocaleLowerCase()}</option>
      </select>
    </Field>
  );
}

function BoolSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: BoolFilter;
  onChange: (value: BoolFilter) => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as BoolFilter)}
        className={inputClass}
      >
        <option value="">Any</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </Field>
  );
}

function VerificationSelect({
  value,
  onChange,
}: {
  value: VerificationFilter;
  onChange: (value: VerificationFilter) => void;
}) {
  const id = useId();
  return (
    <Field label="Verification" htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as VerificationFilter)}
        className={inputClass}
      >
        <option value="">Any</option>
        <option value="verified">Verified</option>
        <option value="never">Never verified</option>
      </select>
    </Field>
  );
}

function Chevron({ open }: { open: boolean }) {
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
