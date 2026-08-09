import {
  type EmergencyContact,
  formatClassYear,
  formatConstitutionId,
  isWillingToMentor,
} from "@pbe/shared";
import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../../components/Avatar.js";
import { trackProfileViewed } from "../../lib/analytics.js";
import type { DirectoryProfile, ProfileRecord } from "../../lib/types.js";
import { CourseChip, DebrotheredBadge, UnlistedBadge } from "../directory/Chips.js";
import { StarButton } from "../directory/RowControls.js";
import { useStars } from "../directory/StarsContext.js";
import { BOX, Thumbnail } from "../directory/thumbnail.js";
import { DirectoryNav } from "./DirectoryNav.js";
import { type ProfileActions, StaffControls, VerifyControl } from "./ProfileControls.js";
import { ProfileHeadshot } from "./ProfileHeadshot.js";
import { SWITCH_KEYS, activeConsequence, switchCopy } from "./consent.js";
import {
  type DirectoryNav as DirectoryNavModel,
  type DirectoryNavState,
  type StepDirection,
  branchNavState,
} from "./directory-nav.js";
import {
  addressLines,
  canonicalName,
  formatFullDate,
  hasAddress,
  lifespanLine,
  verifierAttribution,
} from "./display.js";
import { PrivateMarker, ReadField, Section } from "./fields.js";
import {
  type RelationshipEntry,
  bigBrotherEntry,
  littleBrotherEntries,
  rosterNames,
} from "./relationships.js";
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

  // Count profile views (7a-4; Forrest's OFC-296 note), keyed on the record so
  // prev/next navigation through the roster counts each. `Own` distinguishes a
  // brother reading his own record from viewing another's; the id itself never
  // travels (P6), and `$current_url` is stripped by BLOCKED_PROPERTIES.
  // No StrictMode dedup ref (unlike some sibling effects): the dev-only double-invoke
  // is inert — analytics is a no-op without a token in dev (D140) and a production
  // build doesn't double-invoke — so a guard engineered to still allow the intended
  // per-record re-fire would add fragility for no real gain.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on `record.id` change is the intent — count each viewed record; the id is never read into the event.
  useEffect(() => {
    trackProfileViewed(viewer.isOwner);
  }, [record.id, viewer.isOwner]);
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
              employer column (N35); Relationships follows full width. Each supplies
              its own Band, so a section with nothing to show contributes no rule
              either — see Band (OFC-318). */}
          <ProfessionalSection record={record} viewer={viewer} />
          <RelationshipsSection
            record={record}
            roster={roster}
            names={names}
            viewer={viewer}
            branchState={branchNavState(directoryNav)}
          />

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

/**
 * A full-width section band: the hairline rule that separates it from the section
 * above, plus the page's vertical rhythm (§5.7.1).
 *
 * ⚠ It is the **section's own** wrapper, never a wrapper the page puts around a
 * section — that is the whole point (OFC-318). A band rendered by the page renders
 * whether or not its section did, so a section that returns `null` used to leave a
 * rule and 48px of blank space behind it, reading as two stacked rules with nothing
 * between them. A section that renders nothing must contribute no chrome, and the
 * only way to guarantee that is for the chrome to be inside the thing that decides.
 */
function Band({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-border-hairline py-6">{children}</div>;
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
      {/* Click/Enter opens the full 512² photo (OFC-353) — the same image the page
          has already loaded, so the larger view costs nothing to show. */}
      <ProfileHeadshot record={record} name={name} responsive enlargeable />
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
    <Band>
      <Section title="Professional &amp; personal">
        <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
          <div className="space-y-4">
            {employer && <ReadField label="Employer">{employer}</ReadField>}
            {record.postPbeEducation && (
              <ReadField label="Post-PBE education">{record.postPbeEducation}</ReadField>
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
            {/* Mentoring (D166, OFC-386): shown only when the brother has opted in —
              there is no "not willing" state to display, because declining to
              volunteer is the default and says nothing about him. `isWillingToMentor`
              (not the raw field) is what also keeps a deceased brother's opt-in off
              his memorial page. */}
            {isWillingToMentor(record) && (
              <ReadField label="Mentoring">
                <span className="flex items-start gap-2.5">
                  {/* The same filled --success dot the Preferences & consent digest
                    uses for an active choice, so a positive answer reads the same way
                    wherever it appears. ⚠ The offset differs from that digest's
                    `mt-1.5` on purpose: this sits in a ReadField at --text-body-lg
                    (15px/1.5 → a 22.5px line box), so centring an 8px dot on the first
                    line wants ~7.25px, not the ~6.85px of the digest's 14px/1.55 line.
                    `items-start`, not `items-center`, so the dot stays on the first
                    line when the sentence wraps on a phone.

                    Decorative only: it is aria-hidden and the sentence beside it
                    already carries the whole meaning, so nothing here rides on colour
                    (D32). There is no "off" dot because the line does not render at
                    all when the brother has not opted in. */}
                  <span
                    aria-hidden="true"
                    className="mt-2 size-2 shrink-0 rounded-full bg-[var(--success)]"
                  />
                  <span>Willing to provide professional information and advice</span>
                </span>
              </ReadField>
            )}
            {/* Sports and Activities (OFC-405/406), in the same order and the same
              column as the edit form — the edit/view correspondence N160 restored
              for Mentoring. Each renders only when filled: an empty line would put
              a row of blank labels on the great majority of profiles, and these
              fields carry no "unset is meaningful" case the way a privacy toggle
              does. */}
            {record.sports && <ReadField label="Sports">{record.sports}</ReadField>}
            {record.activities && <ReadField label="Activities">{record.activities}</ReadField>}
          </div>
        </div>
      </Section>
    </Band>
  );
}

/**
 * Relationships (§5.7.4). The Big Brother carries his Canonical Name, and the
 * **derived Little Brothers** — the brothers who name this one as their Big
 * Brother — render read-only beneath. Both are free reads of the in-memory
 * dataset; nothing here is stored.
 *
 * Either edge may point at a brother this viewer may not see (`unlisted` D124 /
 * `debrothered` D115), and D168 renders that as an explicit, nameless "Info is
 * private" rather than eliding it. The two directions used to fail differently
 * and both wrongly (OFC-392): a withheld Big Brother became a stranger with
 * invented initials, while a withheld Little Brother vanished so completely that
 * a brother whose *only* little brother was unlisted lost the whole section — an
 * unlisted little brother being indistinguishable from none at all.
 *
 * The section is absent only when there is genuinely nothing to say: no Big
 * Brother, no visible Little Brother, and none withheld.
 */
function RelationshipsSection({
  record,
  roster,
  names,
  viewer,
  branchState,
}: {
  record: ProfileRecord;
  roster: DirectoryProfile[] | null;
  names: Map<number, string> | null;
  viewer: Viewer;
  /** The directory-return state to carry across a relationship hop (OFC-396). */
  branchState: DirectoryNavState | undefined;
}) {
  const littles = useMemo(
    () => littleBrotherEntries(roster, names, record.id, record.hiddenLittleBrothers),
    [roster, names, record.id, record.hiddenLittleBrothers],
  );
  const big = bigBrotherEntry(roster, names, record.bigBrotherId);

  if (big === null && littles.length === 0) {
    return null;
  }

  return (
    <Band>
      <Section title="Relationships">
        {big && (
          <ReadField label="Big Brother">
            <RelationshipEntryView entry={big} viewer={viewer} branchState={branchState} />
          </ReadField>
        )}
        {littles.length > 0 && (
          <ReadField label="Little Brothers">
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              {littles.map((entry, index) => (
                // Private placeholders carry no id, so they are keyed by position.
                // They are interchangeable by construction — that is the point —
                // so a positional key reorders nothing observable.
                <li key={entry.kind === "private" ? `private-${index}` : entry.id}>
                  <RelationshipEntryView entry={entry} viewer={viewer} branchState={branchState} />
                </li>
              ))}
            </ul>
          </ReadField>
        )}
      </Section>
    </Band>
  );
}

/**
 * One brother in the Relationships section (§5.7.4; OFC-203): the Directory's
 * thumbnail (photo, or the initials/silhouette avatar, with the deceased/
 * de-brothered overlays) to the left of his Canonical Name, the whole thing a
 * link to his profile — so brother names read identically here and in the
 * Directory. The thumbnail is decorative (the adjacent name is the link's
 * accessible label).
 *
 * A **private** entry is the exception, and deliberately not a link (D168): its
 * only destination is a page saying exactly what the label already says. Its
 * avatar is anonymous *and* unseeded, so every withheld brother renders
 * identically — a per-id colour family would otherwise let a viewer tell two
 * withheld brothers apart, and match one against a `bigBrotherId` he can read.
 *
 * The link carries `branchState` so the brother it lands on still knows the way
 * back to the Directory the reader came from (OFC-396). Without it he read as a
 * cold deep-link and "← Directory" returned a fresh, unfiltered one.
 */
function RelationshipEntryView({
  entry,
  viewer,
  branchState,
}: {
  entry: RelationshipEntry;
  viewer: Viewer;
  branchState: DirectoryNavState | undefined;
}) {
  if (entry.kind === "private") {
    return (
      <span className="inline-flex items-center gap-2.5">
        <Avatar name="" size={BOX} anonymous />
        <span className="text-muted-foreground italic">Info is private</span>
      </span>
    );
  }

  // A still-loading roster keeps the pre-D168 neutral invitation: for all but a
  // handful of brothers the link is real, and the label resolves to his name the
  // moment the roster lands. The avatar stays anonymous until it does.
  const label = entry.kind === "pending" ? "View his profile" : entry.name;
  const staff = viewer.role === "manager" || viewer.role === "admin";
  return (
    <span className="inline-flex items-center gap-2.5">
      <Link
        to={`/brother/${entry.id}`}
        state={branchState}
        className="group inline-flex items-center gap-2.5 rounded-[var(--radius-md)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {entry.kind === "known" ? (
          <Thumbnail profile={entry.profile} name={label} decorative />
        ) : (
          <Avatar name="" seed={entry.id} size={BOX} anonymous />
        )}
        <span className="font-medium text-foreground underline-offset-2 group-hover:underline">
          {label}
        </span>
      </Link>
      {/* Managers and administrators see through the hide, so for them the
        relationship resolves normally — and carries the same status badges the
        Directory puts on the row, so one record reads the same on both surfaces
        (D124/D115). Brothers never reach this branch: a withheld record is absent
        from their roster, so it is a `private` entry above.

        Outside the <Link> on purpose: inside, the badge text would be folded into
        the link's accessible name ("Robert Brown '79 Unlisted"), which is a status
        of the record, not part of who the link goes to. */}
      {entry.kind === "known" && staff && (
        <>
          {entry.profile.unlisted === true && <UnlistedBadge />}
          {entry.profile.debrothered?.isDebrothered === true && <DebrotheredBadge />}
        </>
      )}
    </span>
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
    lines.push({
      on: record.privacy.shareEmergency,
      text: activeConsequence(
        switchCopy(SWITCH_KEYS.shareEmergency),
        record.privacy.shareEmergency,
      ),
    });
    lines.push({
      on: record.privacy.shareSpousePartner,
      text: activeConsequence(
        switchCopy(SWITCH_KEYS.shareSpousePartner),
        record.privacy.shareSpousePartner,
      ),
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
  // Directory listing, in the positive "Listed" framing (N35): on = listed, the
  // stored field is `unlisted` so the sense is inverted. Always shown to match the
  // edit page — every privacy toggle appears for the owner/staff who can see this
  // digest (OFC-278), a filled marker when listed and a hollow one with the "you
  // don't appear" consequence when not.
  const listed = !(record.unlisted ?? false);
  lines.push({ on: listed, text: activeConsequence(switchCopy(SWITCH_KEYS.listed), listed) });
  if (record.allowShareWithMITAA !== undefined) {
    lines.push({
      on: record.allowShareWithMITAA,
      text: activeConsequence(
        switchCopy(SWITCH_KEYS.allowShareWithMITAA),
        record.allowShareWithMITAA,
      ),
    });
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
