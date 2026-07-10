import { type Profile, firstIssueByField, validateProfile } from "@pbe/shared";
import { useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";
import { createProfile } from "../lib/api.js";
import { Section, TextField } from "./profile/fields.js";

/** Shared styling for the "← Directory" affordance, matching the Admin page. */
const BACK_CLASS =
  "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] text-[length:var(--text-label)] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The **Add Brother** page (`/brother/new`; OFC-201) — the small first step of the
 * two-step create (DECISIONS N71). It collects only the **identity essentials**
 * every new brother needs to exist and to be joined to Ghost — the Constitution
 * signer number, name, class year, and email — then `POST`s them (which creates the
 * Ghost member and the record server-side) and hands the admin straight to the
 * **regular profile edit page** to fill in everything else at their leisure. There
 * is deliberately no bespoke create form: once the record exists, editing it is the
 * ordinary edit path, nothing new to maintain.
 *
 * Admin-only. The server enforces admin on `POST /api/profiles`; this route guard
 * is UX (a non-admin — or an admin "viewing as" a lower role, N31 — is redirected).
 */
export function NewProfile() {
  const { state } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [idText, setIdText] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [classYearText, setClassYearText] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (state.status !== "authenticated" || state.me.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  const fromDirectory = (location.state as { fromDirectory?: boolean } | null)?.fromDirectory;

  /** Clear one field's error as the admin edits it (so a fixed field stops shouting). */
  const clearError = (field: string) =>
    setErrors((prev) => {
      if (!(field in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });

  /**
   * Validate the essentials. The name / class-year / email-format rules come from
   * the **shared** validator (D50) so they cannot drift from the server's; the one
   * extra rule is a positive-integer id. **Email is optional** (OFC-201 follow-up):
   * Book is the membership record, not gated on having an email — a brother with no
   * email is created Book-only, with no Ghost record (C15/D20). When an email *is*
   * entered it must be well-formed (the shared validator checks that).
   */
  function validate(): Record<string, string> {
    const currentYear = new Date().getUTCFullYear();
    const id = Number(idText.trim());
    const classYear = classYearText.trim() === "" ? Number.NaN : Number(classYearText.trim());
    const candidate = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      classYear,
      email: email.trim() || undefined,
    } as unknown as Profile;

    const found = firstIssueByField(
      validateProfile(candidate, { currentYear, requireRequired: true }).issues,
    );
    if (idText.trim() === "" || !Number.isInteger(id) || id <= 0) {
      found.id = "Enter the brother's Constitution signer number (a positive whole number).";
    }
    return found;
  }

  function focusFirstInvalid() {
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBanner(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalid();
      return;
    }

    const id = Number(idText.trim());
    setSaving(true);
    try {
      const outcome = await createProfile({
        id,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        classYear: Number(classYearText.trim()),
        // Omit email entirely when blank so the server creates a Book-only record
        // (no Ghost member) rather than storing an empty string.
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      if (outcome.status === "ok") {
        // Hand straight off to the regular edit page for the optional rest, replacing
        // this step so Back returns to the Directory rather than the create form. When
        // we came from the Directory, carry the directory-return marker (delta 1 — the
        // Directory sits exactly one push back, and both this and the later edit→view
        // replace keep it there) so the eventual "← Directory" restores the Directory's
        // search/filter/sort rather than opening a fresh, cleared one (OFC-233).
        navigate(`/brother/${id}/edit`, {
          replace: true,
          state: fromDirectory ? { fromDirectory: true, directoryDelta: 1 } : undefined,
        });
        return;
      }
      if (outcome.status === "conflict") {
        setErrors({ id: "A brother with that Constitution id already exists." });
        focusFirstInvalid();
      } else if (outcome.status === "invalid") {
        setErrors(firstIssueByField(outcome.issues));
        focusFirstInvalid();
      } else if (outcome.status === "forbidden") {
        setBanner("Only administrators may add a brother.");
      }
    } catch {
      setBanner("We couldn't add this brother just now. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {fromDirectory ? (
        <button type="button" onClick={() => navigate(-1)} className={BACK_CLASS}>
          <span aria-hidden="true">←</span> Directory
        </button>
      ) : (
        <Link to="/" className={BACK_CLASS}>
          <span aria-hidden="true">←</span> Directory
        </Link>
      )}
      <header className="mt-4 mb-6">
        <h1 className="text-[length:var(--text-display)] font-bold tracking-tight">Add Brother</h1>
        <p className="mt-2 max-w-prose text-[length:var(--text-body)] text-muted-foreground">
          Enter the essentials to create the brother. The signer number, name, and class year are
          required; <strong>email is optional</strong> — add it if you have one. Once the record is
          created, you'll be taken to the full profile page to optionally add other details —
          address, telephone, photo, privacy preferences, and more.
        </p>
      </header>

      <form
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        className="rounded-[var(--radius-2xl)] border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8"
      >
        {banner && (
          <p
            role="alert"
            className="mb-4 rounded-[var(--radius-lg)] border border-[var(--destructive)] bg-card px-4 py-3 text-[length:var(--text-body)] text-destructive"
          >
            {banner}
          </p>
        )}

        <Section title="Essentials">
          <TextField
            id="new-constitutionId"
            label="Constitution signer number"
            value={idText}
            onChange={(v) => {
              setIdText(v);
              clearError("id");
            }}
            error={errors.id}
            inputMode="numeric"
            mono
            placeholder="e.g. 5248"
            helper="The brother's physical Constitution signature number."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="new-firstName"
              label="First name"
              value={firstName}
              onChange={(v) => {
                setFirstName(v);
                clearError("firstName");
              }}
              error={errors.firstName}
              autoComplete="off"
            />
            <TextField
              id="new-lastName"
              label="Last name"
              value={lastName}
              onChange={(v) => {
                setLastName(v);
                clearError("lastName");
              }}
              error={errors.lastName}
              autoComplete="off"
            />
          </div>
          <TextField
            id="new-classYear"
            label="Class year"
            value={classYearText}
            onChange={(v) => {
              setClassYearText(v);
              clearError("classYear");
            }}
            error={errors.classYear}
            inputMode="numeric"
            mono
            placeholder="YYYY"
            helper="A 4-digit year."
          />
          <TextField
            id="new-email"
            label="Email (optional)"
            type="email"
            value={email}
            onChange={(v) => {
              setEmail(v);
              clearError("email");
            }}
            error={errors.email}
            inputMode="email"
            autoComplete="off"
            helper="If provided, sets up the brother's sign-in and PBE News subscription. Leave blank for a brother with no email."
          />
        </Section>

        <div className="mt-6 flex items-center justify-end gap-3">
          <Link
            to="/"
            className="rounded-[var(--radius-md)] border border-input bg-card px-4 py-2.5 text-[length:var(--text-label)] font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="rounded-[var(--radius-md)] bg-primary px-4 py-2.5 text-[length:var(--text-label)] font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create brother"}
          </button>
        </div>
      </form>
    </div>
  );
}
