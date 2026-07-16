import { getHelpEntry } from "@pbe/help-content";
import { Lock } from "lucide-react";
import { type ReactNode, useId } from "react";
import { ControlHelp } from "../../components/ControlHelp.js";
import { cn } from "../../lib/utils.js";

/**
 * The Profile page's shared field primitives — the view-mode read-outs and the
 * edit-mode inputs, plus the two "you may not see / may not change this" markers
 * the role projection produces (§5.7.2). Each input wires its label, helper, and
 * error together with `htmlFor`/`aria-describedby`/`aria-invalid` so validation is
 * programmatically associated and announced (§5.7.8, D32).
 */

/**
 * The one field-name style, shared by the view read-outs and the edit inputs so a
 * field label looks identical in both modes and across every field (uppercase,
 * letter-spaced, muted — distinct from the teal, bold section eyebrows). Any
 * ad-hoc field label elsewhere on the page composes this same class.
 */
export const FIELD_LABEL_CLASS =
  "text-[length:var(--text-label-up)] font-semibold uppercase tracking-wide text-muted-foreground";

/** A section eyebrow + its body, the two-up grid's repeating unit (§5.7.1). */
export function Section({
  title,
  id,
  children,
  locked = false,
}: {
  title: string;
  id?: string;
  children: ReactNode;
  /** Show a lock on the eyebrow — the manager's read-only restricted block. */
  locked?: boolean;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={id ?? headingId} className="min-w-0">
      <h2
        id={id ?? headingId}
        className="mb-3 flex items-center gap-1.5 text-[length:var(--text-label-up)] font-bold uppercase tracking-wide text-primary"
      >
        {title}
        {locked && (
          <span aria-hidden="true" title="Read-only" className="inline-flex items-center">
            <Lock size={13} />
          </span>
        )}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** A view-mode label/value read-out (e.g. EMAIL · rbrown@mit.edu). */
export function ReadField({
  label,
  children,
  helpKey,
}: { label: string; children: ReactNode; helpKey?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <p className={FIELD_LABEL_CLASS}>{label}</p>
        {helpKey && <ControlHelp entryKey={helpKey} />}
      </div>
      <div className="mt-0.5 text-[length:var(--text-body-lg)] text-foreground">{children}</div>
    </div>
  );
}

/**
 * The manager's "this field is private" marker (§5.7.2): shown where a brother's
 * share-toggle is *off*, so a manager sees that a field exists and is private
 * without seeing the protected value (which stays with the owner and admins).
 */
export function PrivateMarker({ label }: { label: string }) {
  return (
    <div>
      <p className={FIELD_LABEL_CLASS}>{label}</p>
      <p className="mt-1 flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-[length:var(--text-body-sm)] text-muted-foreground">
        <Lock size={14} aria-hidden="true" />
        This field is private — visible to the owner and administrators only.
      </p>
    </div>
  );
}

/**
 * Shared input/label/helper/error markup for the text-like edit fields. When
 * `helpKey` is given, the helper text defaults to that registry entry's
 * `helperText` (a call-site `helper` still wins, for dynamic cases) and the `?`
 * toggle-tip renders beside the label iff the entry carries one (Phase 6b / D53).
 */
function FieldShell({
  id,
  label,
  helper,
  error,
  helpKey,
  children,
}: {
  id: string;
  label: string;
  helper?: string;
  error?: string;
  helpKey?: string;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const resolvedHelper = helper ?? (helpKey ? getHelpEntry(helpKey)?.helperText : undefined);
  const helperId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy =
    [error ? errorId : null, resolvedHelper ? helperId : null].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <label htmlFor={id} className={cn("block", FIELD_LABEL_CLASS)}>
          {label}
        </label>
        {helpKey && <ControlHelp entryKey={helpKey} />}
      </div>
      {children(describedBy)}
      {resolvedHelper && !error && (
        <p id={helperId} className="mt-1 text-[length:var(--text-body-sm)] text-muted-foreground">
          {resolvedHelper}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-[length:var(--text-body-sm)] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-input bg-background px-3 py-2.5 text-[length:var(--text-body-lg)] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive";

export function TextField({
  id: providedId,
  label,
  value,
  onChange,
  onBlur,
  error,
  helper,
  helpKey,
  type = "text",
  inputMode,
  autoComplete,
  placeholder,
  mono = false,
  disabled = false,
  maxLength,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  helper?: string;
  helpKey?: string;
  type?: string;
  inputMode?: "text" | "email" | "tel" | "numeric";
  autoComplete?: string;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  maxLength?: number;
}) {
  const fallbackId = useId();
  const id = providedId ?? fallbackId;
  return (
    <FieldShell id={id} label={label} helper={helper} error={error} helpKey={helpKey}>
      {(describedBy) => (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            inputClass,
            mono && "font-mono",
            disabled && "bg-muted text-muted-foreground",
          )}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({
  id: providedId,
  label,
  value,
  onChange,
  onBlur,
  error,
  helper,
  children,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  helper?: string;
  children: ReactNode;
}) {
  const fallbackId = useId();
  const id = providedId ?? fallbackId;
  return (
    <FieldShell id={id} label={label} helper={helper} error={error}>
      {(describedBy) => (
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(inputClass, "appearance-none bg-background")}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  id: providedId,
  label,
  value,
  onChange,
  onBlur,
  error,
  helper,
  helpKey,
  rows = 3,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  helper?: string;
  helpKey?: string;
  rows?: number;
}) {
  const fallbackId = useId();
  const id = providedId ?? fallbackId;
  return (
    <FieldShell id={id} label={label} helper={helper} error={error} helpKey={helpKey}>
      {(describedBy) => (
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          rows={rows}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(inputClass, "resize-y")}
        />
      )}
    </FieldShell>
  );
}

/**
 * A read-only, visibly **locked** field (COMPONENTS.md "Read-only / locked"):
 * the Constitution ID on this page (set only at Add-Brother), and any value a
 * role may see but not change.
 */
export function LockedField({
  label,
  value,
  note,
}: { label: string; value: string; note?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={cn("mb-1 block", FIELD_LABEL_CLASS)}>
        {label}
      </label>
      {/* COMPONENTS.md specifies --text-4 here, but that on --muted is only
          2.88:1 — below AA. The CI-gated AA requirement (D79) wins, so the
          locked text uses --muted-foreground. */}
      <div
        id={id}
        className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-muted px-3 py-2.5 text-[length:var(--text-body-lg)] text-muted-foreground"
      >
        <Lock size={16} aria-hidden="true" />
        <span>{value}</span>
        {note && <span className="text-[length:var(--text-body-sm)]">— {note}</span>}
      </div>
    </div>
  );
}
