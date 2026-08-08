import type { Role } from "@pbe/shared";
import { ChevronRight } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ClearButton } from "../../components/ClearButton.js";
import { ControlHelp } from "../../components/ControlHelp.js";
import { useDetailsAutoClose } from "../../lib/useDetailsAutoClose.js";
import { CourseChipName } from "./Chips.js";
import {
  type BoolFilter,
  type DirectoryFilters,
  type FilterOption,
  type FilterOptions,
  type MentorFilter,
  type PresenceFilter,
  type StaffFilter,
  type VerificationFilter,
  type YesFilter,
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
 * most robust path for the WCAG 2.2 AA gate and for assistive tech (D79). Every
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
  /**
   * Clears Name Search, all filters, the sort, "Include deceased" and "Starred
   * only" (N169) — but not the column lens (D38) and not the row selection.
   */
  onReset: () => void;
  /**
   * Whether {@link onReset} would actually change anything — the Reset button's
   * enabled state (OFC-394).
   *
   * ⚠ **Deliberately not `activeCount > 0`.** That was the old test, and it was
   * already wrong: Reset clears the Name Search, the sort, "Include deceased" and
   * "Starred only" as well as the filters, so a view narrowed *only* by the search
   * box offered a greyed-out Reset. Invisible while the button was buried in the
   * fold; the whole point of moving it to the header is the case where someone
   * wants to clear a search, so the enabled test has to cover everything Reset
   * touches. The count badge still reports filters alone — it answers a different
   * question.
   */
  canReset: boolean;
}

export function FilterPanel({
  filters,
  setFilter,
  options,
  role,
  activeCount,
  onReset,
  canReset,
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
      {/* Reset sits on the header row, right-justified, NOT at the foot of the open
        panel (OFC-394). Coming back from a profile, clearing the view used to mean
        open the fold → Reset → close it again; and because the control was inside
        the fold, someone wanting to clear the *search box* had no reason to think
        to look for it there at all. On the header row it is reachable without
        opening anything.

        ⚠ The two controls are **siblings**, not nested: Reset cannot go inside the
        disclosure `<button>` (nested interactive elements are invalid HTML and the
        inner control is unreachable for assistive tech), which is why the
        disclosure gives up `w-full` and this flex row owns the layout instead. The
        `<h2>` wraps only the disclosure, so the heading still names the region it
        expands and Reset is not read as part of that name. */}
      <div className="flex items-center gap-2 pr-2">
        <h2 className="min-w-0 flex-1">
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
        <ResetButton onReset={onReset} canReset={canReset} />
      </div>

      {open && (
        <div id={regionId} className="border-border border-t px-4 py-4">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumericFilter
              label="Class Year"
              placeholder="e.g. 1980, 1985-1989, 1990-"
              value={filters.classYear}
              onChange={(v) => setFilter("classYear", v)}
              helpKey="directory.filter.classYear"
            />
            <NumericFilter
              label="Constitution ID"
              placeholder="e.g. 721, 900-1000"
              value={filters.constitutionId}
              onChange={(v) => setFilter("constitutionId", v)}
              helpKey="directory.filter.constitutionId"
            />
            <MultiSelectFilter
              label="Course"
              options={options.major}
              selected={filters.major}
              onChange={(v) => setFilter("major", v, "push")}
              // OFC-265: render each option as the shared course chip + aligned
              // name (the same component the Profile course picker uses, N108),
              // for visual consistency with the grid/cards/profile.
              renderOption={(option) => <CourseChipName code={option.value} />}
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
            <TextFilter
              label="Employer"
              placeholder="contains…"
              value={filters.employer}
              onChange={(v) => setFilter("employer", v)}
              // The `?` carries the one thing a brother cannot infer from the
              // field: only the *current* employer is stored, so an old company
              // finds nobody (D164).
              helpKey="directory.filter.employer"
            />
            <MentorSelect
              value={filters.willingToMentor}
              onChange={(v) => setFilter("willingToMentor", v, "push")}
            />
            {/* Deceased sits between Mentoring and Staff (Forrest's call, OFC-399). */}
            <YesSelect
              label="Deceased"
              value={filters.deceasedOnly}
              onChange={(v) => setFilter("deceasedOnly", v, "push")}
              helpKey="directory.filter.deceasedOnly"
            />
            {/* Staff sits last in the all-roles block (Forrest's call, OFC-386): it
              filters on who administers the Book rather than on anything about the
              brother himself, so it reads as the odd one out and belongs at the end. */}
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
                {/* The whole-record hides, between Telephone and the consent flags
                  (Forrest's call, OFC-399) — they find the records a brother's view
                  omits entirely (D124/D115). */}
                <YesSelect
                  label="Unlisted"
                  value={filters.unlisted}
                  onChange={(v) => setFilter("unlisted", v, "push")}
                  helpKey="directory.filter.unlisted"
                />
                <YesSelect
                  label="De-brothered"
                  value={filters.debrothered}
                  onChange={(v) => setFilter("debrothered", v, "push")}
                  helpKey="directory.filter.debrothered"
                />
                <BoolSelect
                  label="Subscribed to PBE News"
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
                  helpKey="directory.filter.verifiedBefore"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "Reset search & filters" — one button, rendered once, on the panel header row
 * (OFC-394). Clears the Name Search, every structured filter, the sort, "Include
 * deceased" and "Starred only" (N169) — everything that narrows which brothers are
 * listed. It deliberately leaves the **column lens** (D38, which changes what each
 * row shows, not which rows there are) and the **row selection** (N79, which has
 * its own Clear in the action bar) alone.
 */
function ResetButton({ onReset, canReset }: { onReset: () => void; canReset: boolean }) {
  return (
    <button
      type="button"
      onClick={onReset}
      disabled={!canReset}
      className="shrink-0 rounded-lg border border-input px-3 py-1.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      Reset search &amp; filters
    </button>
  );
}

/** Label row with an optional top-right Clear "×" (shown when the field is set). */
function Field({
  label,
  htmlFor,
  onClear,
  helpKey,
  children,
}: {
  label: string;
  htmlFor?: string;
  onClear?: () => void;
  /** Registry id for an optional `?` toggle-tip beside the label (Phase 6b). */
  helpKey?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {/* min-h reserves the clear button's height so the row never shifts when
          the "×" appears or disappears. */}
      <div className="flex min-h-6 items-center justify-between">
        <div className="flex items-center gap-1.5">
          <label htmlFor={htmlFor} className="text-xs font-medium">
            {label}
          </label>
          {helpKey && <ControlHelp entryKey={helpKey} />}
        </div>
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
  helpKey,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  /** Registry id for an optional `?` toggle-tip beside the label (as NumericFilter). */
  helpKey?: string;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} helpKey={helpKey}>
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
  helpKey,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  /** Registry id for the `?` toggle-tip beside the label (OFC-283). */
  helpKey?: string;
}) {
  const id = useId();
  const errorId = useId();
  const { errors } = parseNumericGrammar(value);
  const hasErrors = errors.length > 0;
  return (
    <Field label={label} htmlFor={id} helpKey={helpKey}>
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
  helpKey,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helpKey?: string;
}) {
  const id = useId();
  return (
    <Field
      label={label}
      htmlFor={id}
      helpKey={helpKey}
      onClear={value ? () => onChange("") : undefined}
    >
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
  renderOption,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (value: string[]) => void;
  /** Optional custom row content; defaults to the option's text label. */
  renderOption?: (option: FilterOption) => React.ReactNode;
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

  // Close the disclosure on an outside click or Escape — a native <details>
  // stays open otherwise, unlike the Combobox popover (the same hook the Columns
  // picker and avatar menu use).
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useDetailsAutoClose(detailsRef);

  return (
    <Field label={label} onClear={selected.length > 0 ? () => onChange([]) : undefined}>
      <details ref={detailsRef} className="rounded-lg border border-input bg-background">
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
              // items-start so the checkbox aligns with the FIRST line of a
              // multi-line option (e.g. a wrapped course name), matching the chip,
              // rather than centring on the whole two-line block. mt-0.5 nudges the
              // 16px checkbox to the centre of that first (20px) line.
              <label key={option.value} className="flex items-start gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={selectedSet.has(option.value)}
                  onChange={() => toggle(option.value)}
                  className="mt-0.5 size-4 rounded border-input accent-[var(--brand-gold)]"
                />
                {renderOption ? renderOption(option) : option.label}
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
    <Field
      label="Staff"
      htmlFor={id}
      helpKey="directory.filter.staff"
      onClear={value ? () => onChange("") : undefined}
    >
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as StaffFilter)}
        className={inputClass}
      >
        <option value="">Any</option>
        <option value="staffOnly">PBE Address Book Managers and Administrators</option>
      </select>
    </Field>
  );
}

/**
 * The mentoring filter (D166, OFC-386) — an all-brothers control like Staff, since
 * `willingToMentor` is public. "Any / Yes" only: see {@link MentorFilter} for why
 * there is deliberately no "No".
 */
function MentorSelect({
  value,
  onChange,
}: {
  value: MentorFilter;
  onChange: (value: MentorFilter) => void;
}) {
  const id = useId();
  return (
    <Field
      label="Willing to mentor"
      htmlFor={id}
      helpKey="directory.filter.willingToMentor"
      onClear={value ? () => onChange("") : undefined}
    >
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as MentorFilter)}
        className={inputClass}
      >
        <option value="">Any</option>
        <option value="yes">Yes</option>
      </select>
    </Field>
  );
}

/**
 * A **narrow-to-yes** select — "Any / Yes" (OFC-399), the shape {@link YesFilter}
 * describes. `MentorSelect` above is deliberately *not* folded into this: it carries
 * its own label, help key and the D166 reasoning for why it has no "No", and
 * collapsing them would bury that. This one is shared by the three OFC-399 filters,
 * which differ only in their label and help entry.
 */
function YesSelect({
  label,
  value,
  onChange,
  helpKey,
}: {
  label: string;
  value: YesFilter;
  onChange: (value: YesFilter) => void;
  helpKey?: string;
}) {
  const id = useId();
  return (
    <Field
      label={label}
      htmlFor={id}
      helpKey={helpKey}
      onClear={value ? () => onChange("") : undefined}
    >
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as YesFilter)}
        className={inputClass}
      >
        <option value="">Any</option>
        <option value="yes">Yes</option>
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
    <Field
      label="Verification"
      htmlFor={id}
      helpKey="directory.filter.verification"
      onClear={value ? () => onChange("") : undefined}
    >
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
