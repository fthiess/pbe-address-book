import { type EmergencyContact, formatClassYear, formatConstitutionId } from "@pbe/shared";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { DirectoryProfile, ProfileRecord } from "../../lib/types.js";
import { CourseChip } from "../directory/Chips.js";
import { ProfileHeadshot } from "./ProfileHeadshot.js";
import { CONSENT_COPY, PRIVACY_COPY, activeConsequence } from "./consent.js";
import {
  addressLines,
  canonicalName,
  formatFullDate,
  hasAddress,
  lifespanLine,
} from "./display.js";
import { PrivateMarker, ReadField, Section } from "./fields.js";
import { littleBrothers, rosterNames } from "./relationships.js";
import { type Viewer, canEdit, managerSeesPrivate, seesRestricted } from "./viewer.js";

/**
 * The Profile page in **view mode** (§5.7): one layout, four projections. What
 * arrives is already role-projected by the server (D5/D82), so a field a caller
 * may not see is simply absent — this component only decides *presentation*:
 * value, the manager "private" marker, or nothing. The restricted block
 * (preferences/consent + record status) renders only for the owner, managers, and
 * admins; a deceased record opens with the In Memoriam treatment (§5.7.7).
 */
export function ProfileView({
  record,
  viewer,
  roster,
  onBackToDirectory,
}: {
  record: ProfileRecord;
  viewer: Viewer;
  roster: DirectoryProfile[] | null;
  onBackToDirectory: () => void;
}) {
  const name = canonicalName(record);
  const deceased = record.deceased?.isDeceased === true;
  const restricted = seesRestricted(viewer);

  return (
    <article className="mx-auto max-w-5xl">
      <button
        type="button"
        onClick={onBackToDirectory}
        className="mb-3 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-1 py-1 text-[length:var(--text-label)] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true">←</span> Directory
      </button>
      <div className="overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card shadow-[var(--shadow-card)]">
        {deceased && <MemorialBanner />}

        <IdentityHeader record={record} name={name} viewer={viewer} deceased={deceased} />

        <div className="space-y-0 px-6 pb-6 sm:px-8">
          {deceased && <MemorialDetails record={record} />}

          <Row>
            <ContactSection record={record} viewer={viewer} />
            <EmergencySection record={record} viewer={viewer} />
          </Row>

          <Row>
            <ProfessionalSection record={record} viewer={viewer} />
            <RelationshipsSection record={record} roster={roster} />
          </Row>

          {restricted && (
            <Row>
              <PreferencesSection record={record} />
              <RecordStatusSection record={record} viewer={viewer} />
            </Row>
          )}
        </div>
      </div>
    </article>
  );
}

/** A two-up section row: paired at `md`+, single-column below, DOM order = reading order (§5.7.1). */
function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-x-12 gap-y-8 border-t border-border-hairline py-6 first:border-t-0 md:grid-cols-2">
      {children}
    </div>
  );
}

function IdentityHeader({
  record,
  name,
  viewer,
  deceased,
}: {
  record: ProfileRecord;
  name: string;
  viewer: Viewer;
  deceased: boolean;
}) {
  const lifespan = deceased && record.deceased ? lifespanLine(record.deceased) : null;
  return (
    <header className="flex flex-wrap items-start gap-5 px-6 pt-6 sm:px-8">
      <ProfileHeadshot record={record} name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="text-[length:var(--text-h1)] font-bold leading-tight tracking-tight">
            {record.firstName} {record.lastName}
          </h1>
          {record.classYear != null && (
            <span className="text-[length:var(--text-h3)] font-semibold text-muted-foreground">
              {formatClassYear(record.classYear)}
            </span>
          )}
        </div>
        {lifespan && (
          <p className="mt-0.5 whitespace-nowrap text-lg text-[var(--memorial-fg)]">{lifespan}</p>
        )}
        <p className="mt-1 text-[length:var(--text-body-sm)] text-muted-foreground">
          {[
            formatConstitutionId(record.id),
            record.classYear != null ? `Class of ${record.classYear}` : null,
            record.fullLegalName,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </p>
        {record.majors && record.majors.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Courses">
            {record.majors.map((code) => (
              <li key={code}>
                <CourseChip code={code} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {canEdit(viewer) && !deceased && (
        <Link
          to={`/brother/${record.id}/edit`}
          state={{ fromProfile: true }}
          className="shrink-0 rounded-[var(--radius-md)] bg-primary px-4 py-2.5 text-[length:var(--text-label)] font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Edit profile
        </Link>
      )}
    </header>
  );
}

/** The respectful In Memoriam band across the top of a deceased record (§5.7.7). */
function MemorialBanner() {
  return (
    <div
      className="px-6 py-7 text-center sm:px-8"
      style={{
        background: "linear-gradient(180deg, var(--memorial-bg-from), var(--memorial-bg-to))",
        borderBottom: "1px solid var(--memorial-border)",
      }}
    >
      <p
        className="text-[length:var(--text-display)] leading-none text-[var(--memorial-fg)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        In Memoriam
      </p>
    </div>
  );
}

function ContactSection({ record, viewer }: { record: ProfileRecord; viewer: Viewer }) {
  const showEmail = managerSeesPrivate(record, viewer, "shareEmail");
  const showPhone = managerSeesPrivate(record, viewer, "sharePhone");
  const showAddress = managerSeesPrivate(record, viewer, "shareAddress");
  return (
    <Section title="Contact">
      {record.email ? (
        <ReadField label="Email">{record.email}</ReadField>
      ) : (
        showEmail && <PrivateMarker label="Email" />
      )}
      {record.alternateEmail && (
        <ReadField label="Alternate email">{record.alternateEmail}</ReadField>
      )}
      {record.phone ? (
        <ReadField label="Telephone">{record.phone}</ReadField>
      ) : (
        showPhone && <PrivateMarker label="Telephone" />
      )}
      {hasAddress(record.address) ? (
        <ReadField label="Mailing address">
          {addressLines(record.address).map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </ReadField>
      ) : (
        showAddress && <PrivateMarker label="Mailing address" />
      )}
    </Section>
  );
}

function EmergencySection({ record, viewer }: { record: ProfileRecord; viewer: Viewer }) {
  const contacts = record.emergencyContacts ?? [];
  const isPrivate = managerSeesPrivate(record, viewer, "shareEmergency");
  if (contacts.length === 0 && !isPrivate) {
    return null;
  }
  return (
    <Section title="Emergency contacts">
      {contacts.map((contact, i) => (
        <ReadField key={emergencyKey(contact, i)} label={i === 0 ? "Primary" : "Secondary"}>
          {[contact.name, contact.phone, contact.email].filter(Boolean).join("  ·  ")}
        </ReadField>
      ))}
      {isPrivate && <PrivateMarker label="Emergency contacts" />}
    </Section>
  );
}

function emergencyKey(contact: EmergencyContact, index: number): string {
  return `${contact.name ?? ""}-${contact.phone ?? ""}-${index}`;
}

function ProfessionalSection({ record, viewer }: { record: ProfileRecord; viewer: Viewer }) {
  const employer = [record.employerName, record.jobTitle].filter(Boolean).join(" — ");
  const showSpouse = managerSeesPrivate(record, viewer, "shareSpousePartner");
  return (
    <Section title="Professional &amp; personal">
      {employer && <ReadField label="Employer">{employer}</ReadField>}
      {record.spousePartnerName ? (
        <ReadField label="Spouse / partner">{record.spousePartnerName}</ReadField>
      ) : (
        showSpouse && <PrivateMarker label="Spouse / partner" />
      )}
      {record.majors && record.majors.length > 0 && (
        <ReadField label="Majors">
          <ul className="flex flex-wrap gap-1.5">
            {record.majors.map((code) => (
              <li key={code}>
                <CourseChip code={code} />
              </li>
            ))}
          </ul>
        </ReadField>
      )}
      {record.links && record.links.length > 0 && (
        <ReadField label="Links">
          <ul className="space-y-1">
            {record.links.map((link) => (
              <li key={`${link.label}-${link.url}`}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--primary-emphasis)] underline-offset-2 hover:underline"
                >
                  {link.label || link.url}
                </a>
              </li>
            ))}
          </ul>
        </ReadField>
      )}
    </Section>
  );
}

/**
 * Relationships (§5.7.4). The Big Brother link carries his Canonical Name (from
 * the roster once it loads, falling back to a neutral link meanwhile), and the
 * **derived Little Brothers** — the brothers who name this one as their Big
 * Brother — render read-only beneath, each a link. Both are free reads of the
 * in-memory dataset; nothing here is stored. The section is absent when there is
 * neither a Big Brother nor any Little Brother.
 */
function RelationshipsSection({
  record,
  roster,
}: {
  record: ProfileRecord;
  roster: DirectoryProfile[] | null;
}) {
  const names = useMemo(() => (roster ? rosterNames(roster) : null), [roster]);
  const littles = useMemo(
    () => (roster && names ? littleBrothers(roster, names, record.id) : []),
    [roster, names, record.id],
  );

  if (record.bigBrotherId == null && littles.length === 0) {
    return null;
  }

  const bigBrotherName =
    record.bigBrotherId != null ? (names?.get(record.bigBrotherId) ?? null) : null;

  return (
    <Section title="Relationships">
      {record.bigBrotherId != null && (
        <ReadField label="Big Brother">
          <Link
            to={`/brother/${record.bigBrotherId}`}
            className="font-medium text-[var(--primary-emphasis)] underline-offset-2 hover:underline"
          >
            {bigBrotherName ?? "View his profile"}
          </Link>
        </ReadField>
      )}
      {littles.length > 0 && (
        <ReadField label="Little Brothers">
          <ul className="flex flex-wrap gap-1.5">
            {littles.map((little) => (
              <li key={little.id}>
                <Link
                  to={`/brother/${little.id}`}
                  className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-[length:var(--text-body-sm)] text-foreground underline-offset-2 hover:underline"
                >
                  {little.name}
                </Link>
              </li>
            ))}
          </ul>
        </ReadField>
      )}
    </Section>
  );
}

function PreferencesSection({ record }: { record: ProfileRecord }) {
  // A calm digest of the consents the viewer can see — a filled dot for an active
  // consent, a hollow ring for an inactive one (meaning carried by shape + text,
  // never colour alone, D32).
  const lines: { on: boolean; text: string }[] = [];
  if (record.privacy) {
    lines.push({
      on: record.privacy.shareEmail,
      text: activeConsequence(PRIVACY_COPY.shareEmail, record.privacy.shareEmail),
    });
    lines.push({
      on: record.privacy.sharePhone,
      text: activeConsequence(PRIVACY_COPY.sharePhone, record.privacy.sharePhone),
    });
    lines.push({
      on: record.privacy.shareAddress,
      text: activeConsequence(PRIVACY_COPY.shareAddress, record.privacy.shareAddress),
    });
  }
  if (record.allowNewsletterEmail !== undefined) {
    lines.push({
      on: record.allowNewsletterEmail,
      text: activeConsequence(CONSENT_COPY.allowNewsletterEmail, record.allowNewsletterEmail),
    });
  }
  if (record.allowShareWithMITAA !== undefined) {
    lines.push({
      on: record.allowShareWithMITAA,
      text: activeConsequence(CONSENT_COPY.allowShareWithMITAA, record.allowShareWithMITAA),
    });
  }
  if (record.unlisted) {
    lines.push({ on: true, text: activeConsequence(CONSENT_COPY.unlisted, true) });
  }

  return (
    <Section title="Preferences &amp; consent">
      <ul className="space-y-2">
        {lines.map((line) => (
          <li key={line.text} className="flex items-start gap-2.5 text-[length:var(--text-body)]">
            <span
              aria-hidden="true"
              className={
                line.on
                  ? "mt-1.5 size-2 shrink-0 rounded-full bg-[var(--success)]"
                  : "mt-1.5 size-2 shrink-0 rounded-full border border-[var(--track)]"
              }
            />
            <span className={line.on ? "text-foreground" : "text-muted-foreground"}>
              {line.text}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Record status (§5.7.6): the verification read-out, plus the staff-internal
 * Admin Note for managers/admins. The Verify button and the edit↔verification
 * coupling are the 4c verification pass; here the status is read-only.
 */
function RecordStatusSection({ record, viewer }: { record: ProfileRecord; viewer: Viewer }) {
  const verified = record.lastVerifiedDate;
  const selfVerified = record.verifiedBy != null && record.verifiedBy === record.id;
  return (
    <Section title="Record status">
      {verified ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--success-border)] bg-[var(--success-bg)] px-4 py-3">
          <p className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--success-strong)]">
            <span aria-hidden="true">✓</span>
            <span>
              Verified {verified}
              {selfVerified && " (self)"}
            </span>
          </p>
        </div>
      ) : (
        <ReadField label="Verification">Not verified.</ReadField>
      )}
      {record.lastModified && (
        <p className="text-[length:var(--text-body-sm)] text-muted-foreground">
          Last updated {record.lastModified.slice(0, 10)}.
        </p>
      )}
      {(viewer.role === "manager" || viewer.role === "admin") && record.adminNote && (
        <ReadField label="Admin note (staff only)">
          <span className="whitespace-pre-wrap">{record.adminNote}</span>
        </ReadField>
      )}
    </Section>
  );
}

/**
 * The public deceased detail fields (§5.7.7) — date of death, obituary link, and
 * PBE News tribute link. Public-class, so **every** brother sees them on a
 * memorial record; rendered full-width below the In Memoriam banner. The two URLs
 * carry the same `noopener noreferrer` hardening as profile links (D107).
 */
function MemorialDetails({ record }: { record: ProfileRecord }) {
  const deceased = record.deceased;
  if (!deceased) {
    return null;
  }
  const items: React.ReactNode[] = [];
  if (deceased.dateOfDeath) {
    items.push(
      <ReadField key="dod" label="Date of death">
        {formatFullDate(deceased.dateOfDeath)}
      </ReadField>,
    );
  }
  if (deceased.obituaryUrl) {
    items.push(
      <ReadField key="obit" label="Obituary">
        <MemorialLink href={deceased.obituaryUrl}>Read the obituary →</MemorialLink>
      </ReadField>,
    );
  }
  if (deceased.inMemoriamUrl) {
    items.push(
      <ReadField key="imm" label="PBE News tribute">
        <MemorialLink href={deceased.inMemoriamUrl}>Read on pbe400.org →</MemorialLink>
      </ReadField>,
    );
  }
  if (items.length === 0) {
    return null;
  }
  return <div className="grid gap-x-12 gap-y-4 py-6 sm:grid-cols-3">{items}</div>;
}

function MemorialLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--primary-emphasis)] underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}
