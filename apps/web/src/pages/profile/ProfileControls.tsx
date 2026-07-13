import type { Role, ValidationIssue } from "@pbe/shared";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { DeceasedFacts, StatusWriteOutcome } from "../../lib/api.js";
import type { ProfileRecord } from "../../lib/types.js";
import { cn } from "../../lib/utils.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { canonicalName } from "./display.js";
import type { Viewer } from "./viewer.js";

/**
 * The 4c-2 privileged-action UI (API-SPEC §3–§5; DECISIONS N40/N41/N44): the
 * verification affordance + staleness nudge (owner + staff), and the staff/admin
 * control panel — mark-deceased (guided), de-brother/reinstate, change-role, and
 * delete. Each action is a dedicated server call surfaced through {@link
 * ProfileActions}; this module owns only the presentation, confirmations, and the
 * guided deceased-fields form.
 */
export interface ProfileActions {
  /** `POST …/verify` — confirm the record is current (owner/staff). */
  verify: () => Promise<void>;
  /** `PUT …/deceased` — raise/edit/clear the deceased state (staff). */
  setDeceased: (deceased: boolean, facts?: DeceasedFacts) => Promise<StatusWriteOutcome>;
  /** `PUT …/debrothered` — raise/reverse de-brothering (admin). */
  setDebrothered: (debrothered: boolean) => Promise<StatusWriteOutcome>;
  /** `PUT /api/profiles/:id/role` — change role (admin). */
  changeRole: (role: Role) => Promise<{ status: "ok"; role: Role } | { status: "last_admin" }>;
  /** `DELETE /api/profiles/:id` — remove the brother (admin). */
  removeProfile: () => Promise<
    { status: "ok" } | { status: "ghost_failed" } | { status: "last_admin" }
  >;
}

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/** Whether a verification date is missing or older than two years (the staleness nudge). */
function isStale(lastVerifiedDate: string | undefined, now: number): boolean {
  if (!lastVerifiedDate) {
    return true;
  }
  const verified = Date.parse(`${lastVerifiedDate}T00:00:00Z`);
  return Number.isNaN(verified) || now - verified > TWO_YEARS_MS;
}

/**
 * The verification affordance in the Record-status block (§5.7.6; D28/D48). The
 * owner confirms their own details are current; a manager/admin attests another
 * brother's record with cautioned copy. A > 2-year-old (or absent) verification
 * shows a gentle staleness nudge. Frozen — and so hidden — on a deceased record
 * (verification is a no-op there).
 */
export function VerifyControl({
  record,
  viewer,
  onVerify,
}: {
  record: ProfileRecord;
  viewer: Viewer;
  onVerify: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (record.deceased?.isDeceased) {
    return null;
  }
  // `Date.now()` at render is fine for a coarse two-year staleness check (no
  // sub-day precision matters); it never drives a write, only the nudge copy.
  const stale = isStale(record.lastVerifiedDate, Date.now());

  const click = async () => {
    setBusy(true);
    try {
      await onVerify();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {stale && (
        <p className="text-[length:var(--text-body-sm)] text-[var(--warning-strong,var(--muted-foreground))]">
          {record.lastVerifiedDate
            ? "This information hasn’t been confirmed in over two years."
            : "This information hasn’t been confirmed yet."}
        </p>
      )}
      <button
        type="button"
        onClick={click}
        disabled={busy}
        className="rounded-[var(--radius-md)] border border-input bg-card px-3 py-2 text-[length:var(--text-label)] font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {viewer.isOwner ? "Confirm my details are current" : "Mark as verified"}
      </button>
      {!viewer.isOwner && (
        <p className="text-[length:var(--text-body-sm)] text-muted-foreground">
          Records that you confirm are stamped with your name and today’s date.
        </p>
      )}
    </div>
  );
}

/**
 * The staff/admin control panel at the foot of the Profile view. Managers and
 * admins get mark-deceased; admins additionally get de-brother/reinstate, change
 * role, and delete. Each destructive/coordinated action confirms first.
 */
export function StaffControls({
  record,
  viewer,
  actions,
}: {
  record: ProfileRecord;
  viewer: Viewer;
  actions: ProfileActions;
}) {
  const isStaff = viewer.role === "manager" || viewer.role === "admin";
  const isAdmin = viewer.role === "admin";
  if (!isStaff) {
    return null;
  }
  const name = canonicalName(record);
  const deceased = record.deceased?.isDeceased === true;
  const debrothered = record.debrothered?.isDebrothered === true;

  return (
    <section className="mt-6 rounded-[var(--radius-xl)] border border-border bg-[var(--muted)] p-5">
      <h2 className="text-[length:var(--text-label)] font-semibold uppercase tracking-wide text-muted-foreground">
        Staff controls
      </h2>
      <div className="mt-4 flex flex-col gap-6">
        <DeceasedControls record={record} name={name} deceased={deceased} actions={actions} />
        {isAdmin && (
          <>
            <DebrotherControl name={name} debrothered={debrothered} actions={actions} />
            <RoleControl record={record} actions={actions} />
            <DeleteControl name={name} actions={actions} />
          </>
        )}
      </div>
    </section>
  );
}

/** The mark-deceased / edit-memorial / clear-deceased cluster (§5.7.7; N40). */
function DeceasedControls({
  record,
  name,
  deceased,
  actions,
}: {
  record: ProfileRecord;
  name: string;
  deceased: boolean;
  actions: ProfileActions;
}) {
  const [dialog, setDialog] = useState<"none" | "mark" | "clear">("none");

  return (
    <ControlRow
      label="Deceased status"
      help={
        deceased
          ? "This brother is marked deceased. You can correct the memorial details or remove the mark."
          : "Marking a brother deceased opens the In Memoriam treatment and turns off their email delivery."
      }
    >
      {deceased ? (
        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={() => setDialog("mark")}>Edit memorial details</SecondaryButton>
          <SecondaryButton onClick={() => setDialog("clear")}>Remove deceased mark</SecondaryButton>
        </div>
      ) : (
        <SecondaryButton onClick={() => setDialog("mark")}>Mark as deceased…</SecondaryButton>
      )}

      {dialog === "mark" && (
        <MarkDeceasedDialog
          record={record}
          name={name}
          alreadyDeceased={deceased}
          onClose={() => setDialog("none")}
          onSubmit={(facts) => actions.setDeceased(true, facts)}
        />
      )}
      {dialog === "clear" && (
        <ConfirmDialog
          title="Remove the deceased mark?"
          confirmLabel="Remove mark"
          cancelLabel="Cancel"
          onCancel={() => setDialog("none")}
          onConfirm={() => {
            void actions.setDeceased(false);
            setDialog("none");
          }}
        >
          This clears the In Memoriam treatment for <strong>{name}</strong> and restores their
          previous email-delivery settings.
        </ConfirmDialog>
      )}
    </ControlRow>
  );
}

/** De-brother / reinstate (admin only; D115/N41). */
function DebrotherControl({
  name,
  debrothered,
  actions,
}: {
  name: string;
  debrothered: boolean;
  actions: ProfileActions;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    setConfirming(false);
    setError(null);
    const outcome = await actions.setDebrothered(!debrothered);
    if (outcome.status === "ghost_failed") {
      setError("The newsletter system couldn’t be updated. Nothing changed — please try again.");
    }
  };

  return (
    <ControlRow
      label="Brotherhood status"
      help={
        debrothered
          ? "This brother has been de-brothered — hidden from other brothers and removed from the newsletter."
          : "De-brothering removes a member from the brotherhood: hidden from other brothers, sign-in denied, and removed from the newsletter."
      }
    >
      <SecondaryButton onClick={() => setConfirming(true)}>
        {debrothered ? "Reinstate brother…" : "De-brother…"}
      </SecondaryButton>
      {error && (
        <p className="mt-2 text-[length:var(--text-body-sm)] text-destructive" role="alert">
          {error}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title={debrothered ? "Reinstate this brother?" : "De-brother this member?"}
          confirmLabel={debrothered ? "Reinstate" : "De-brother"}
          cancelLabel="Cancel"
          tone={debrothered ? "neutral" : "destructive"}
          onCancel={() => setConfirming(false)}
          onConfirm={apply}
        >
          {debrothered ? (
            <>
              <strong>{name}</strong> will be restored to the brotherhood and re-added to the
              newsletter.
            </>
          ) : (
            <>
              <strong>{name}</strong> will be hidden from other brothers, denied sign-in, and
              removed from the newsletter. This can be reversed.
            </>
          )}
        </ConfirmDialog>
      )}
    </ControlRow>
  );
}

/** The three assignable roles and their display labels (visual-design Profile.dc.html). */
const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "brother", label: "Brother" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Administrator" },
];

/**
 * Change role (admin only; D51/D106). A **segmented control** (Brother / Manager /
 * Administrator) with the brother's *current* role highlighted — the visual-design
 * spec for this control (`Profile.dc.html` "Administrator controls"). Selecting a
 * segment applies immediately (the design carries no separate Apply step; a role
 * change is reversible). The current role is read straight off the profile record
 * the page already holds (`record.role` — public since OFC-139, so no separate
 * fetch), defaulting to `brother` when absent. A `409 last_admin` keeps the current
 * role and explains. Modeled on the masthead {@link FontSizeToggle} pattern
 * (fieldset + `aria-pressed`).
 */
function RoleControl({ record, actions }: { record: ProfileRecord; actions: ProfileActions }) {
  const [role, setRole] = useState<Role>(record.role ?? "brother");
  const [pending, setPending] = useState<Role | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const select = async (next: Role) => {
    if (next === role || pending) {
      return;
    }
    setPending(next);
    setMessage(null);
    const outcome = await actions.changeRole(next);
    setPending(null);
    if (outcome.status === "last_admin") {
      setMessage("This is the only administrator — their role can’t be changed.");
      return;
    }
    setRole(outcome.role);
    setMessage(
      `Role set to ${ROLE_OPTIONS.find((option) => option.value === outcome.role)?.label}.`,
    );
  };

  return (
    <ControlRow
      label="Role"
      help="Controls what this brother can see and do. Takes effect immediately."
    >
      <fieldset className="m-0 inline-flex items-center gap-0.5 rounded-[var(--radius-lg)] border border-input bg-[var(--muted)] p-1 disabled:opacity-60">
        <legend className="sr-only">Role</legend>
        {ROLE_OPTIONS.map((option) => {
          const active = role === option.value;
          const busy = pending === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => select(option.value)}
              className={cn(
                "h-9 rounded-[var(--radius-md)] px-4 text-[length:var(--text-label)] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                busy && "opacity-70",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </fieldset>
      {message && (
        <output className="mt-2 block text-[length:var(--text-body-sm)] text-muted-foreground">
          {message}
        </output>
      )}
    </ControlRow>
  );
}

/** Delete (admin only; §4). */
function DeleteControl({ name, actions }: { name: string; actions: ProfileActions }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    setConfirming(false);
    setError(null);
    const outcome = await actions.removeProfile();
    if (outcome.status === "ghost_failed") {
      setError(
        "The newsletter system couldn’t be updated. Nothing was deleted — please try again.",
      );
    } else if (outcome.status === "last_admin") {
      setError(
        "This is the only administrator, so delete is blocked to keep an admin in the directory. Assign another admin first.",
      );
    }
    // On success the container navigates away, so there is nothing more to do here.
  };

  return (
    <ControlRow
      label="Delete"
      help="Permanently remove this brother from Book, the newsletter, and their photos. This cannot be undone."
    >
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-[var(--radius-md)] border border-destructive/40 bg-card px-3 py-2 text-[length:var(--text-label)] font-semibold text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Delete brother…
      </button>
      {error && (
        <p className="mt-2 text-[length:var(--text-body-sm)] text-destructive" role="alert">
          {error}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete this brother?"
          confirmLabel="Delete permanently"
          cancelLabel="Cancel"
          tone="destructive"
          onCancel={() => setConfirming(false)}
          onConfirm={apply}
        >
          <strong>{name}</strong> and their photos will be permanently removed from Book and the
          newsletter. This cannot be undone.
        </ConfirmDialog>
      )}
    </ControlRow>
  );
}

/**
 * The guided mark-deceased flow (§5.7.7; D49/D122). For a living brother it opens
 * as a **pure confirmation** (the consequences), and only on confirm reveals the
 * five deceased fields — focus moving to the first — with the b./d. lifespan the
 * banner will show. For an already-deceased record it opens straight on the fields
 * (a staff correction). Validation is server-side (422 → inline issues).
 */
function MarkDeceasedDialog({
  record,
  name,
  alreadyDeceased,
  onClose,
  onSubmit,
}: {
  record: ProfileRecord;
  name: string;
  alreadyDeceased: boolean;
  onClose: () => void;
  onSubmit: (facts: DeceasedFacts) => Promise<StatusWriteOutcome>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"confirm" | "fields">(alreadyDeceased ? "fields" : "confirm");
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const existing = record.deceased;
  const [dateOfDeath, setDateOfDeath] = useState(existing?.dateOfDeath ?? "");
  const [deathYear, setDeathYear] = useState(existing?.deathYear ? String(existing.deathYear) : "");
  const [birthYear, setBirthYear] = useState(existing?.birthYear ? String(existing.birthYear) : "");
  const [obituaryUrl, setObituaryUrl] = useState(existing?.obituaryUrl ?? "");
  const [inMemoriamUrl, setInMemoriamUrl] = useState(existing?.inMemoriamUrl ?? "");
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  // Move focus into the fields when they appear (the guided reveal, D122).
  useEffect(() => {
    if (phase === "fields") {
      firstFieldRef.current?.focus();
    }
  }, [phase]);

  const issueFor = (field: string): string | undefined =>
    issues.find((issue) => issue.field === `deceased.${field}`)?.message;

  const submit = async () => {
    setBusy(true);
    setIssues([]);
    const facts: DeceasedFacts = {};
    if (dateOfDeath) facts.dateOfDeath = dateOfDeath;
    if (deathYear) facts.deathYear = Number(deathYear);
    if (birthYear) facts.birthYear = Number(birthYear);
    if (obituaryUrl) facts.obituaryUrl = obituaryUrl;
    if (inMemoriamUrl) facts.inMemoriamUrl = inMemoriamUrl;
    const outcome = await onSubmit(facts);
    setBusy(false);
    if (outcome.status === "invalid") {
      setIssues(outcome.issues);
      return;
    }
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-full max-w-lg rounded-[var(--radius-xl)] border border-border bg-card p-6 text-card-foreground shadow-[var(--shadow-modal)] backdrop:bg-black/40"
    >
      <h2 id={titleId} className="text-[length:var(--text-h4)] font-bold">
        {alreadyDeceased ? "Edit memorial details" : `Mark ${name} as deceased`}
      </h2>

      {phase === "confirm" ? (
        <>
          <div className="mt-2 text-[length:var(--text-body)] text-muted-foreground">
            <p>
              This opens the In Memoriam treatment for {name} and turns off their newsletter and
              comment email. Their previous settings are saved and restored if you remove the mark.
            </p>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <DialogButton onClick={onClose}>Cancel</DialogButton>
            <DialogButton tone="primary" onClick={() => setPhase("fields")}>
              Continue
            </DialogButton>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-[length:var(--text-body-sm)] text-muted-foreground">
            All fields are optional. Enter either a full date of death or just a year, not both.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <MemorialField
              label="Date of death"
              type="date"
              value={dateOfDeath}
              onChange={setDateOfDeath}
              error={issueFor("dateOfDeath")}
              inputRef={firstFieldRef}
            />
            <MemorialField
              label="Death year (if the date is unknown)"
              type="number"
              value={deathYear}
              onChange={setDeathYear}
              error={issueFor("deathYear")}
            />
            <MemorialField
              label="Birth year"
              type="number"
              value={birthYear}
              onChange={setBirthYear}
              error={issueFor("birthYear")}
            />
            <div className="sm:col-span-2">
              <MemorialField
                label="Obituary link"
                type="url"
                value={obituaryUrl}
                onChange={setObituaryUrl}
                error={issueFor("obituaryUrl")}
              />
            </div>
            <div className="sm:col-span-2">
              <MemorialField
                label="PBE News tribute link"
                type="url"
                value={inMemoriamUrl}
                onChange={setInMemoriamUrl}
                error={issueFor("inMemoriamUrl")}
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <DialogButton onClick={onClose}>Cancel</DialogButton>
            <DialogButton tone="primary" onClick={submit} disabled={busy}>
              {alreadyDeceased ? "Save details" : "Mark as deceased"}
            </DialogButton>
          </div>
        </>
      )}
    </dialog>
  );
}

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-input bg-background px-3 py-2 text-[length:var(--text-body)] outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** One optional deceased-fact field: a label associated by `htmlFor`/`id` (the fields.tsx convention). */
function MemorialField({
  label,
  type,
  value,
  onChange,
  error,
  inputRef,
}: {
  label: string;
  type: "date" | "number" | "url";
  value: string;
  onChange: (value: string) => void;
  error?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[length:var(--text-label)] font-medium">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
      {error && (
        <span className="mt-1 block text-[length:var(--text-body-sm)] text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

/** A labelled control row in the staff panel: label + help text on the left, control on the right. */
function ControlRow({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 border-t border-border-hairline pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-6">
      <div className="min-w-0">
        <p className="text-[length:var(--text-label)] font-semibold">{label}</p>
        <p className="mt-0.5 text-[length:var(--text-body-sm)] text-muted-foreground">{help}</p>
      </div>
      <div className="sm:justify-self-end">{children}</div>
    </div>
  );
}

function SecondaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[var(--radius-md)] border border-input bg-card px-3 py-2 text-[length:var(--text-label)] font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function DialogButton({
  onClick,
  disabled,
  tone = "neutral",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "primary";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-[var(--radius-md)] px-4 py-2.5 text-[length:var(--text-label)] font-semibold outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        tone === "primary" ? "bg-primary text-primary-foreground" : "border border-input bg-card",
      )}
    >
      {children}
    </button>
  );
}
