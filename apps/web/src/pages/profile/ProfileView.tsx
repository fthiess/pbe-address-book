import { type EmergencyContact, formatClassYear, formatConstitutionId } from "@pbe/shared";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../../components/Avatar.js";
import type { DirectoryProfile, ProfileRecord } from "../../lib/types.js";
import { CourseChip } from "../directory/Chips.js";
import { StarButton } from "../directory/RowControls.js";
import { useStars } from "../directory/StarsContext.js";
import { BOX, Thumbnail } from "../directory/thumbnail.js";
import { DirectoryNav } from "./DirectoryNav.js";
import { type ProfileActions, StaffControls, VerifyControl } from "./ProfileControls.js";
import { ProfileHeadshot } from "./ProfileHeadshot.js";
import { SWITCH_KEYS, activeConsequence, switchCopy } from "./consent.js";
import type { DirectoryNav as DirectoryNavModel, StepDirection } from "./directory-nav.js";
import {
  addressLines,
  canonicalName,
  formatFullDate,
  hasAddress,
  lifespanLine,
  verifierAttribution,
} from "./display.js";
import { PrivateMarker, ReadField, Section } from "./fields.js";
import { littleBrothers, rosterMember, rosterNames } from "./relationships.js";
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
  actions,
  onBackToDirectory,
  directoryNav,
  onPrev,
  onNext,
  autoFocusStep,
  onStepFocused,
}: {
  record: ProfileRecord;
  viewer: Viewer;
  roster: DirectoryProfile[] | null;
  actions: ProfileActions;
  onBackToDirectory: () => void;
  directoryNav: DirectoryNavModel;
  onPrev: () => void;
  onNext: () => void;
  autoFocusStep: StepDirection | null;
  onStepFocused: () => void;
}) {
  const name = canonicalName(record);
  const deceased = record.deceased?.isDeceased === true;
  const restricted = seesRestricted(viewer);
  // The roster→Canonical-Name map, resolved once and shared by the Relationships
  // links (Big/Little Brothers) and the verification read-out's verifier name
  // (§5.7.4; OFC-208). Null until the roster loads.
  const names = useMemo(() => (roster ? rosterNames(roster) : null), [roster]);

  return (
    <article className="mx-auto max-w-5xl">
      <DirectoryNav
        nav={directoryNav}
        onBack={onBackToDirectory}
        onPrev={onPrev}
        onNext={onNext}
        autoFocusStep={autoFocusStep}
        onStepFocused={onStepFocused}
      />
      <div className="overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card shadow-[var(--shadow-card)]">
        {deceased && <MemorialBanner />}

        <IdentityHeader record={record} name={name} viewer={viewer} deceased={deceased} />

        <div className="space-y-0 px-6 pb-6 sm:px-8">
          {deceased && <MemorialDetails record={record} />}

          <Row>
            <ContactSection record={record} viewer={viewer} />
            <EmergencySection record={record} viewer={viewer} />
          </Row>

          {/* Professional full width so spouse & courses sit to the right of the
              employer column (N35); Relationships follows full width. */}
          <div className="border-t border-border-hairline py-6">
            <ProfessionalSection record={record} viewer={viewer} />
          </div>
          <div className="border-t border-border-hairline py-6">
            <RelationshipsSection record={record} roster={roster} names={names} />
          </div>

          {restricted ? (
            <Row>
              {/* Preferences and the staff-only Administrative section stack in the
                  left column; Record status stays on the right (OFC-271). */}
              <div className="space-y-8">
                <PreferencesSection record={record} />
                <AdministrativeSection record={record} viewer={viewer} />
              </div>
              <RecordStatusSection
                record={record}
                viewer={viewer}
                onVerify={actions.verify}
                names={names}
              />
            </Row>
          ) : (
            // Verification is public (OFC-207): a brother viewing another brother
            // still sees the accuracy signal, without the staff-only record status.
            // Rendered in the two-up Row (single column) so the "Verified" badge is
            // the width of an Identity field, not full-bleed — collapsing to full
            // width below md like every other field (OFC-235).
            <Row>
              <Section title="Record status">
                <VerificationReadout record={record} names={names} />
              </Section>
            </Row>
          )}
        </div>
      </div>

      <StaffControls record={record} viewer={viewer} actions={actions} />
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
  const stars = useStars();
  return (
    <header className="flex flex-wrap items-start gap-5 px-6 pt-6 sm:px-8">
      <ProfileHeadshot record={record} name={name} responsive />
      <div className="min-w-0 flex-1">
        {/* Name + class year stay baseline-aligned together; the personal Star
            toggle sits to their right, centered against the name line (OFC-256).
            The star mirrors the Directory's — same shared set, same optimistic
            toggle — so it reflects here and there without a reload. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
          <StarButton
            starred={stars.isStarred(record.id)}
            name={name}
            onToggle={() => stars.toggle(record.id)}
            prominent
          />
        </div>
        {record.mugName && (
          <p className="mt-0.5 text-[length:var(--text-body)] italic text-muted-foreground">
            “{record.mugName}”
          </p>
        )}
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
      {canEdit(viewer) && (
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
      <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
        <div className="space-y-4">
          {employer && <ReadField label="Employer">{employer}</ReadField>}
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
        </div>
        <div className="space-y-4">
          {record.spousePartnerName ? (
            <ReadField label="Spouse / partner">{record.spousePartnerName}</ReadField>
          ) : (
            showSpouse && <PrivateMarker label="Spouse / partner" />
          )}
          {record.majors && record.majors.length > 0 && (
            <ReadField label="Courses">
              <ul className="flex flex-wrap gap-1.5">
                {record.majors.map((code) => (
                  <li key={code}>
                    <CourseChip code={code} />
                  </li>
                ))}
              </ul>
            </ReadField>
          )}
        </div>
      </div>
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
  names,
}: {
  record: ProfileRecord;
  roster: DirectoryProfile[] | null;
  names: Map<number, string> | null;
}) {
  const littles = useMemo(
    () => (roster && names ? littleBrothers(roster, names, record.id) : []),
    [roster, names, record.id],
  );

  if (record.bigBrotherId == null && littles.length === 0) {
    return null;
  }

  const bigBrotherId = record.bigBrotherId;
  const bigBrother = rosterMember(roster, bigBrotherId);
  const bigBrotherName = bigBrotherId != null ? (names?.get(bigBrotherId) ?? null) : null;

  return (
    <Section title="Relationships">
      {bigBrotherId != null && (
        <ReadField label="Big Brother">
          <RelationshipLink
            id={bigBrotherId}
            name={bigBrotherName ?? "View his profile"}
            profile={bigBrother}
          />
        </ReadField>
      )}
      {littles.length > 0 && (
        <ReadField label="Little Brothers">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {littles.map((little) => (
              <li key={little.id}>
                <RelationshipLink id={little.id} name={little.name} profile={little.profile} />
              </li>
            ))}
          </ul>
        </ReadField>
      )}
    </Section>
  );
}

/**
 * One brother in the Relationships section (§5.7.4; OFC-203): the Directory's
 * thumbnail (photo, or the initials/silhouette avatar, with the deceased/
 * de-brothered overlays) to the left of his Canonical Name, the whole thing a
 * link to his profile — so brother names read identically here and in the
 * Directory. The thumbnail is decorative (the adjacent name is the link's
 * accessible label). When the roster hasn't resolved the brother (a Big Brother
 * hidden from this viewer, or the roster still loading), it falls back to a plain
 * avatar seeded by his id.
 */
function RelationshipLink({
  id,
  name,
  profile,
}: {
  id: number;
  name: string;
  profile: DirectoryProfile | null;
}) {
  return (
    <Link
      to={`/brother/${id}`}
      className="group inline-flex items-center gap-2.5 rounded-[var(--radius-md)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {profile ? (
        <Thumbnail profile={profile} name={name} decorative />
      ) : (
        <Avatar name={name} seed={id} size={BOX} />
      )}
      <span className="font-medium text-foreground underline-offset-2 group-hover:underline">
        {name}
      </span>
    </Link>
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
      text: activeConsequence(switchCopy(SWITCH_KEYS.shareEmail), record.privacy.shareEmail),
    });
    lines.push({
      on: record.privacy.sharePhone,
      text: activeConsequence(switchCopy(SWITCH_KEYS.sharePhone), record.privacy.sharePhone),
    });
    lines.push({
      on: record.privacy.shareAddress,
      text: activeConsequence(switchCopy(SWITCH_KEYS.shareAddress), record.privacy.shareAddress),
    });
  }
  if (record.allowNewsletterEmail !== undefined) {
    lines.push({
      on: record.allowNewsletterEmail,
      text: activeConsequence(
        switchCopy(SWITCH_KEYS.allowNewsletterEmail),
        record.allowNewsletterEmail,
      ),
    });
  }
  if (record.allowShareWithMITAA !== undefined) {
    lines.push({
      on: record.allowShareWithMITAA,
      text: activeConsequence(
        switchCopy(SWITCH_KEYS.allowShareWithMITAA),
        record.allowShareWithMITAA,
      ),
    });
  }
  if (record.unlisted) {
    // Shown in the positive "Listed" framing (N35); an unlisted record is the
    // off-state — a hollow marker with the "you don't appear" consequence.
    lines.push({ on: false, text: activeConsequence(switchCopy(SWITCH_KEYS.listed), false) });
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
                  : // The hollow "off" ring borrows --muted-foreground (the same
                    // colour as its label text beside it) rather than --track, which
                    // on the white light-mode card fell to ~1.5:1 — near-invisible.
                    // --muted-foreground is the calibrated visible-muted tone in both
                    // themes, so this reads clearly in light and dark alike.
                    "mt-1.5 size-2 shrink-0 rounded-full border border-[var(--muted-foreground)]"
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
 * The verification read-out (§5.7.6) — **public to every brother** (OFC-207;
 * amends D28): a green "Verified {date}" badge, attributed to the verifier when
 * known. A self-confirm reads "(self)"; otherwise the verifier's Canonical Name
 * when the roster resolves it — managers/admins resolve every verifier, while a
 * brother sees date-only for a verifier hidden from his roster (OFC-208). An
 * unverified record reads plainly. The status is carried by shape + text, never
 * colour alone (D32) — the ✓ and the word "Verified".
 */
function VerificationReadout({
  record,
  names,
}: {
  record: ProfileRecord;
  names: Map<number, string> | null;
}) {
  const verified = record.lastVerifiedDate;
  if (!verified) {
    return <ReadField label="Verification">Not verified.</ReadField>;
  }
  const attribution = verifierAttribution(record.id, record.verifiedBy, names);
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--success-border)] bg-[var(--success-bg)] px-4 py-3">
      <p className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--success-strong)]">
        <span aria-hidden="true">✓</span>
        <span>
          Verified {verified}
          {attribution}
        </span>
      </p>
    </div>
  );
}

/**
 * Record status (§5.7.6), the owner/staff view: the verification read-out and the
 * Verify affordance (owner/staff — the 4c-2 verification pass, D28/D48) plus the
 * last-updated line. The staff-internal Admin Note is **not** here — it moved to its
 * own {@link AdministrativeSection} so it no longer blends into the verification
 * read-out (OFC-271). Brothers viewing another brother see only the verification
 * read-out, rendered standalone in {@link ProfileView} (OFC-207).
 */
function RecordStatusSection({
  record,
  viewer,
  onVerify,
  names,
}: {
  record: ProfileRecord;
  viewer: Viewer;
  onVerify: () => Promise<void>;
  names: Map<number, string> | null;
}) {
  return (
    <Section title="Record status">
      <VerificationReadout record={record} names={names} />
      <VerifyControl record={record} viewer={viewer} onVerify={onVerify} />
      {record.lastModified && (
        <p className="text-[length:var(--text-body-sm)] text-muted-foreground">
          Last updated {record.lastModified.slice(0, 10)}.
        </p>
      )}
    </Section>
  );
}

/**
 * The staff-internal Admin Note in its own section (OFC-271). Split out of Record
 * status — where it kept getting overlooked against the verification read-out — into
 * a clearly-labelled "Administrative" heading of its own. Renders **only** for
 * managers/admins and **only** when a note exists, so the heading never appears for
 * the owner, a non-staff viewer, or an empty note (`adminNote` is `staff-internal`,
 * so a brother's projection never carries it in the first place).
 */
function AdministrativeSection({ record, viewer }: { record: ProfileRecord; viewer: Viewer }) {
  const isStaff = viewer.role === "manager" || viewer.role === "admin";
  if (!isStaff || !record.adminNote) {
    return null;
  }
  return (
    <Section title="Administrative">
      <ReadField label="Admin note (staff only)">
        <span className="whitespace-pre-wrap">{record.adminNote}</span>
      </ReadField>
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
