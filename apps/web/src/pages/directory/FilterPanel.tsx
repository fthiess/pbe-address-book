import type { Role } from "@pbe/shared";
import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { ClearButton } from "../../components/ClearButton.js";
import {
  type BoolFilter,
  type DirectoryFilters,
  type FilterOption,
  type FilterOptions,
  type PresenceFilter,
  type StaffFilter,
  type VerificationFilter,
  canUseStaffFilters,
  parseNumericGrammar,
} from "./filters.js";

/**
 * The structured filter panel above the grid (§5.6.4, D38). A collapsible region
 * (column headers stay reserved for sorting) of typed controls — numeric-grammar
 * text, multi-selects drawn from the data, a substring box, and the staff-only
 * presence/consent/verification controls. "Filterable ⟺ visible": the staff
 * controls appear only for managers/admins, the same gate as their columns, and
 * are set apart under a labeled divider so the all-brother filters read cleanly.
 *
 * Built from native form controls (selects, checkboxes, text/date inputs) — the
 * most robust path for the WCAG 2.2 AA gate and the 60+ audience (D79). Every
 * field carries a **clear** affordance (an "×", echoing the search box) that
 * appears only when the field is constraining the view.
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
  // Start collapsed on every mount, regardless of whether filters are active. The
  // panel's open/closed state is deliberately NOT persisted (Forrest's call): the
  // Directory remounts on a Back-navigation from a profile, so deriving `open` from
  // `activeCount` made the returned panel inconsistently expanded-when-filtered /
  // collapsed-when-not. Always-collapsed is consistent, and the header's "N active"
  // badge still signals that filters are applied while the panel is closed.
  const [open, setOpen] = useState(false);
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
              placeholder="e.g. 1980, 1985-1989, 1990-"
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
            <StaffSelect value={filters.staff} onChange={(v) => setFilter("staff", v, "push")} />
          </div>

          {staff && (
            <div className="mt-6 border-border border-t pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Membership upkeep · managers &amp; admins
              </p>
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
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
              </div>
            </div>
          )}

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

/** Label row with an optional top-right Clear "×" (shown when the field is set). */
function Field({
  label,
  htmlFor,
  onClear,
  children,
}: {
  label: string;
  htmlFor?: string;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {/* min-h reserves the clear button's height so the row never shifts when
          the "×" appears or disappears. */}
      <div className="flex min-h-6 items-center justify-between">
        <label htmlFor={htmlFor} className="text-xs font-medium">
          {label}
        </label>
        {onClear && <ClearButton label={label} onClick={onClear} />}
      </div>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A text field with an inline trailing "×" clear, echoing the Name Search box. */
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
      <ClearableInput
        id={id}
        type="text"
        label={label}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
      />
    </Field>
  );
}

/** A numeric-grammar text field with an inline clear that flags bad tokens inline (§5.6.4). */
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
      <ClearableInput
        id={id}
        type="text"
        inputMode="numeric"
        label={label}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        aria-invalid={hasErrors}
        aria-describedby={hasErrors ? errorId : undefined}
      />
      {hasErrors && (
        <p id={errorId} className="text-xs text-destructive">
          Couldn't read: {errors.join(", ")}. Use numbers, commas, and ranges like 1980-1989, 1990-,
          or -1975.
        </p>
      )}
    </Field>
  );
}

/** A date field; its clear lives in the label row (the native picker owns the right edge). */
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
    <Field label={label} htmlFor={id} onClear={value ? () => onChange("") : undefined}>
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

/** A text/numeric input with an absolutely-positioned trailing "×" when non-empty. */
function ClearableInput({
  id,
  type,
  label,
  value,
  placeholder,
  inputMode,
  onChange,
  ...aria
}: {
  id: string;
  type: "text";
  label: string;
  value: string;
  placeholder?: string;
  inputMode?: "numeric";
  onChange: (value: string) => void;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} pr-9`}
        {...aria}
      />
      {value !== "" && (
        <span className="absolute inset-y-0 right-1 flex items-center">
          <ClearButton label={label} onClick={() => onChange("")} />
        </span>
      )}
    </div>
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
    <Field label={label} onClear={selected.length > 0 ? () => onChange([]) : undefined}>
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

/**
 * The Staff filter (OFC-199) — an all-brothers control (role is public, OFC-139),
 * so it lives in the top section, not the manager/admin block. A single "Any /
 * Managers and Administrators" toggle: with only ~6–8 staff, a combined filter is
 * simpler than separate manager/admin options and no less useful.
 */
function StaffSelect({
  value,
  onChange,
}: {
  value: StaffFilter;
  onChange: (value: StaffFilter) => void;
}) {
  const id = useId();
  return (
    <Field label="Staff" htmlFor={id} onClear={value ? () => onChange("") : undefined}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as StaffFilter)}
        className={inputClass}
      >
        <option value="">Any</option>
        <option value="staffOnly">Managers and Administrators</option>
      </select>
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
    <Field label={label} htmlFor={id} onClear={value ? () => onChange("") : undefined}>
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
    <Field label={label} htmlFor={id} onClear={value ? () => onChange("") : undefined}>
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
    <Field label="Verification" htmlFor={id} onClear={value ? () => onChange("") : undefined}>
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
    <ChevronRight
      size={14}
      strokeWidth={1.6}
      aria-hidden="true"
      className={open ? "rotate-90 transition-transform" : "transition-transform"}
    />
  );
}
