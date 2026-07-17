import { type EmergencyContact, type Link, MAX_EMERGENCY_CONTACTS, MAX_LINKS } from "@pbe/shared";
import { cn } from "../../lib/utils.js";
import { FIELD_LABEL_CLASS, TextField } from "./fields.js";
import { isBlankContact, isBlankLink } from "./repeatables.js";

/**
 * The two progressive-disclosure repeatables (§5.7.5, D46/D107). A profile with
 * none starts with just the Add button; "Add a link" / "Add an emergency contact"
 * reveals the next empty row on demand, each row has its own Remove, and the Add
 * control disables at the cap (5 links, 2 contacts) and while the last row is still
 * blank — so no wall of empty fields and no stack of blank rows. A row that is
 * entirely blank is dropped before validation and save (it is not data); a
 * partly-filled link is kept and validated, so "label but no URL" is flagged
 * (URLs are checked against the strict http/https allowlist — D107).
 */

/** Shared Add affordance — disabled at the cap or while the last row sits blank. */
function AddButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // `self-start` keeps the button its natural content width: the flex-column
      // parent (the `gap` fix, OFC-260) stretches its children by default, which
      // otherwise blew this up to the full column width (live-test).
      className="inline-flex items-center gap-1.5 self-start rounded-[var(--radius-md)] border border-dashed border-input bg-background px-3 py-2 text-[length:var(--text-label)] font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <span aria-hidden="true">+</span>
      {label}
    </button>
  );
}

/** Per-row Remove control. `className` lets a caller override alignment/size. */
function RemoveButton({
  label,
  onClick,
  className,
}: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "self-start rounded-[var(--radius-md)] border border-input bg-card px-2.5 py-2 text-[length:var(--text-body-sm)] font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      Remove
    </button>
  );
}

export function LinksEditor({
  links,
  onChange,
  errorFor,
  touch,
}: {
  links: Link[] | undefined;
  onChange: (links: Link[]) => void;
  errorFor: (field: string) => string | undefined;
  touch: (field: string) => void;
}) {
  const rows = links ?? [];
  const last = rows.at(-1);
  const lastBlank = last !== undefined && isBlankLink(last);
  const atCap = rows.length >= MAX_LINKS;

  // Validation runs over the *sanitized* list (blank rows dropped from anywhere),
  // so its per-row error keys are sanitized indices. Map each rendered row to its
  // sanitized index — the count of non-blank rows before it — and key both the
  // error lookup and the touched-field for that row by it, so a blanked middle row
  // can't shift a later row's error onto the wrong (blank) row (OFC-109). A blank
  // row (`-1`) carries no error of its own.
  let nonBlank = 0;
  const fieldIndex = rows.map((row) => (isBlankLink(row) ? -1 : nonBlank++));

  const setRow = (i: number, partial: Partial<Link>) =>
    onChange(rows.map((row, index) => (index === i ? { ...row, ...partial } : row)));

  // `gap` (not `space-y`) between the rows and the Add button: the rows are
  // `<fieldset m-0>` — that browser-margin reset also cancels `space-y`'s margin,
  // which left the rows and the button visually touching. Flex `gap` is immune to
  // child margins, so the separation actually renders (OFC-260 #2, live-test).
  return (
    <div className="flex flex-col gap-4">
      {rows.map((link, i) => {
        const si = fieldIndex[i] ?? -1;
        return (
          <fieldset
            // biome-ignore lint/suspicious/noArrayIndexKey: positional rows (≤5); only end add/remove.
            key={i}
            className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
          >
            <legend className="sr-only">Link {i + 1}</legend>
            <TextField
              label="Label"
              value={link.label ?? ""}
              onChange={(v) => setRow(i, { label: v })}
              onBlur={() => {
                if (si >= 0) touch(`links.${si}.label`);
              }}
              error={si >= 0 ? errorFor(`links.${si}.label`) : undefined}
              placeholder="LinkedIn"
            />
            <TextField
              label="URL"
              type="url"
              inputMode="text"
              value={link.url ?? ""}
              onChange={(v) => setRow(i, { url: v })}
              onBlur={() => {
                if (si >= 0) touch(`links.${si}.url`);
              }}
              error={si >= 0 ? errorFor(`links.${si}.url`) : undefined}
              placeholder="https://…"
            />
            {/* A label-height spacer (sm+) reserves the label row; the Remove button
              is then vertically centred against the inputs beside it, so its short
              height no longer leaves its bottom edge floating above theirs (OFC-260
              #1). The button stays compact, and a field's error text can't shove it. */}
            <div className="flex flex-col sm:self-stretch">
              <span aria-hidden="true" className={`mb-1 hidden sm:block ${FIELD_LABEL_CLASS}`}>
                &nbsp;
              </span>
              <div className="flex sm:flex-1 sm:items-center">
                <RemoveButton
                  label={`Remove link ${i + 1}`}
                  onClick={() => onChange(rows.filter((_, index) => index !== i))}
                  className="self-center"
                />
              </div>
            </div>
          </fieldset>
        );
      })}
      {!atCap && (
        <AddButton
          label="Add a link"
          disabled={lastBlank}
          onClick={() => onChange([...rows, { label: "", url: "" }])}
        />
      )}
    </div>
  );
}

export function EmergencyContactsEditor({
  contacts,
  onChange,
  errorFor,
  touch,
}: {
  contacts: EmergencyContact[] | undefined;
  onChange: (contacts: EmergencyContact[]) => void;
  errorFor: (field: string) => string | undefined;
  touch: (field: string) => void;
}) {
  const rows = contacts ?? [];
  const last = rows.at(-1);
  const lastBlank = last !== undefined && isBlankContact(last);
  const atCap = rows.length >= MAX_EMERGENCY_CONTACTS;

  // Key per-row errors/touch by the sanitized index (non-blank rows before it), so
  // a blanked non-trailing contact can't misalign a later row's error (OFC-109).
  let nonBlank = 0;
  const fieldIndex = rows.map((row) => (isBlankContact(row) ? -1 : nonBlank++));

  const setRow = (i: number, partial: Partial<EmergencyContact>) =>
    onChange(rows.map((row, index) => (index === i ? { ...row, ...partial } : row)));

  return (
    // Flex `gap` (not `space-y`) so the cards clear each other and the Add button:
    // the cards are `<fieldset m-0>`, whose margin reset cancels `space-y` — same
    // fix and same token as the Links group (OFC-260 #3/#4, live-test).
    <div className="flex flex-col gap-4">
      {rows.map((contact, i) => {
        const si = fieldIndex[i] ?? -1;
        return (
          <fieldset
            // biome-ignore lint/suspicious/noArrayIndexKey: positional rows (≤2); only end add/remove.
            key={i}
            className="m-0 space-y-3 rounded-[var(--radius-lg)] border border-border-hairline p-3"
          >
            <div className="flex items-center justify-between">
              <legend className="text-[length:var(--text-label-up)] font-semibold uppercase tracking-wide text-muted-foreground">
                {i === 0 ? "Primary" : "Secondary"}
              </legend>
              <RemoveButton
                label={`Remove emergency contact ${i + 1}`}
                onClick={() => onChange(rows.filter((_, index) => index !== i))}
              />
            </div>
            <TextField
              label="Name"
              value={contact.name ?? ""}
              onChange={(v) => setRow(i, { name: v })}
              autoComplete="off"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Phone"
                type="tel"
                inputMode="tel"
                value={contact.phone ?? ""}
                onChange={(v) => setRow(i, { phone: v })}
                onBlur={() => {
                  if (si >= 0) touch(`emergencyContacts.${si}.phone`);
                }}
                error={si >= 0 ? errorFor(`emergencyContacts.${si}.phone`) : undefined}
              />
              <TextField
                label="Email"
                type="email"
                inputMode="email"
                value={contact.email ?? ""}
                onChange={(v) => setRow(i, { email: v })}
                onBlur={() => {
                  if (si >= 0) touch(`emergencyContacts.${si}.email`);
                }}
                error={si >= 0 ? errorFor(`emergencyContacts.${si}.email`) : undefined}
              />
            </div>
          </fieldset>
        );
      })}
      {!atCap && (
        <AddButton
          label="Add an emergency contact"
          disabled={lastBlank}
          onClick={() => onChange([...rows, { name: "", phone: "", email: "" }])}
        />
      )}
    </div>
  );
}
