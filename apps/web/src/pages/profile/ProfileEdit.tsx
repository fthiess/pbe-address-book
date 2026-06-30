import type { Profile, ValidationIssue } from "@pbe/shared";
import { useCallback, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import type { ProfileRecord } from "../../lib/types.js";
import { CourseChip } from "../directory/Chips.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ConsentSwitch } from "./ConsentSwitch.js";
import { ProfileHeadshot } from "./ProfileHeadshot.js";
import { CONSENT_COPY, PRIVACY_COPY } from "./consent.js";
import { addressLines, canonicalName, hasAddress } from "./display.js";
import { LockedField, ReadField, Section, TextAreaField, TextField } from "./fields.js";
import { useProfileDraft } from "./useProfileDraft.js";
import { useUnsavedGuard } from "./useUnsavedGuard.js";
import type { Viewer } from "./viewer.js";

/** The result the container reports back from a save attempt (§5.7.9). */
export type SubmitResult =
  | { status: "ok" }
  | { status: "stale"; changedFields: string[] }
  | { status: "invalid"; issues: ValidationIssue[] }
  | { status: "forbidden" }
  | { status: "error" };

/** Human-readable labels for the "changed underneath" reconcile notice (§5.7.9). */
const FIELD_LABELS: Partial<Record<string, string>> = {
  firstName: "First name",
  middleName: "Middle name",
  lastName: "Last name",
  fullLegalName: "Full name",
  mugName: "Mug name",
  classYear: "Class year",
  email: "Email",
  alternateEmail: "Alternate email",
  phone: "Telephone",
  address: "Mailing address",
  employerName: "Employer",
  jobTitle: "Job title",
  spousePartnerName: "Spouse / partner",
  majors: "Majors",
  bigBrotherId: "Big Brother",
  privacy: "Privacy settings",
  unlisted: "Directory listing",
  allowNewsletterEmail: "Newsletter preference",
  allowCommentReplyEmail: "Comment-reply preference",
  allowShareWithMITAA: "MITAA sharing",
  adminNote: "Admin note",
};

/**
 * The Profile page in **edit mode** (§5.7). A controlled form over the editing
 * draft: per-field inline validation (on blur, then all on Save), the PATCH-first
 * save with the 412 reconcile notice, and the unsaved-changes guard. The "special
 * controls" (majors chips, big-brother typeahead, country-driven state/province,
 * repeatable groups) and the headshot / verification / mark-deceased / admin
 * controls are the 4b and 4c passes; here those fields render **read-only** so the
 * form is complete and saveable without them.
 *
 * The unsaved-changes guard has two layers (D43, OFC-65): `useUnsavedGuard` arms
 * `beforeunload` for browser-level exits (reload, tab close, a typed URL), and
 * `useBlocker` catches every in-app navigation while the form is dirty — Back, the
 * masthead links, Cancel — funnelling them through one "Discard changes?" dialog.
 * A deliberate Save bypasses the blocker (a ref flipped before it navigates) so it
 * never prompts the user about their own save.
 */
export function ProfileEdit({
  record,
  viewer,
  submit,
  showToast,
  exitEdit,
}: {
  record: ProfileRecord;
  viewer: Viewer;
  submit: (patch: Partial<Profile>) => Promise<SubmitResult>;
  showToast: (message: string) => void;
  exitEdit: () => void;
}) {
  const form = useProfileDraft(record, viewer);
  useUnsavedGuard(form.dirty);

  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [reconcile, setReconcile] = useState<string[] | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Block in-app navigation away from a dirty form. A successful Save flips
  // `bypass` first so the blocker waves its own exit through without a prompt.
  const bypass = useRef(false);
  const blocker = useBlocker(useCallback(() => form.dirty && !bypass.current, [form.dirty]));

  const consentLocked = !(viewer.isOwner || viewer.role === "admin");
  const isStaff = viewer.role === "manager" || viewer.role === "admin";
  const emailPresent = (form.draft.email ?? "").trim() !== "";
  const name = canonicalName(record);

  function focusFirstInvalid() {
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  }

  async function onSave() {
    setBanner(null);
    const firstInvalid = form.revealAll();
    if (firstInvalid) {
      focusFirstInvalid();
      return;
    }
    setSaving(true);
    try {
      const result = await submit(form.patch());
      if (result.status === "ok") {
        showToast(viewer.isOwner ? "Saved — verified as of today." : "Saved.");
        bypass.current = true;
        exitEdit();
        return;
      }
      if (result.status === "stale") {
        setReconcile(result.changedFields);
      } else if (result.status === "invalid") {
        form.applyServerIssues(result.issues);
        focusFirstInvalid();
      } else if (result.status === "forbidden") {
        setBanner("Your role may not change one or more of these fields.");
      } else {
        setBanner("We couldn't save your changes just now. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  // Cancel is just another exit: when the form is dirty the blocker intercepts it
  // and raises the same "Discard changes?" dialog as Back; when clean it leaves at
  // once. (No separate confirm path — one dialog for every dirty exit.)
  function onCancelClick() {
    exitEdit();
  }

  return (
    <article className="mx-auto max-w-5xl">
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void onSave();
        }}
        className="overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card shadow-[var(--shadow-card)]"
      >
        {/* Sticky action bar (§5.7) — EDITING marker + Cancel / Save changes. */}
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/95 px-6 py-3 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3">
            <span className="rounded-[var(--radius-sm)] bg-[var(--chip-teal-bg)] px-2 py-0.5 text-[length:var(--text-caption)] font-bold uppercase tracking-wide text-[var(--primary-emphasis)]">
              Editing
            </span>
            <span className="font-semibold">{name}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancelClick}
              className="rounded-[var(--radius-md)] border border-input bg-card px-4 py-2.5 text-[length:var(--text-label)] font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-[var(--radius-md)] bg-primary px-4 py-2.5 text-[length:var(--text-label)] font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        {(reconcile || banner) && (
          <div className="px-6 pt-4 sm:px-8">
            {reconcile && <ReconcileNotice fields={reconcile} />}
            {banner && (
              <p
                role="alert"
                className="rounded-[var(--radius-lg)] border border-[var(--destructive)] bg-card px-4 py-3 text-[length:var(--text-body)] text-destructive"
              >
                {banner}
              </p>
            )}
          </div>
        )}

        <div className="space-y-0 px-6 pb-6 sm:px-8">
          {/* Identity (full width). */}
          <div className="flex flex-wrap items-start gap-5 py-6">
            <div className="flex flex-col items-center gap-2">
              <ProfileHeadshot record={record} name={name} />
              <p className="max-w-[120px] text-center text-[length:var(--text-body-sm)] text-muted-foreground">
                Photo editing arrives soon.
              </p>
            </div>
            <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
              <TextField
                id="profile-firstName"
                label="First name"
                value={form.draft.firstName ?? ""}
                onChange={(v) => form.setText("firstName", v)}
                onBlur={() => form.touch("firstName")}
                error={form.errorFor("firstName")}
                autoComplete="given-name"
              />
              <TextField
                id="profile-lastName"
                label="Last name"
                value={form.draft.lastName ?? ""}
                onChange={(v) => form.setText("lastName", v)}
                onBlur={() => form.touch("lastName")}
                error={form.errorFor("lastName")}
                autoComplete="family-name"
              />
              <TextField
                id="profile-middleName"
                label="Middle name"
                value={form.draft.middleName ?? ""}
                onChange={(v) => form.setText("middleName", v)}
                onBlur={() => form.touch("middleName")}
                error={form.errorFor("middleName")}
              />
              <TextField
                id="profile-fullLegalName"
                label="Full name"
                value={form.draft.fullLegalName ?? ""}
                onChange={(v) => form.setText("fullLegalName", v)}
                onBlur={() => form.touch("fullLegalName")}
                error={form.errorFor("fullLegalName")}
                helper="Including suffixes (Jr., III) and any compound name."
              />
              <TextField
                id="profile-classYear"
                label="Class year"
                value={form.classYearText}
                onChange={form.setClassYear}
                onBlur={() => form.touch("classYear")}
                error={form.errorFor("classYear")}
                inputMode="numeric"
                mono
                placeholder="YYYY"
                helper="A 4-digit year, or “unknown”."
              />
              <TextField
                id="profile-mugName"
                label="Mug name"
                value={form.draft.mugName ?? ""}
                onChange={(v) => form.setText("mugName", v)}
                onBlur={() => form.touch("mugName")}
                error={form.errorFor("mugName")}
                helper="The nickname printed on your PBE mug."
              />
              <div className="sm:col-span-2">
                <LockedField
                  label="Constitution ID"
                  value={`#${record.id}`}
                  note="assigned, read-only"
                />
              </div>
            </div>
          </div>

          {/* Contact ‖ Emergency. */}
          <EditRow>
            <Section title="Contact">
              <TextField
                id="profile-email"
                label="Email"
                type="email"
                value={form.draft.email ?? ""}
                onChange={(v) => form.setText("email", v)}
                onBlur={() => form.touch("email")}
                error={form.errorFor("email")}
                inputMode="email"
                autoComplete="email"
              />
              <TextField
                id="profile-alternateEmail"
                label="Alternate email"
                type="email"
                value={form.draft.alternateEmail ?? ""}
                onChange={(v) => form.setText("alternateEmail", v)}
                onBlur={() => form.touch("alternateEmail")}
                error={form.errorFor("alternateEmail")}
                inputMode="email"
                disabled={!emailPresent}
                helper={
                  emailPresent
                    ? "Optional — a second address we can reach you at."
                    : "Add a primary email first to set an alternate."
                }
              />
              <TextField
                id="profile-phone"
                label="Telephone"
                type="tel"
                value={form.draft.phone ?? ""}
                onChange={(v) => form.setText("phone", v)}
                onBlur={() => form.touch("phone")}
                error={form.errorFor("phone")}
                inputMode="tel"
                autoComplete="tel"
              />
              {hasAddress(form.draft.address) && (
                <ReadField label="Mailing address">
                  {addressLines(form.draft.address).map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </ReadField>
              )}
            </Section>

            <Section title="Emergency contacts">
              {(form.draft.emergencyContacts ?? []).map((contact, i) => (
                <ReadField
                  key={`${contact.name ?? ""}-${i}`}
                  label={i === 0 ? "Primary" : "Secondary"}
                >
                  {[contact.name, contact.phone, contact.email].filter(Boolean).join("  ·  ")}
                </ReadField>
              ))}
              <ConsentSwitch
                copy={PRIVACY_COPY.shareEmergency}
                value={form.draft.privacy?.shareEmergency ?? false}
                onChange={(v) => form.setPrivacy("shareEmergency", v)}
                locked={consentLocked}
              />
            </Section>
          </EditRow>

          {/* Professional ‖ Relationships. */}
          <EditRow>
            <Section title="Professional &amp; personal">
              <TextField
                id="profile-employerName"
                label="Employer"
                value={form.draft.employerName ?? ""}
                onChange={(v) => form.setText("employerName", v)}
                onBlur={() => form.touch("employerName")}
                error={form.errorFor("employerName")}
                autoComplete="organization"
              />
              <TextField
                id="profile-jobTitle"
                label="Job title"
                value={form.draft.jobTitle ?? ""}
                onChange={(v) => form.setText("jobTitle", v)}
                onBlur={() => form.touch("jobTitle")}
                error={form.errorFor("jobTitle")}
                autoComplete="organization-title"
              />
              <div>
                <TextField
                  id="profile-spousePartnerName"
                  label="Spouse / partner"
                  value={form.draft.spousePartnerName ?? ""}
                  onChange={(v) => form.setText("spousePartnerName", v)}
                  onBlur={() => form.touch("spousePartnerName")}
                  error={form.errorFor("spousePartnerName")}
                />
                <div className="mt-2">
                  <ConsentSwitch
                    copy={PRIVACY_COPY.shareSpousePartner}
                    value={form.draft.privacy?.shareSpousePartner ?? false}
                    onChange={(v) => form.setPrivacy("shareSpousePartner", v)}
                    locked={consentLocked}
                  />
                </div>
              </div>
              {form.draft.majors && form.draft.majors.length > 0 && (
                <ReadField label="Majors">
                  <ul className="flex flex-wrap gap-1.5">
                    {form.draft.majors.map((code) => (
                      <li key={code}>
                        <CourseChip code={code} />
                      </li>
                    ))}
                  </ul>
                </ReadField>
              )}
            </Section>

            {form.draft.bigBrotherId != null ? (
              <Section title="Relationships">
                <ReadField label="Big Brother">Set in this brother's profile.</ReadField>
              </Section>
            ) : (
              <div />
            )}
          </EditRow>

          {/* Preferences & consent ‖ Record status (restricted). */}
          <EditRow>
            <Section title="Privacy &amp; consent" locked={consentLocked}>
              <p className="text-[length:var(--text-body-sm)] text-muted-foreground">
                Each switch shows what's true now; the <strong>?</strong> says what changes if you
                flip it.
              </p>
              <div className="space-y-3">
                <ConsentSwitch
                  copy={PRIVACY_COPY.shareEmail}
                  value={form.draft.privacy?.shareEmail ?? false}
                  onChange={(v) => form.setPrivacy("shareEmail", v)}
                  locked={consentLocked}
                />
                <ConsentSwitch
                  copy={PRIVACY_COPY.shareAddress}
                  value={form.draft.privacy?.shareAddress ?? false}
                  onChange={(v) => form.setPrivacy("shareAddress", v)}
                  locked={consentLocked}
                />
                <ConsentSwitch
                  copy={PRIVACY_COPY.sharePhone}
                  value={form.draft.privacy?.sharePhone ?? false}
                  onChange={(v) => form.setPrivacy("sharePhone", v)}
                  locked={consentLocked}
                />
              </div>

              <Subgroup title="Sharing beyond the brotherhood" warn>
                <ConsentSwitch
                  copy={CONSENT_COPY.allowShareWithMITAA}
                  value={form.draft.allowShareWithMITAA ?? false}
                  onChange={(v) => form.setBool("allowShareWithMITAA", v)}
                  locked={consentLocked}
                />
              </Subgroup>

              <Subgroup title="Emails from PBE News">
                <ConsentSwitch
                  copy={CONSENT_COPY.allowNewsletterEmail}
                  value={form.draft.allowNewsletterEmail ?? false}
                  onChange={(v) => form.setBool("allowNewsletterEmail", v)}
                  locked={consentLocked}
                />
                <ConsentSwitch
                  copy={CONSENT_COPY.allowCommentReplyEmail}
                  value={form.draft.allowCommentReplyEmail ?? false}
                  onChange={(v) => form.setBool("allowCommentReplyEmail", v)}
                  locked={consentLocked}
                />
              </Subgroup>

              <Subgroup title="Directory listing">
                <ConsentSwitch
                  copy={CONSENT_COPY.unlisted}
                  value={form.draft.unlisted ?? false}
                  onChange={(v) => form.setBool("unlisted", v)}
                  locked={consentLocked}
                />
              </Subgroup>
            </Section>

            <Section title="Record status">
              {form.draft.lastVerifiedDate ? (
                <ReadField label="Verification">Verified {form.draft.lastVerifiedDate}.</ReadField>
              ) : (
                <ReadField label="Verification">Not verified.</ReadField>
              )}
              <p className="text-[length:var(--text-body-sm)] text-muted-foreground">
                {viewer.isOwner
                  ? "Saving your changes re-verifies your record as of today."
                  : "Saving content changes marks the record unverified until re-confirmed."}
              </p>
              {isStaff && (
                <TextAreaField
                  id="profile-adminNote"
                  label="Admin note (staff only)"
                  value={form.draft.adminNote ?? ""}
                  onChange={(v) => form.setText("adminNote", v)}
                  onBlur={() => form.touch("adminNote")}
                  error={form.errorFor("adminNote")}
                  helper="Visible to managers and administrators only — never to the brother."
                />
              )}
            </Section>
          </EditRow>
        </div>
      </form>

      {blocker.state === "blocked" && (
        <ConfirmDialog
          title="Discard your changes?"
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          tone="destructive"
          onConfirm={() => blocker.proceed?.()}
          onCancel={() => blocker.reset?.()}
        >
          You have unsaved edits on this profile. Discarding will lose them.
        </ConfirmDialog>
      )}
    </article>
  );
}

/** A two-up edit row, mirroring the view layout (DOM order = reading order, §5.7.1). */
function EditRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-x-12 gap-y-8 border-t border-border-hairline py-6 md:grid-cols-2">
      {children}
    </div>
  );
}

/** A labelled sub-group inside the consent panel (§5.7.3). */
function Subgroup({
  title,
  warn = false,
  children,
}: {
  title: string;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-muted/40 p-3">
      <p
        className={
          warn
            ? "mb-2 flex items-center gap-1.5 text-[length:var(--text-label-up)] font-bold uppercase tracking-wide text-[var(--gold-text-strong)]"
            : "mb-2 text-[length:var(--text-label-up)] font-bold uppercase tracking-wide text-muted-foreground"
        }
      >
        {warn && <span aria-hidden="true">⚠</span>}
        {title}
      </p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** The 412 "changed while you were editing" notice (§5.7.9) — never a clobber. */
function ReconcileNotice({ fields }: { fields: string[] }) {
  const labels = fields.map((field) => FIELD_LABELS[field] ?? field);
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-lg)] border border-[var(--gold-border)] bg-[var(--gold-bg-2)] px-4 py-3 text-[length:var(--text-body)] text-[var(--gold-text-strong)]"
    >
      <p className="font-semibold">This profile was changed while you were editing.</p>
      <p className="mt-1">
        Your edits are kept. {labels.length > 0 && <>Changed underneath: {labels.join(", ")}. </>}
        Review and save again to apply your changes.
      </p>
    </div>
  );
}
