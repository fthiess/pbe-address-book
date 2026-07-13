/**
 * Shared domain types — the one source of truth imported by both the SPA and
 * the backend (DECISIONS D3, "one shared `Profile` type"). The record shape
 * therefore cannot drift across the wire, and the same type is the on-the-wire
 * JSON shape: the server's only transformation is to *omit* fields the caller
 * may not see (the visibility projection, §9 / `projection.ts`).
 *
 * Built directly from `docs/initial-build/DATABASE-SCHEMA.md` §3 (Phase 2a).
 * This supersedes the Phase-0 first cut: identity is now the schema's single
 * numeric `id` (the Constitution signing number, also the Firestore document key
 * as `String(id)` — there is no separate `constitutionId`), `deceased` /
 * `debrothered` / `privacy` / `address` are structured sub-types, the consent
 * and housekeeping fields are present, and the Canonical Name is **derived, not
 * stored** (`canonical-name.ts`, §5.1) so no denormalized copy can go stale.
 */

/** Constitution signature number: a unique, permanent, positive integer (§3.1). */
export type BrotherId = number;

/** The three roles in the capability matrix (D19; DATABASE-SCHEMA §6.1). */
export type Role = "brother" | "manager" | "admin";

/**
 * Field-visibility classes (DATABASE-SCHEMA §9). Every `Profile` field belongs
 * to exactly one class; the server-side projection (`projection.ts`) enforces
 * them per role. Carried as a type so the projection's field→class table is
 * checked against this closed set.
 */
export type VisibilityClass =
  | "public"
  | "toggle"
  | "restricted"
  | "private"
  | "staff-internal"
  | "system-internal";

/**
 * Structured postal address (§3.2). The field set mirrors MITAA's for clean
 * data exchange; `country` drives US-vs-international display ordering.
 */
export interface Address {
  street1?: string;
  street2?: string;
  street3?: string;
  city?: string;
  /** US/CA: a bundled 2-letter code (display derived); else free text (§8, D37). */
  stateProvince?: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2 code (e.g. "GB"); display name derived (§8). */
  country?: string;
}

/** An emergency contact (§3.2). Up to two per profile; all fields optional. */
export interface EmergencyContact {
  name?: string;
  phone?: string;
  email?: string;
}

/** A free-form external link (§3.2). Up to five per profile. */
export interface Link {
  /** Free-form, e.g. "LinkedIn", "Personal site". */
  label: string;
  /** Validated against the strict http/https scheme allowlist on write (§8, D107). */
  url: string;
}

/**
 * Deceased status and the In Memoriam facts (§3.2). Orthogonal to
 * {@link DebrotherInfo}. The `birthYear`/`deathYear` lifespan fields are
 * deceased-only and shown only when deceased (D122).
 */
export interface DeceasedInfo {
  /** Default false; settable by managers and admins (PRD §4). */
  isDeceased: boolean;
  /** YYYY-MM-DD. */
  dateOfDeath?: string;
  /** Year of birth; deceased-only; powers the In Memoriam lifespan line (D122). */
  birthYear?: number;
  /**
   * Coarse fallback for the year of death when `dateOfDeath` is unknown;
   * mutually exclusive with `dateOfDeath` — rejected on write when a full date
   * is present (D122).
   */
  deathYear?: number;
  obituaryUrl?: string;
  inMemoriamUrl?: string;
}

/**
 * The consent + verification state captured when a coordinated status action
 * (mark-deceased or de-brother) forces the consent flags off, so an accidental
 * mark can be reversed without silently losing a living brother's real
 * subscription state (decision D80; DATABASE-SCHEMA §8). Captured at mark-time,
 * restored on un-marking, then cleared. **System-internal — never sent to any
 * client** (visibility class `system-internal`, like `ghostMemberId`).
 *
 * Mark-deceased and de-brother are orthogonal (both may be set), so each keeps
 * its **own** snapshot ({@link Profile.deceasedConsentSnapshot} /
 * {@link Profile.debrotherConsentSnapshot}); one shared slot would let the second
 * action capture the first's already-forced-off flags and restore stale values.
 */
export interface ConsentSnapshot {
  allowNewsletterEmail: boolean;
  /** The verification date at mark-time, if the record was verified then. */
  lastVerifiedDate?: string;
  /** The verifier at mark-time, if the record was verified then. */
  verifiedBy?: BrotherId;
}

/**
 * De-brothering: a rare, admin-only state for a member removed from the
 * brotherhood (§3.2, D115). Raising it hides the record from brothers entirely
 * (managers/admins still see it, struck through), deletes the Ghost member,
 * denies Book sign-in, and excludes the record from the MITAA export — and is
 * reversible via a mark-time consent/verification snapshot. Orthogonal to
 * {@link DeceasedInfo}.
 */
export interface DebrotherInfo {
  /** Default false; settable by admins only. */
  isDebrothered: boolean;
  /** ISO 8601 timestamp; set when the flag is raised. */
  debrotheredAt?: string;
}

/**
 * Per-field visibility toggles for the toggle-class fields (§3.2). Each governs
 * whether other brothers AND managers see the corresponding field(s); the owner
 * and admins always see them. The reachability toggles default true; the two
 * third-party-data toggles (`shareEmergency`, `shareSpousePartner`) default
 * FALSE / opt-in (D93).
 */
export interface PrivacyFlags {
  /** Covers both `email` and `alternateEmail`; default true. */
  shareEmail: boolean;
  /** Covers `phone`; default true. */
  sharePhone: boolean;
  /** Covers the whole `Address` block; default true. */
  shareAddress: boolean;
  /** Covers all `emergencyContacts`; default FALSE — third-party data (D93). */
  shareEmergency: boolean;
  /** Covers `spousePartnerName`; default FALSE — third-party data (D93). */
  shareSpousePartner: boolean;
}

/**
 * A brother's profile — the full schema (DATABASE-SCHEMA §3.1). This is the
 * complete stored shape; the wire shape is the same type with fields the caller
 * may not see omitted by the server-side projection (§9). Field-by-field
 * visibility, defaults, and validation are in DATABASE-SCHEMA §3.3 / §8 / §9.
 */
export interface Profile {
  // --- Identity ---
  /** Primary key; also the Firestore document ID (as `String(id)`). Immutable. */
  id: BrotherId;

  // --- Names ---
  firstName: string;
  middleName?: string;
  lastName: string;
  /** Full/rare form, incl. suffixes (Jr., III) and compound names. */
  fullLegalName?: string;
  /** Nickname printed on the brother's PBE mug. */
  mugName?: string;

  // --- Class year ---
  /** 4-digit graduation year of the class identified with; null = unknown (§4). */
  classYear: number | null;

  // --- Contact ---
  /** Stored normalized: lowercased, trimmed, Unicode-NFC (§8, D97). */
  email?: string;
  /** Only valid when `email` is present; shares one uniqueness namespace with it (§8, D97). */
  alternateEmail?: string;
  /** Free-form; international numbers allowed. */
  phone?: string;
  address?: Address;
  /** Up to 2. */
  emergencyContacts?: EmergencyContact[];

  // --- Professional / personal ---
  employerName?: string;
  jobTitle?: string;
  /** toggle: `shareSpousePartner` — third-party data, default off (D93). */
  spousePartnerName?: string;
  /** Course codes (e.g. ["6-3"]); primary first; validated against `majors`. */
  majors?: string[];
  /** Up to 5 external links. */
  links?: Link[];

  // --- Relationships ---
  /** The brother's Big Brother; must exist, not self, no cycles. */
  bigBrotherId?: BrotherId | null;

  // --- Status ---
  deceased: DeceasedInfo;
  /** Admin-only; hides the record from brothers (D115). */
  debrothered: DebrotherInfo;

  // --- Access ---
  /**
   * The brother's Book role (D19; DATABASE-SCHEMA §3.1/§6.1). Moved onto the
   * profile from the private `users` collection (OFC-139): a role is a property
   * *of the brother*, like class year — not per-viewer state (only `stars` is
   * genuinely per-viewer and stays in `users`). **Public** on read — every
   * brother may see who holds a staff role, which is official and not secret
   * (OFC-199) — and **protected** on write, set only by the change-role action,
   * never through PATCH.
   *
   * Stored *optionally* in Firestore: a document that omits `role` is a
   * `brother`, so the initial data load writes `role` only for the non-brothers.
   * The single Firestore→`Profile` hydration boundary normalizes a missing value
   * to `"brother"`, so the in-memory value is always concrete — no authorization
   * path ever sees an undefined role.
   */
  role: Role;

  // --- Photos (binaries live in GCS, §7; only metadata is stored here) ---
  hasHeadshot: boolean;
  /** Opaque cache-busting token for the immutable headshot/thumbnail URLs (R16). */
  headshotVersion?: string;

  // --- Visibility ---
  privacy: PrivacyFlags;
  /**
   * Default false; when true the whole record is hidden from peers in the
   * directory — a self-service privacy hide (admins may also set it; managers
   * may not). The member is otherwise fully retained — distinct from
   * `debrothered`; staff still see it, badged "UNLISTED" (D124, §9).
   */
  unlisted: boolean;

  // --- Usage preferences (restricted: owner/manager/admin only — §9) ---
  /** Default true — may PBE News be emailed; pushed to Ghost; forced false when deceased. */
  allowNewsletterEmail: boolean;
  /** Default false (opt-in, D89) — master switch for sharing own contact info with MITAA (§9). */
  allowShareWithMITAA: boolean;

  // --- Housekeeping (restricted) ---
  /** YYYY-MM-DD; present iff currently verified (system-managed, D28). */
  lastVerifiedDate?: string;
  /** Constitution ID of the verifier; set/cleared together with `lastVerifiedDate` (D28). */
  verifiedBy?: BrotherId;
  /** ISO 8601 timestamp; server-set on every write — the displayed "last updated" value. */
  lastModified: string;
  /**
   * ISO 8601 timestamp; server-set whenever `allowNewsletterEmail` changes
   * (incl. the mark-deceased force-off and the D80 un-decease restore) — the
   * causal signal for the bidirectional Ghost newsletter reconcile (D103).
   */
  newsletterConsentChangedAt: string;

  // --- Staff & integration (outside every brother-facing projection — §9) ---
  /** Staff-internal free-text note; manager/admin read+write; invisible to owner and peers. */
  adminNote?: string;
  /** Ghost Admin-API member id; backend-only system field; never sent to any client. */
  ghostMemberId?: string;

  // --- System-internal status snapshots (never sent to any client — §8, D80) ---
  /**
   * Consent/verification captured when this brother was marked **deceased**;
   * restored (and cleared) when the deceased flag is reversed (D80). Present only
   * while deceased. System-internal — see {@link ConsentSnapshot}.
   */
  deceasedConsentSnapshot?: ConsentSnapshot;
  /**
   * Consent/verification captured when this brother was **de-brothered**;
   * restored (and cleared) on reinstatement (D80/D115). Present only while
   * de-brothered. System-internal — see {@link ConsentSnapshot}.
   */
  debrotherConsentSnapshot?: ConsentSnapshot;
}
