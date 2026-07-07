# PBE Address Book ("Book") — Database Schema

**Status:** Draft · Authored Session 2 (2026-06-02); amended Session 3 (2026-06-03) — added the `verifiedBy` field and narrowed the manager visibility rule (decision D19); amended Session 4b (2026-06-04) — `address.stateProvince` becomes a US/Canada controlled vocabulary (decision D37); amended Session 5 (2026-06-05) — added the Ghost-coupled fields `allowCommentReplyEmail`, `adminNote`, and `ghostMemberId`, the staff-internal and system visibility classes, and the `allowShareWithMITAA` master-switch clarification (decisions D55, D56, D59); amended Session 6c (2026-06-07) — close-out consistency pass (example data replaced with the fake exemplar; planning-vault references repointed to the graduated `DECISIONS.md`); amended in the **resolution / propagation pass** (2026-06-11) — propagated the design-review triage decisions: removed `ghostMemberUuid` (D81); email stored normalized with one-namespace uniqueness (D97); added `newsletterConsentChangedAt` for the bidirectional Ghost newsletter reconcile (D103); the deceased consent/verification snapshot-and-restore rule (D80); the split read projection (D82); image-upload bounding + pointer-last headshot ordering (D98, D107); strict URL-scheme allowlist (D107); the server-side write-field allowlist / object-level predicate / last-admin invariant (D106); `localStorage` for client UI prefs (D30/C1); `verifiedBy` as a read-only export column (C8); CSV formula-injection neutralization (S9); the dedicated two-tier MITAA export (D90); 18+ population note (P19); retired the stale "Session 6" forward-refs (C4); and dropped the thumbnail-regenerate feature (D114). Amended in the **post-resolution amendments pass** (2026-06-12) — added the admin-only `debrothered` flag and its snapshot/restore + projection rules (D115), the `config` collection holding the system-banner singleton (D117), and the `bugReports` collection (D121). Amended in the **early-feedback pass** (2026-06-24) — added the deceased `birthYear`/`deathYear` lifespan fields (D122), the whole-record `unlisted` privacy flag (D124), and the `sessions`/`authNonces` session/nonce collections (D125); and **corrected the previously-unpropagated D89/D93 privacy defaults** — `allowShareWithMITAA` now defaults `false` (opt-in, D89), and `shareEmergency`/`shareSpousePartner` default `false` with `spousePartnerName` reclassified to toggle-class (D93). This document defines the data model: the Firestore collections, the GCS image assets, the shared `Profile` TypeScript type, sub-types, constructed values, controlled vocabulary, the field-visibility taxonomy, validation rules, and the canonical CSV column names.

**Canon:** This is a *delivered* artifact and lives in the code repo (`pbe-address-book/docs/initial-build/`). Decision rationale lives in `DECISIONS.md` (the decision log in this build's docs); the narrative of how the design was reached is in `history/DESIGN-HISTORY.md`. See also `PRD.md` (scope) and `ENGINEERING-DESIGN.md` (architecture).

## 1. Overview

Book's persistent data spans **three Firestore collections** plus **image objects in Google Cloud Storage**:

- **`profiles`** — one document per brother, holding the directory data shown to other brothers (subject to per-field visibility projection). This is the dataset the SPA bulk-downloads into browser memory on startup.
- **`users`** — one document per brother account, holding *private per-user state* never shared with other brothers: the user's permission `role` and their personal `stars` list. Keyed by the same Constitution ID as the profile.
- **`majors`** — a small controlled-vocabulary collection, one document per MIT course code, used to validate and display the `majors` field on profiles.
- **GCS image objects** — headshots and thumbnails (binaries don't belong in a document store, decision D8); see §7.

Splitting `users` out of `profiles` keeps private state (role, stars) out of the bulk-download payload that goes to every brother, and keeps the server-side projection (decision D5) operating over directory data only.

Several small **operational collections** sit outside the directory model: **`config`**, holding app-level singletons (the admin-set system banner, decision D117); **`bugReports`**, holding user-submitted bug reports (decision D121); and **`sessions`** and **`authNonces`**, holding Book's server-side session records and single-use login nonces (decision D125) — each carrying an `expiresAt` field with a native Firestore **TTL** so they self-clean, and, critically, so a scale-to-zero cold start does **not** lose live sessions (ENGINEERING-DESIGN §2.3). None is part of the `GET /api/profiles` projection.

Because the whole dataset lives in browser memory (decision D4), reference data like the majors vocabulary is also loaded once at startup and consulted via in-memory lookups — there are no per-request joins. Reference data that is a *fixed external standard* — the ISO 3166-1 country list used to validate and display `address.country` (§7-adjacent, see §8) — is bundled into the build as a shared constant rather than a Firestore collection, since it essentially never changes; Firestore is reserved for Book's own mutable data.

The `Profile` type below is the single shared TypeScript type that both the frontend and backend import (decision D3), so the record shape cannot drift across the wire. The same type is the on-the-wire JSON shape; the server's only transformation is to *omit* fields the requester is not permitted to see (visibility projection, enforced server-side — see §9 and Session 3).

## 2. Conventions

- **Field names** are `camelCase`. **Document IDs** are strings (Firestore requires this); the Constitution ID is therefore stored both as the document key (`String(id)`) and as a numeric `id` field inside the document, so the app can sort and range-filter on it numerically.
- **Controlled-vocabulary fields** (majors, country) store a stable **code** and derive the human-readable display name from a lookup, so a name correction propagates everywhere and stored records stay compact.
- **Dates** are strings in modified ISO 8601: `YYYY-MM-DD` for calendar dates, full ISO 8601 timestamps for machine-set times. This matches the PRD's display/entry rule.
- **Optional vs. nullable.** A `?` field may be absent (no value recorded). A field typed `| null` is always present but may explicitly carry "unknown" — used where the distinction matters (e.g. `classYear`, §4).
- **Required** means the field must be present on every stored document. **Default** is the value written at creation when the user supplies nothing.

## 3. The `profiles` collection

### 3.1 The `Profile` type

```typescript
/** Constitution signature number: a unique, permanent, positive integer. */
type BrotherId = number;

interface Profile {
  // --- Identity ---
  id: BrotherId;                       // primary key; also the Firestore document ID (as a string)

  // --- Names ---
  firstName: string;                   // required
  middleName?: string;
  lastName: string;                    // required
  fullLegalName?: string;              // full/rare form, incl. suffixes (Jr., III) and compound names
  mugName?: string;                    // nickname printed on the brother's PBE mug

  // --- Class year ---
  classYear: number | null;            // 4-digit graduation year of the class identified with; null = unknown

  // --- Contact ---
  email?: string;                      // stored normalized: lowercased, trimmed, Unicode-NFC (see §8, D97)
  alternateEmail?: string;             // only valid when email is present; shares one uniqueness namespace with email (see §8, D97)
  phone?: string;                      // free-form; international numbers allowed
  address?: Address;
  emergencyContacts?: EmergencyContact[]; // up to 2

  // --- Professional / personal ---
  employerName?: string;
  jobTitle?: string;
  spousePartnerName?: string;          // toggle: shareSpousePartner — third-party data, default off (decision D93)
  majors?: string[];                   // course codes (e.g. ["6-3"]); primary first; validated vs. `majors`
  links?: Link[];                      // up to 5 external links

  // --- Relationships ---
  bigBrotherId?: BrotherId | null;     // the brother's Big Brother; must exist, not self, no cycles

  // --- Status ---
  deceased: DeceasedInfo;              // isDeceased defaults false
  debrothered: DebrotherInfo;          // isDebrothered defaults false; admin-only; hides the record from brothers (decision D115)

  // --- Photos (binaries live in GCS, §7; only metadata is stored here) ---
  hasHeadshot: boolean;                // default false
  headshotVersion?: string;            // cache-busting token for the immutable headshot/thumbnail URLs

  // --- Visibility toggles (peer visibility of the toggle-class fields) ---
  privacy: PrivacyFlags;
  unlisted: boolean;                   // default false; when true the whole record is hidden from peers in the directory — a self-service privacy hide (admins may also set it). The member is otherwise fully retained (signs in, gets PBE News, flows to MITAA per consent) — distinct from `debrothered`; staff still see it, badged "UNLISTED" (decision D124, §9)

  // --- Usage preferences (restricted: owner/manager/admin only — see §9) ---
  allowNewsletterEmail: boolean;       // default true — may PBE News be emailed to this brother; pushed to Ghost; forced false when deceased
  allowCommentReplyEmail: boolean;     // default true — may Ghost email this brother about replies to their article comments; pushed to Ghost; forced false when deceased
  allowShareWithMITAA: boolean;        // default false (opt-in, D89) — master switch: may the brother's own contact info be shared with MITAA (see §9)

  // --- Housekeeping (restricted) ---
  lastVerifiedDate?: string;           // YYYY-MM-DD; present iff the profile is currently verified (system-managed, decision D28)
  verifiedBy?: BrotherId;              // Constitution ID of the verifier; set/cleared together with lastVerifiedDate (decision D28)
  lastModified: string;                // ISO 8601 timestamp; server-set on every write — the displayed "last updated" value (the optimistic-concurrency token is Firestore's updateTime; see API-SPEC.md)
  newsletterConsentChangedAt: string;  // ISO 8601 timestamp; server-set whenever allowNewsletterEmail changes (incl. the mark-deceased force-off and the D80 un-decease restore) — supplies the causality for the bidirectional Ghost newsletter reconcile (D103; ENGINEERING-DESIGN §5.1)

  // --- Staff & integration (outside every brother-facing projection — see §9) ---
  adminNote?: string;                  // staff-internal free-text note; manager/admin read+write only; invisible to owner and peers; not pushed to Ghost; seeded from Ghost notes at launch
  ghostMemberId?: string;              // Ghost Admin-API member id; the handle used to address Book→Ghost member updates; backend-only system field; captured on create-push or migration; never sent to any client
  // ghostMemberUuid removed from the MVP schema (D81, supersedes D70): no MVP feature reads it; trivially re-capturable from Ghost if a concrete consumer is later decided.
  deceasedConsentSnapshot?: ConsentSnapshot;   // system-internal (D80, §8): consent+verification captured when marked deceased; restored+cleared on un-mark; never sent to any client
  debrotherConsentSnapshot?: ConsentSnapshot;  // system-internal (D80/D115, §8): consent+verification captured when de-brothered; restored+cleared on reinstate; never sent to any client
}
```

`ConsentSnapshot` is the small system-internal shape both status actions capture (each into its **own** field, since mark-deceased and de-brother are orthogonal — a shared slot would let the second action snapshot the first's already-forced-off flags, exactly the loss D80 prevents; DECISIONS N49):

```typescript
interface ConsentSnapshot {
  allowNewsletterEmail: boolean;
  allowCommentReplyEmail: boolean;
  lastVerifiedDate?: string;           // the verification stamp at mark-time, if verified then
  verifiedBy?: number;
}
```

### 3.2 Sub-types

```typescript
/** Structured postal address. Field set mirrors MITAA's for clean data exchange.
 *  `country` drives display ordering for US vs. international formats. */
interface Address {
  street1?: string;
  street2?: string;
  street3?: string;
  city?: string;
  stateProvince?: string;              // US/CA: bundled 2-letter code (display derived); else free text — see §8 (D37)
  postalCode?: string;
  country?: string;                    // ISO 3166-1 alpha-2 code (e.g. "GB"); display name derived
}

interface EmergencyContact {
  name?: string;
  phone?: string;
  email?: string;
}

interface Link {
  label: string;                       // free-form, e.g. "LinkedIn", "Personal site"
  url: string;
}

interface DeceasedInfo {
  isDeceased: boolean;                 // default false; settable by managers and admins (PRD §4)
  dateOfDeath?: string;                // YYYY-MM-DD
  birthYear?: number;                  // year of birth; deceased-only; powers the In Memoriam lifespan line (decision D122)
  deathYear?: number;                  // coarse fallback for the year of death when dateOfDeath is unknown; mutually exclusive with dateOfDeath — rejected on write when a full date is present (decision D122)
  obituaryUrl?: string;                // link to a public obituary
  inMemoriamUrl?: string;              // link to the PBE News "In Memoriam" article
}

/** De-brothering: a rare, admin-only state for a member removed from the brotherhood
 *  in extreme circumstances. Raising it hides the record from brothers entirely
 *  (managers/admins still see it, struck through), deletes the Ghost member, denies
 *  Book sign-in, and excludes the record from the MITAA export — and is reversible
 *  by a mark-time consent/verification snapshot (decision D115; §8, §9). Orthogonal
 *  to DeceasedInfo. */
interface DebrotherInfo {
  isDebrothered: boolean;              // default false; settable by admins only
  debrotheredAt?: string;              // ISO 8601 timestamp; set when the flag is raised
}

/** Per-field visibility toggles for the toggle-class fields. Each governs whether
 *  other brothers AND managers see the corresponding field(s); the owner and admins
 *  always see them. The backend projects hidden fields out of the response entirely
 *  (decision D5). The reachability toggles default true; the two third-party-data
 *  toggles (shareEmergency, shareSpousePartner) default FALSE / opt-in (decision D93). */
interface PrivacyFlags {
  shareEmail: boolean;                 // covers both email and alternateEmail; default true
  sharePhone: boolean;                 // default true
  shareAddress: boolean;               // covers the whole Address block; default true
  shareEmergency: boolean;             // covers all emergencyContacts; default FALSE — third-party (non-member) data (decision D93)
  shareSpousePartner: boolean;         // covers spousePartnerName; default FALSE — third-party (non-member) data (decision D93)
}
```

### 3.3 Field reference

Required / default / visibility / validation for each field. The **Visibility** column is defined in §9; see §8 for full validation rules and §10 for CSV column names.

| Field | Type | Required | Default | Visibility | Notes |
|---|---|---|---|---|---|
| `id` | `number` | yes | — | public | Positive integer, unique, immutable after creation. |
| `firstName` | `string` | yes | — | public | Non-empty. |
| `middleName` | `string?` | no | absent | public | |
| `lastName` | `string` | yes | — | public | Non-empty. |
| `fullLegalName` | `string?` | no | absent | public | Holds suffixes (Jr., III) and multi-part names. |
| `mugName` | `string?` | no | absent | public | |
| `classYear` | `number \| null` | yes (value or null) | `null` | public | 4-digit; `null` = unknown. |
| `email` | `string?` | no | absent | toggle: `shareEmail` | Email format. |
| `alternateEmail` | `string?` | no | absent | toggle: `shareEmail` | Email format; requires `email`. |
| `phone` | `string?` | no | absent | toggle: `sharePhone` | Loose format; international allowed. |
| `address` | `Address?` | no | absent | toggle: `shareAddress` | All sub-fields optional. |
| `emergencyContacts` | `EmergencyContact[]?` | no | absent | toggle: `shareEmergency` | Max length 2. |
| `employerName` | `string?` | no | absent | public | |
| `jobTitle` | `string?` | no | absent | public | |
| `spousePartnerName` | `string?` | no | absent | toggle: `shareSpousePartner` | Third-party data; hidden from peers unless the brother opts in (decision D93). |
| `majors` | `string[]?` | no | absent | public | Each code must exist in `majors`; no duplicates; primary first. |
| `links` | `Link[]?` | no | absent | public | Max length 5. |
| `bigBrotherId` | `number \| null?` | no | absent | public | Existing ID, ≠ `id`, no cycle. |
| `deceased` | `DeceasedInfo` | yes | `{ isDeceased: false }` | public | Sub-fields include `birthYear`/`deathYear`, displayed only when deceased (decision D122). |
| `debrothered` | `DebrotherInfo` | yes | `{ isDebrothered: false }` | staff-only (mgr/admin); **whole record hidden from brothers** | Admin-only; hides the record from brothers, struck-through for managers/admins (D115, §9). |
| `unlisted` | `boolean` | yes | `false` | staff-only flag; **whole record hidden from peers** | Owner-settable (self-service); admins may also set it; managers may not (privacy change, §9). Hidden from brothers, badged "UNLISTED" for mgr/admin. Member fully retained — distinct from `debrothered` (decision D124, §9). |
| `hasHeadshot` | `boolean` | yes | `false` | public | |
| `headshotVersion` | `string?` | no | absent | public | Present iff `hasHeadshot`. |
| `privacy` | `PrivacyFlags` | yes | reachability flags `true`; `shareEmergency`/`shareSpousePartner` `false` | restricted | The toggle flags themselves are not shown to peers. Third-party-data toggles default off / opt-in (decision D93). |
| `allowNewsletterEmail` | `boolean` | yes | `true` | restricted | Pushed to Ghost; forced `false` when marked deceased. |
| `allowCommentReplyEmail` | `boolean` | yes | `true` | restricted | Pushed to Ghost; forced `false` when marked deceased. |
| `allowShareWithMITAA` | `boolean` | yes | `false` | restricted | Opt-in master contact-sharing switch (decision D89, §9). |
| `lastVerifiedDate` | `string?` | no | absent | restricted | YYYY-MM-DD; server-set by the verify action. |
| `verifiedBy` | `number?` | no | absent | restricted | Constitution ID of the most recent verifier; server-set with `lastVerifiedDate`. |
| `lastModified` | `string` | yes | server-set | restricted | ISO 8601 timestamp. |
| `newsletterConsentChangedAt` | `string` | yes | server-set | restricted | ISO 8601 timestamp; (re)written on every `allowNewsletterEmail` change. Drives the bidirectional Ghost reconcile (D103). |
| `adminNote` | `string?` | no | absent | staff-internal | Manager/admin read+write; not visible to owner or peers; not pushed to Ghost. |
| `ghostMemberId` | `string?` | no | absent | system (internal) | Ghost Admin-API member id; the handle for Book→Ghost member updates; backend-only, never sent to any client. |
| `deceasedConsentSnapshot` | `ConsentSnapshot?` | no | absent | system (internal) | Consent+verification captured when marked deceased; restored+cleared on un-mark (D80); backend-only, never sent to any client. |
| `debrotherConsentSnapshot` | `ConsentSnapshot?` | no | absent | system (internal) | Consent+verification captured when de-brothered; restored+cleared on reinstate (D80/D115); backend-only, never sent to any client. |

## 4. Class year

`classYear` is the 4-digit graduation year of the class the brother identifies with (the year they normally would have graduated with their pledge class — not necessarily their actual degree year). Stored as a number, or `null` when unknown.

`null` is used rather than a sentinel (`0` / `"UNKN"`) so that TypeScript forces every consumer to handle the unknown case explicitly instead of silently sorting or formatting a magic value. It displays as `'84` (apostrophe + last two digits) when known, and as `'??` — or is omitted entirely, depending on context — when `null`.

**Validation range:** `1890 ≤ classYear ≤ currentYear + 6`. The upper margin admits current undergraduates whose class year is a few years in the future.

**Population.** Every brother in Book is an initiated PBE member — an MIT undergraduate at initiation or an alumnus — so the recorded population is **adults (18+)**. Book therefore carries **no minor-consent machinery** (no parental-consent flow, no age-gating); the consent model in §9 is an adult opt-in/opt-out model throughout (decision P19).

## 5. Constructed / derived values (not stored)

These are computed from stored data, never persisted, so there is no denormalized copy to keep in sync.

### 5.1 Canonical Name

The standard PBE News reference form, built by a single shared function imported by both Book and the PBE News Linter:

- **Normal:** `First Last 'YY` — e.g. `James Smyth '84`.
- **Unknown class year:** `First Last` (no year).
- **Ambiguous:** when two or more profiles would render an identical canonical string, all of them append the Constitution ID in the house form — e.g. `James Smyth '84 (#5247)`.

**Why ID-only disambiguation:** the middle initial is unusable (many brothers have none), and a Sr./Jr. suffix can only ever distinguish a father and son — who can never share a class year, and therefore can never collide. Every real collision is between unrelated brothers who share a name and year, where only the Constitution ID separates them.

**Detecting ambiguity without a per-display search:** because the SPA (and the Linter) hold the entire dataset in memory, a single O(n) pass at load time builds a frequency map keyed on the *displayed* identity — `(firstName, lastName, yearToken)`, where `yearToken` is the two-digit year string or a constant marker for unknown. Rendering a name is then an O(1) lookup: a key whose count exceeds one is ambiguous. Keying on the displayed two-digit token (not the 4-digit year) means two genuinely distinct brothers whose names render identically — e.g. a `John Smith '84` from 1884 and another from 1984 — are both correctly disambiguated. No `nameIsAmbiguous` flag is stored; deriving it fresh avoids the staleness a stored flag would suffer on every edit or delete (consistent with how little-brothers are derived, §5.2).

### 5.2 Little Brothers

Each profile stores only its own `bigBrotherId` (the upward edge). The inverse relation — who chose this brother as their Big Brother — is derived by scanning the in-memory dataset, never stored, so the directed-tree data has a single source of truth.

## 6. The `users` and `majors` collections

### 6.1 `users`

Private per-user state, keyed by the same Constitution ID as the profile. UI preferences (font size, dark mode, column choices) are **not** here — they live only in client-side **`localStorage`** (decision D30) and do not follow the user across devices in MVP.

```typescript
type Role = 'brother' | 'manager' | 'admin';

interface User {
  id: BrotherId;                       // = the brother's Constitution ID; also the document ID
  role: Role;                          // default 'brother'
  stars: BrotherId[];                  // brother IDs this user has personally starred; default []
}
```

`stars` is writable only by the owning user, and a stars write is **scoped to the `stars` field exclusively** — never coercible into a `role` write on the shared `users` doc. `role` is writable only by an administrator (the **Change role** action — PRD §5.7.10), subject to a **server-enforced last-admin invariant**: the only remaining admin cannot be demoted (a direct API call must not be able to lock the org out of backup/restore, add/delete, role changes, and Ghost sync), and every role change is **audit-logged with before/after** (feeding the D101 forensic privileged-roster log). Both writes sit under the server-side **per-role write-field allowlist** — the write-side dual of the §9 read projection — plus the object-level predicate (`profileId == session.profileId OR role ∈ {manager, admin}`) that governs all writes; fields outside a role's allowlist are **rejected**, not silently dropped. Enforcement and the full capability matrix are in PRD §4 and ENGINEERING-DESIGN §1.4/§2 (decisions D19, D106).

### 6.2 `majors`

The controlled vocabulary for `Profile.majors`. One document per MIT course code, document ID = the code.

```typescript
interface Major {
  code: string;                        // e.g. "6-3"; the document ID
  displayName: string;                 // e.g. "Computer Science"
  active: boolean;                     // false = retired but still valid for historical profiles
}
```

Storing the vocabulary as Firestore data (rather than hard-coded in the build) lets it be edited without a code release as MIT's course numbers change. Profiles store only the `code`; the `displayName` is looked up from this collection in memory, so a name correction propagates everywhere and the stored profile JSON stays compact and meaningful. Retired courses (`active: false`) remain selectable so older brothers' majors stay valid, while the entry UI can de-emphasize them. The SPA loads this collection once at startup alongside the profile bulk-load.

### 6.3 `config` (app-level singletons)

A small collection of **singleton** configuration documents, each addressed by a fixed document ID. The sole MVP member is the **system banner** (decision D117):

```typescript
/** The optional admin-set, site-wide message banner (document ID "systemBanner"). */
interface SystemBanner {
  active: boolean;                     // default false — when true, the banner shows on every page
  message: string;                     // the banner text (plain text; trimmed; generous length cap)
  severity: 'info' | 'warning';        // selects styling; default 'info'
  updatedBy: BrotherId;                // the admin who last set it
  updatedAt: string;                   // ISO 8601 timestamp; server-set on each change
}
```

The banner is **read by every client** (so the active message renders for all roles) but **written only by an administrator** through the one live instance — a single authenticated write, not a bulk operation (decisions D83/D100). It is **not per-user dismissible** (it persists until an admin clears it by setting `active: false`), mirroring Ghost's announcement bar; Book and Ghost banners are independent and neither propagates to the other. This is **distinct from the maintenance page** (decision D118), which replaces the app when the system is down; the banner is shown while Book is fully operational. The collection can host further admin-set singletons later without a schema migration.

### 6.4 `bugReports`

User-submitted bug reports (decision D121), one document per report, created by `POST /api/bug-report` and reviewed by an administrator on the Admin page (ENGINEERING-DESIGN §6.1):

```typescript
interface BugReport {
  id: string;                          // server-assigned document ID
  submittedBy: BrotherId;              // the authenticated submitter (Book is members-only)
  submittedAt: string;                 // ISO 8601 timestamp; server-set
  page: string;                        // the SPA route the report was filed from (path + query)
  url?: string;                        // the absolute location, so an admin sees exactly where
  description: string;                 // free text; trimmed; capped at 2000 chars; treated as untrusted
  clientContext?: {                    // optional, non-PII technical context
    userAgent?: string;
    viewport?: string;                 // e.g. "1280x720"
    appVersion?: string;               // the SPA build hash / contract version
  };
  status: 'new' | 'reviewed';          // default 'new'
}
```

**Book is a triage-and-clear surface, not a bug tracker.** Real bug management happens in the team's external tracker; Book only *receives* reports and gives an admin a way to view, copy, and delete them (it exists as a viewer only because Book has no email and reading raw Firestore by hand would be cumbersome). The `status` is therefore a minimal **unread marker**, not a lifecycle: `new` = the admin has not yet seen it; `reviewed` = it has been displayed (the SPA marks reports reviewed after rendering the queue, one-way, via `POST /api/admin/bug-reports/mark-reviewed`) but not yet deleted. **Deletion is the terminal act** (`DELETE /api/admin/bug-reports/{id}`) — it removes the document entirely, so there is no stored "resolved"/"closed" state.

There is **no outbound email**: a report is persisted and an audit entry written (decision D61), keeping the admin's inbox out of the attack surface; the endpoint is **rate-limited** (decision D86, 5/min per session) and size-capped, and `description` is never interpolated into a dangerous sink. Reports are **admin-read only** and are not part of any profile projection.

## 7. Image assets (Google Cloud Storage)

Headshots and their thumbnails are binary objects, so they live in Google Cloud Storage, not Firestore (decision D8) — the profile document holds only `hasHeadshot` and the `headshotVersion` token. The schema of those objects:

- **Layout.** Two object paths per brother, addressed by ID and version:
  - `headshots/{id}/{version}.webp`
  - `thumbnails/{id}/{version}.webp`

  where `{id}` is the Constitution ID and `{version}` is the profile's current `headshotVersion`.
- **Versioning / caching.** `headshotVersion` changes on every upload, so each upload yields a fresh URL. The objects are therefore immutable and indefinitely cacheable, and a new upload busts caches simply by changing the URL (decision D9). GCS **object versioning** is enabled (decision D8), giving near-free point-in-time history that doubles as part of the backup story.
- **Dimensions / aspect.** Square 1:1. Headshot 512×512; thumbnail 96×96.
- **Formats.** Uploads accept JPEG and PNG; both the stored headshot and the derived thumbnail are encoded as **WEBP** for size.
- **Derivation.** The user crops the upload to the 1:1 frame client-side before it is sent (PRD); the backend stores the cropped headshot and precomputes the thumbnail from it. Only the cropped result is kept — re-cropping means re-uploading. There is **no "regenerate thumbnails" feature** (decision D114): a version's headshot and thumbnail are written as a matched pair (pointer-last, D98), so they never drift; should the thumbnail spec ever change, re-derivation from the retained 512² headshots is a one-off offline operator script, not a built feature.
- **Upload safety.** Uploads are validated server-side by **magic-byte inspection** (not the declared `Content-Type`) and bounded to **≈40 MP decoded** — width×height and total pixel count are checked before/at decode, with decoder memory/time limits — so a decompression-bomb image cannot exhaust the instance. The ceiling is set deliberately high so a genuine high-resolution headshot is never bounced back to the brother to shrink in an external editor. Decoding/transcoding runs in a **pinned, patched, least-privileged** imaging library (decision D107).
- **Write ordering (pointer-last).** Both GCS objects (the 512² headshot and the 96² thumbnail) are written **first**; the Firestore `headshotVersion` pointer is advanced **last**, so the pointer never names objects that do not yet exist. A partial failure leaves the profile on its prior version (no broken image), at worst orphaning the new objects (swept by the D94 lifecycle rule). Because `headshotVersion` is an **opaque token** (decision R16) rather than a read-then-increment counter, there is no read-increment race (decision D98; see ENGINEERING-DESIGN §5.1).
- **Access control.** The bucket is **private** (no public objects; object ACLs are never the access surface). Headshots and thumbnails are served members-only by the **Cloud Run backend** from that bucket, under the same origin at `/img/*` (Firebase Hosting rewrites the prefix to Cloud Run), gated by the **ordinary session cookie** — a coarse grant, since any authenticated brother may view any brother's photos (decision D23; see ENGINEERING-DESIGN §2.5). The SPA builds the immutable object URLs itself from `id` and `headshotVersion`. Because the app mediates the read, an `unlisted` or de-brothered brother's image is withheld from a brother (returns `404`, mirroring the record projection). If the session has lapsed at the absolute 4-hour cap (decision D22), an image read returns **`401`/`403`**; the SPA re-authenticates and **retries the image load** rather than rendering a broken image (decisions D109/D126; see ENGINEERING-DESIGN §2.5). This **replaced the Cloud CDN signed-cookie model** (and the external load balancer it required) — decision D126. Backup/restore of these objects follows the **offline-restore** model (decisions D100/D101) atop the GCS object versioning described above.

## 8. Validation rules

Applied on write (server-authoritative; the client validates the same rules for fast feedback).

- **`id`** — positive integer; unique across `profiles`; immutable once created.
- **`firstName`, `lastName`** — present, non-empty after trimming.
- **`classYear`** — integer in `[1890, currentYear + 6]`, or `null`.
- **`email`, `alternateEmail`** — match a basic email pattern (`name@domain.tld`). Stored **normalized** — lowercased, trimmed, Unicode-NFC — with only the normalized form persisted; the identical normalization is applied to the authentication identity (the Ghost JWT `sub`) at resolution, closing case/Unicode drift between Ghost and Book. No provider-specific (Gmail dot/plus) normalization. Email must be **unique across all profiles**, with primary `email` and `alternateEmail` sharing **one namespace** (no address appears twice anywhere in Book); uniqueness is enforced by the single authoritative instance's in-memory email→profile index (ENGINEERING-DESIGN §2.1, decision D97), and resolution **fails closed** — a normalized address that maps to more than one profile denies sign-in rather than guessing. `alternateEmail` is rejected unless `email` is also present.
- **`phone`, emergency `phone`** — permissive: digits plus `+ ( ) - .` and spaces; no strict E.164 requirement, to accommodate international numbers.
- **`address.country`** — must be a valid ISO 3166-1 alpha-2 code present in the bundled country list (e.g. `US`, `GB`, `CN`, `TW`). The two-letter code is stored; the display name is derived.
- **`address.stateProvince`** — a controlled vocabulary when `country` is `US` or `CA`: the value must be a valid 2-letter USPS state/territory code (including `DC` and the military codes `AA`/`AE`/`AP`) or a valid 2-letter Canadian province/territory code, stored as the code with the display name derived from a bundled list. For any other country (or when `country` is unset) it is **free text**. The entry UI renders a dropdown for US/CA and a free-text box otherwise (PRD §5.7). Like the ISO country list, the US/Canada subdivision lists are bundled build-time constants, not a Firestore collection (decision D37, amending D18).
- **`majors`** — array; each entry must be a `code` present in the `majors` collection; no duplicates; ordered with the primary major first.
- **`links`** — max 5; each `label` non-empty; each `url` validated on write against a **strict `http`/`https` scheme allowlist** (reject `javascript:`, `data:`, and every other scheme), and rendered as an anchor with `rel="noopener noreferrer"` — closing stored-XSS-on-click (decision D107).
- **`bigBrotherId`** — must reference an existing `profiles` document; must not equal `id`; must not introduce a cycle in the Big Brother tree.
- **`emergencyContacts`** — max 2; within each contact, `email` (if present) and `phone` (if present) follow the email/phone rules above.
- **Dates** (`lastVerifiedDate`, `deceased.dateOfDeath`) — valid `YYYY-MM-DD`.
- **`deceased.birthYear`, `deceased.deathYear`** (decision D122) — integer years. `birthYear` in `[1850, currentYear]`; `deathYear` `≤ currentYear` and, when `birthYear` is present, `≥ birthYear`. **`deathYear` is rejected when `dateOfDeath` is present** — the death year is then derived from the full date, and `deathYear` exists only to record a year-without-a-full-date death. Both are meaningful only on a deceased record, set/edited by managers and admins via the mark-deceased flow (PRD §5.7.7); `birthYear` is never collected for a living brother.
- **URLs** (`obituaryUrl`, `inMemoriamUrl`, link URLs) — valid URL restricted to the **`http`/`https` scheme allowlist** (the same rejection of `javascript:`/`data:`/all other schemes as `links`, decision D107).
- **`allowCommentReplyEmail`** — boolean; defaults `true`. Forced `false` (with `allowNewsletterEmail`) when a profile is marked deceased.
- **`newsletterConsentChangedAt`** — server-set ISO 8601 timestamp; (re)written on **every** change to `allowNewsletterEmail`, including the mark-deceased force-off and the D80 un-decease restore. It is the causal signal the Book↔Ghost newsletter reconciliation uses to resolve drift by most-recent-change-wins (decision D103; ENGINEERING-DESIGN §5.1).
- **Deceased mark / un-mark (snapshot & restore)** — Marking a profile deceased forces both consent flags (`allowNewsletterEmail`, `allowCommentReplyEmail`) to `false` and freezes verification (`lastVerifiedDate`/`verifiedBy`, decisions D28/D48). Because the deceased flag is **admin-reversible** for error-correction (decision D49), the prior consent flags and verification state are **snapshotted at mark-time** and **restored on un-marking** (the snapshot is cleared once restored) — so a mistaken mark-deceased does not silently and permanently unsubscribe a living brother from real Ghost mail (decision D80). The force-off and the restore each update `newsletterConsentChangedAt`.
- **De-brother mark / un-mark (snapshot & restore, decision D115).** Raising `debrothered.isDebrothered` (admin only) is a coordinated action with effects beyond this field: the record is projected out of the brother-role view entirely (§9), Book sign-in is denied for the resolved profile (ENGINEERING-DESIGN §2.1), and the **Ghost member is deleted via the Ghost-first delete path** (ENGINEERING-DESIGN §5.1; decision D98) — which also stops all newsletter/comment mail. Like mark-deceased, it is **reversible**: the prior consent and verification state is **snapshotted at mark-time** into a **system-internal field** (never sent to any client) and **restored on un-marking**, which **re-creates the Ghost member** via the Ghost-first create path (decision D96). The reconciliation audit treats a de-brothered profile as **expected to have no Ghost member** (no `missingGhostMember` drift, decision D99). De-brothered and deceased are orthogonal; both may be set.
- **`adminNote`** — free text; trimmed; a generous maximum length (e.g. a few thousand characters); no structural constraints.
- **`ghostMemberId`** — opaque string set only by the system (the Ghost create-push or the one-time migration loader); never accepted from the bulk-CSV import or a brother-facing edit. (`ghostMemberUuid` is no longer part of the schema — decision D81.)
- **Restore (offline) — structural validation.** A restored backup intentionally **bypasses the field-level edit rules above** (restore means "be exactly this snapshot," not "merge corrections," decision D63) but must pass **structural validation before it is applied**: big-brother **cycle detection**, **`id` uniqueness**, **email uniqueness** (normalized; primary + `alternateEmail` in one namespace, per D97), and **reference integrity** — so a corrupt or tampered backup cannot reintroduce a structurally broken database. Restore is an **offline** maintenance event (decisions D100/D101); see ENGINEERING-DESIGN §6.3.
- **Authorization (write-side).** Beyond these value rules, every write is gated server-side by a **per-role writable-field allowlist** — the write-side dual of the §9 read projection — plus an object-level predicate (`profileId == session.profileId OR role ∈ {manager, admin}`). Fields outside a role's allowlist are **rejected (422/403), never silently dropped**; the consent/privacy flags are **owner-only** (a manager editing another brother cannot write them); and all system/verification/Ghost fields (`id`, `role`, `lastVerifiedDate`, `verifiedBy`, `lastModified`, `newsletterConsentChangedAt`, `headshotVersion`, `adminNote`, `ghostMemberId`) are unwritable via PATCH/POST — set only by dedicated server actions (decision D106; ENGINEERING-DESIGN §1.4, API-SPEC §3).

## 9. Field visibility and projection

Every field carries a **visibility class** that the backend enforces by projecting each response down to the fields the requester may see (decision D5); the frontend never receives data the requester is not entitled to. Six classes:

- **public** — visible to all authenticated brothers: identity, names, class year, majors, links, employer, Big Brother, deceased status (including the `birthYear`/`deathYear` shown only when deceased, decision D122), and the headshot/thumbnail. (`spousePartnerName` is **not** public — it moved to the **toggle** class as third-party data, decision D93.)
- **toggle** — the protected contact *values*. Visible to the record's owner and to admins **always**; visible to other brothers **and to managers** only when the owner's corresponding share flag is `true`. (This is the Session-3 narrowing of decision D16: a field a brother has hidden is invisible to managers too — only admins, the override role, still see it. See decision D19.) The flags — the reachability toggles default `true`, the two **third-party-data** toggles default `false` / opt-in (decision D93):
  - `privacy.shareEmail` → `email`, `alternateEmail` (default `true`)
  - `privacy.sharePhone` → `phone` (default `true`)
  - `privacy.shareAddress` → the whole `Address` (default `true`)
  - `privacy.shareEmergency` → all `emergencyContacts` (default **`false`** — third-party data)
  - `privacy.shareSpousePartner` → `spousePartnerName` (default **`false`** — third-party data, decision D93)
- **restricted** — the flags, preferences, and housekeeping metadata: the `privacy` flags themselves, `allowNewsletterEmail`, `allowCommentReplyEmail`, `allowShareWithMITAA`, `lastVerifiedDate`, `verifiedBy`, and `lastModified`. Never visible to ordinary brothers; visible to the owner, managers, and admins, but **read-only for managers** — only the owner and admins may change a brother's consent and privacy settings, and `lastVerifiedDate` / `verifiedBy` / `lastModified` are server-set, never directly edited. Keeping `allowNewsletterEmail` and `allowShareWithMITAA` here (rather than in `users`) lets managers and admins receive them in the bulk download and use them as search/filter/sort columns, while still hiding them from ordinary brothers. So a manager can *see* a brother's privacy choices and verification dates (useful for coaching and for chasing stale records) without being able to *see through* an off-toggle to the protected value, or to *change* the brother's choices.
- **private** — never part of the directory payload at all; lives in the `users` collection: the user's `role` and `stars`.
- **staff-internal** — visible to, and read/write for, **managers and administrators only**; **not** visible to the owner or to peers. The sole member is `adminNote` — a free-text note for coordinating among staff and recording the history of manual changes, whose value depends on candor and therefore on the brother *not* seeing it. It is the first field the owner cannot see on their own profile; it lives in `profiles` (so it travels in the manager/admin bulk download) but is projected out for ordinary brothers and for the owner.
- **system (internal)** — never sent to any client in any projection; used only by the backend and by admin tooling/backups. The sole member here is `ghostMemberId` (the Ghost Admin-API member id, used to address Book→Ghost updates, ENGINEERING-DESIGN §5.1). (`ghostMemberUuid` was removed from the schema — decision D81.)

`allowNewsletterEmail` (may PBE News be emailed to this brother) and `allowCommentReplyEmail` (may Ghost email this brother about replies to their article comments) both default `true`, are **pushed to Ghost** — which actually sends the mail (ENGINEERING-DESIGN §5.1) — and are **forced to `false` when a brother is marked deceased**. `allowShareWithMITAA` (default `false`, opt-in — decision D89) is a **master switch** meaning "may the brother's own contact information be shared with MITAA": when `true`, the MITAA export includes the full own-contact set (email, phone, postal address) regardless of the brother-facing share-toggles, which target a different audience; when `false`, no contact information is shared, though name, class year, and public deceased status still flow (ENGINEERING-DESIGN §5.3). Mailman list-subscription flags remain intentionally out of the MVP schema; that integration stays deferred (decisions D11, D60). The full role/capability matrix is in PRD §4, and the projection is enforced server-side as described in ENGINEERING-DESIGN §2 (decisions D5, D19).

In effect the classes yield **three reading projections** over directory data, plus the staff/system fields layered on top: an ordinary **brother** sees public fields plus another brother's toggle fields where shared; a **manager** sees all of that plus every record's restricted flags, preferences, and dates (read-only) and the staff-internal `adminNote` (read/write), but still not the contact values behind an off-toggle; an **admin** sees everything, including those hidden contact values, and is the only role that can alter another brother's consent or privacy settings. The owner sees their own full record *except* `adminNote`. No client of any role ever receives `ghostMemberId`.

**De-brothered records — the one whole-record exception (decision D115).** A profile with `debrothered.isDebrothered = true` is **omitted from the brother-role projection in its entirety**: it appears in no brother's bulk download, search, filter, or export, and a brother who requests it by id receives `404`/`403`. **Managers and admins still receive it**, with the `debrothered` flag set so their UI renders the name struck through (PRD §5.6/§5.7). This is the only case where an *entire record*, not just a field, is projected away for a role. The `debrothered` flag is staff-visible (manager/admin); the consent/verification snapshot captured at mark-time (§8) is **system-internal** and never sent to any client. De-brothered records are also excluded from the MITAA export regardless of consent (§10).

**Unlisted records — a second whole-record exception (decision D124).** A profile with `unlisted = true` is likewise **omitted from the brother-role projection in its entirety** — it appears in no peer's bulk download, search, filter, or export, and a brother who requests it by id receives `404`/`403` — while **managers and admins still receive it**, with the `unlisted` flag set so their UI badges it **"UNLISTED"** (visually distinct from the de-brothered strike-through). Unlike de-brothering, unlisting is **non-punitive and membership-preserving**: the brother still signs in, still receives PBE News, and is **still included in the MITAA export** subject to his own `allowShareWithMITAA` — unlisting governs directory *listing* only, not any other sharing. It is **owner-settable** (self-service) and may also be set by an **admin**; a **manager cannot** set it, because changing another brother's privacy is admin-only (the restricted-class rule above). See decision D124; PRD §5.6.5/§5.7.3.

**The read is split (decision D82).** To keep the bulk payload **identical for all callers of the same role** (so it is cacheable and can never leak one caller's owner-level fields to another — the projection is the single server-side enforcement point), `GET /api/profiles` returns a **uniform per-role projection of every record**, including a plain role-projection of the *caller's own* record (so a brother's bulk copy of themselves shows only public + their own toggle values at brother visibility, never restricted/staff fields). The caller's **own full record** — their own off-toggle values, but never their own `adminNote` — is delivered **out of band** by a separate self-fetch (`GET /api/me`) that the SPA overlays onto its own row. Only the **brother-role** bulk projection is precomputed and cached (the ≈700-person audience where amortization pays); manager and admin projections are computed fresh per request. See API-SPEC §1 and ENGINEERING-DESIGN §1.4/§2.4.

## 10. CSV column names (export / bulk import)

The Manager/Admin export and the Admin bulk-import share one CSV format whose header row carries a unique name per field, with `id` as the first column (PRD admin section). The online bulk import is **deferred to post-MVP** (decision D100, ENGINEERING-DESIGN §6.5); this section remains the authority for the shared format — used by the live export now, and by an import whenever one runs. Canonical names below; the format, escaping (formula-injection neutralization), and the dedicated two-tier MITAA layout are settled in this section. Headshots and thumbnails are never included in CSV — only the backup function moves images.

**Formula-injection neutralization (all exports).** Every text cell whose value begins with `=`, `+`, `-`, `@`, a tab (`\t`), or a carriage return (`\r`) is prefixed with a single quote (`'`) before output (OWASP CSV-injection guidance), so a spreadsheet cannot execute a brother's name, note, or other free-text field as a formula. This applies to **both** the general role-projected export (decision D41) and the MITAA export (decision D90); a malicious-leading-character cell is covered by the §6.6 test plan (finding S9).

- **Scalars** use the field name verbatim: `id`, `firstName`, `middleName`, `lastName`, `fullLegalName`, `mugName`, `classYear`, `email`, `alternateEmail`, `phone`, `employerName`, `jobTitle`, `spousePartnerName`, `bigBrotherId`, `allowNewsletterEmail`, `allowCommentReplyEmail`, `allowShareWithMITAA`, `lastVerifiedDate`, `verifiedBy`, `adminNote`.
- **Address** flattens with a prefix: `address.street1`, `address.street2`, `address.street3`, `address.city`, `address.stateProvince`, `address.postalCode`, `address.country` (the ISO code).
- **Deceased** flattens: `deceased.isDeceased`, `deceased.dateOfDeath`, `deceased.birthYear`, `deceased.deathYear`, `deceased.obituaryUrl`, `deceased.inMemoriamUrl` (decision D122).
- **Debrothered** flattens: `debrothered.isDebrothered` — a **staff-only status column**: de-brothered records appear only in manager/admin exports (never a brother's, since the record is projected away for brothers, §9) and are **never** in the MITAA file (below, decision D115).
- **Unlisted** flattens: `unlisted` — a **staff-only status column** (like `debrothered`): unlisted records appear only in manager/admin exports (projected away for peers, §9). Unlike de-brothered records, unlisted records **are** included in the MITAA file subject to `allowShareWithMITAA` (decision D124).
- **Privacy** flattens: `privacy.shareEmail`, `privacy.sharePhone`, `privacy.shareAddress`, `privacy.shareEmergency`, `privacy.shareSpousePartner` (decision D93).
- **`majors`** — a single column holding a semicolon-separated list of codes, primary first (e.g. `6-3;15`).
- **`emergencyContacts`** — two fixed contact slots: `emergency1.name`, `emergency1.phone`, `emergency1.email`, `emergency2.name`, `emergency2.phone`, `emergency2.email`.
- **`links`** — five fixed link slots: `link1.label`, `link1.url`, … `link5.label`, `link5.url`.
- **Not exported:** `hasHeadshot`, `headshotVersion`, `lastModified`, `newsletterConsentChangedAt`, and `ghostMemberId` are system-managed and excluded from the editable CSV (the Ghost identifier is set only by the Ghost create-push or the one-time migration loader, never via import).
- **Export-only (ignored on import):** `lastVerifiedDate` and `verifiedBy` appear in manager/admin exports as **read-only reporting columns** but are **ignored on import** — verification is system-managed and recomputed by the import-as-non-owner-edit rule (ENGINEERING-DESIGN §6.5, decisions D28, D68). Including `verifiedBy` restores symmetry with `lastVerifiedDate`: it is manager/admin-visible on screen, so omitting it from the export was an inconsistency (finding C8).
- **Staff-only:** `adminNote` appears only in manager/admin exports (it is projected out for ordinary brothers) and is **never** included in a MITAA-bound file.

**MITAA export (dedicated, consent-aware).** The MITAA file is produced by a **separate admin export** (decision D90), not the general export, because it needs a **two-tier** layout that a single consent-filtered CSV cannot express:

- **Tier 1 — all brothers:** identity (`id`, names, `classYear`) and public-death columns (`deceased.isDeceased`, `deceased.dateOfDeath`, `deceased.deathYear`, `deceased.inMemoriamUrl`) flow for **every** record — this is MIT's own data / the join key, and the reciprocal of the import's mortality-catching value (decisions D59, D89).
- **Tier 2 — consenting brothers only:** the contact set (`email`, `phone`, `address.*`) is populated **only** where `allowShareWithMITAA = true`, and left **blank** otherwise.
- **Never:** `emergencyContacts`, `adminNote`, the privacy/consent flags, and all system fields are excluded from the MITAA file entirely.
- **De-brothered brothers are omitted entirely** from the MITAA export — even the Tier-1 identity/public-death columns that otherwise always flow — regardless of `allowShareWithMITAA`: a de-brothered person's data is shared with no one outside staff (decision D115).

Formula-injection neutralization (above) applies to the MITAA file as it does to the general export. Automated MITAA exchange stays deferred (decision D11); this is a manual, occasional admin operation.

## 11. Open items carried forward

- **State / province controlled vocabulary** — *resolved in Session 4b (decision D37):* `stateProvince` is a bundled controlled vocabulary (2-letter code, display derived) when `country` is `US` or `CA`, and free text otherwise. See §3.2 and §8.
- **Majors maintenance UI** — *resolved in Session 6a (decision D69):* the `majors` vocabulary is maintained via a version-controlled source file applied by an idempotent seed/reconcile script (which also performs the initial load); a runtime admin curation UI is deferred to post-MVP. *(Linear: OFC-166)*
- **CSV import vs. verification fields** — *resolved in Session 6a (decision D68):* the admin bulk-CSV import is treated as a per-row non-owner edit (a changed row unverifies the profile; unchanged and deceased rows keep status), and `lastVerifiedDate`/`verifiedBy` are ignored on import (exportable as read-only columns). See ENGINEERING-DESIGN §6.5.
- **Mailman subscription fields** — *remain deferred (decisions D11, D60).* Mailman integration is out of MVP; if a list later migrates into Ghost, supporting multiple newsletters — generalizing `allowNewsletterEmail` into a per-newsletter subscription set over a small "newsletters" vocabulary — is the schema change required, itself a deferred item (PRD §3.2).
