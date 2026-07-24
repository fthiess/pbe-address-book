# PBE Address Book ("Book") — API Specification

**Status:** Draft · Authored Session 3 (2026-06-03); amended Session 5 (2026-06-05) — added the first-party Linter roster endpoint and the service-account auth exception (§8, decision D58); amended Session 6c (2026-06-07) — close-out consistency pass (example data replaced with the fake exemplar "James Smyth '84 (#5247)"; planning-vault references repointed to the graduated `DECISIONS.md`); amended in the **resolution / propagation pass** (2026-06-11) — the split read with `/api/profiles` served `no-store` (D82/D95); auth-token hardening (alg/kid pin + single-use nonce + redirect allowlist, D104), email normalization at resolution (D97), create-if-absent first login (R20); the server-side write-field allowlist + object-level predicate (D106) and non-destructive 401 mid-edit recovery (D109); delete-cascade ordering (D98); `arrayUnion`/`arrayRemove` stars (R17); headshot upload bounding + pointer-last + opaque `headshotVersion` (D98/D107/R16); the in-code subject-pinned roster auth (D78) with a `contractVersion` (D112) and the optional-absent example fix (C11); the bulk-import/restore descoping (D100/D101) plus the Ghost-sync discrepancy-report JSON shape (closing the C4 facet); and the removal of the thumbnail-regenerate endpoint (D114). Amended in the **post-resolution amendments pass** (2026-06-12) — the de-brother action `PUT /api/profiles/{id}/debrothered` and its sign-in denial (D115), the system-banner endpoints and the bug-report endpoint and the maintenance `503` in a new §10 (D117/D121/D118). Amended in the **early-feedback pass** (2026-06-24) — the **Unlisted** whole-record projection exception on `/api/profiles` and `/api/profiles/{id}` (D124), Firestore-persisted sessions and login nonce so cold starts don't force re-login (D125), and the deceased `birthYear`/`deathYear` fields in the shared `Profile` (D122). Defines the REST surface between the SPA and the backend: endpoints, request/response shapes, authentication, authorization, field-level projection, and the optimistic-concurrency contract.

**Canon:** This is a *delivered* artifact and lives in the code repo (`pbe-address-book/`). It is the companion to `ENGINEERING-DESIGN.md` §2 (Authentication & Security) and §4 (API), `DATABASE-SCHEMA.md` (the `Profile` shape), and `PRD.md` §4 (capability matrix). Decision rationale lives in `DECISIONS.md` (the decision log in this build's docs; the API surface is shaped by D19–D27 and the resolution-pass decisions D78, D82, D95–D113).

## 1. Conventions

### 1.1 SPA routes vs. API endpoints

User-facing paths and data endpoints are different namespaces served under **one origin** — Firebase Hosting fronts `book.pbe400.org` and rewrites the API and image prefixes to Cloud Run (decision D126; there is no external load balancer or Cloud CDN):

- `/api/*` → the Node/TypeScript backend on Cloud Run. **Every endpoint in this document lives under `/api`.**
- `/img/*` → headshots/thumbnails, served by the **Cloud Run backend** from a private GCS bucket (decision D126; see §6).
- everything else (`/`, `/brother/{id}`, `/admin`, `/auth/callback`, …) → the static SPA bundle on Firebase Hosting. These are client-router paths with History-API URLs, **not** API endpoints.

### 1.2 Transport, format, auth

- **HTTPS only.** Request and response bodies are `application/json` (UTF-8), except the headshot upload (§6), which is the raw image.
- **Authentication** is the Book **session cookie** established through the Ghost auth bridge (see ENGINEERING-DESIGN §2). The cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, **host-only** (no `Domain` attribute, so no sibling `pbe400.org` subdomain can read it — decision D107), and the session has a 4-hour server-side lifetime. The session record is **persisted in Firestore** (not instance memory), so a scale-to-zero cold start does **not** end a live session and force re-login (decision D125; ENGINEERING-DESIGN §2.3). The **one exception** is the first-party Linter roster endpoint (§8), authenticated by a Google service-account identity token rather than a cookie; there is otherwise **no** API-key or third-party-token mechanism in MVP (decisions D27, D58).
- A request with no valid session receives **401**. For a *read*, the SPA sends the user through the bridge. For a **mutating request mid-edit** — the absolute 4-hour cap (decision D22) can lapse during a long edit — the SPA does **not** follow a redirect mid-XHR and discard the work: it preserves the in-progress form, re-authenticates in a **child window**, and resumes the same write carrying its original `If-Match` (decision D109; ENGINEERING-DESIGN §2.6). An authenticated request the caller's role does not permit receives **403**. An image read under `/img/*` whose session has lapsed likewise returns **401**/**403**, on which the SPA re-auths and retries the image rather than rendering a broken image (decisions D109/D126; §6).

### 1.3 Field-level projection

Every response carrying profile data is projected to the fields the caller's role and the record's privacy settings permit (decisions D5, D19; see DATABASE-SCHEMA §9). The backend *omits* disallowed fields; it never returns a value the caller may not see. Brothers and managers receive the same contact-value projection; managers additionally receive the restricted flags/preferences/dates (read-only); admins receive everything. Two **whole-record** exceptions remove an *entire* record (not just fields) from the **brother-role** projection: a **de-brothered** record (decision D115) and an **Unlisted** record (decision D124); both still reach managers and admins, flagged. See §3 and DATABASE-SCHEMA §9.

### 1.4 Optimistic concurrency

Each profile carries a concurrency token — Firestore's server-authoritative `updateTime`, surfaced as an opaque **`ETag`** on `GET`. Any write that modifies an existing profile **must** send the token back in an **`If-Match`** header. The backend performs the write as a single conditional operation against that token; if the stored record has changed since the caller read it, the write does not happen and the backend returns **412 Precondition Failed**. Granularity is document-level: any change to the record triggers the 412, regardless of which fields differ. (Conflict-resolution UX — repull, preserve the user's edits, show which fields changed — is described in PRD §4 / ENGINEERING-DESIGN §2.)

**Wire format (decision N46).** The `ETag` is emitted as a **quoted** entity-tag per RFC 9110 §8.8.3 — e.g. `ETag: "1751490000.123456000"` — and the backend **normalizes an incoming `If-Match`** by stripping an optional weak-validator `W/` prefix and the surrounding quotes before it compares. This keeps the round-trip stable when an intermediary (Firebase Hosting fronting Cloud Run, D126) or the browser quotes or weakens the tag in transit; without it, a rewritten tag would fail the precondition and every legitimate save would return a spurious 412. The value *inside* the quotes is Firestore's `updateTime` as `<seconds>.<nanoseconds>`; a token that does not match `^\d+\.\d+$` (a bare word, `*`, a truncated value) is treated as a failed precondition (**412**), never allowed to escape as a **500**. Internally the server always deals in the raw token — the quoting is purely the wire representation. A re-implementing client (or any caching/proxy layer placed in front of `GET`/`PATCH /api/profiles/{id}`) must therefore treat the tag as quoted and echo it verbatim; the server does the un-quoting.

### 1.5 Error model

Errors return the appropriate HTTP status and a JSON body:

```json
{ "error": "stale_write", "message": "This record changed since you loaded it." }
```

| Status | Meaning in Book |
|---|---|
| 400 | Malformed request (bad JSON, missing required field). |
| 401 | No valid session — send the user through the bridge. |
| 403 | Authenticated, but the caller's role may not do this. |
| 404 | No such profile / resource. |
| 409 | Conflict — e.g. `POST /profiles` with an `id` that already exists. |
| 412 | Stale write — the `If-Match` token did not match (§1.4). |
| 422 | Validation failed (see DATABASE-SCHEMA §8); body lists the offending fields. |
| 428 | A mutating profile request omitted the required `If-Match` header. |
| 500 | Unexpected server error. The body is **generic** — `{ "error": "internal", "message": "Something went wrong." }` — never the underlying exception message; the real error (with a trace id) is logged server-side only, so a Firestore/GCS internal detail cannot leak to the client (decision N55). |
| 503 | Service unavailable. Two uses: the admin Ghost reports return `{ "error": "ghost_unconfigured" }` when the Ghost Admin API is not configured (§7, N69); and a cached SPA that gets a `5xx`/`503` (or any unreachable backend) shows its generic maintenance/outage page — **no** maintenance-flavored body or planned/unplanned distinction (decision D118 as simplified by N69, §10). |

## 2. Authentication & session

### `POST /api/auth/session`
Completes the auth bridge. Called by the `/auth/callback` SPA page, which reads the Ghost-issued JWT from the URL fragment and POSTs it here.

- **Auth:** none (this is how a session is created), but the request is bound to a Book-initiated flow by a single-use nonce (below).
- **Request:** `{ "token": "<Ghost members JWT>", "state": "<single-use nonce>" }`
- **Behavior:** verifies the JWT against Ghost's JWKS (`pbe400.org/members/.well-known/jwks.json`) — signature, `aud`, `iss`, `exp` — with the **algorithm and key id pinned** to Ghost's asymmetric key, **rejecting `alg:none` and every symmetric algorithm** (decision D104); verifies the **single-use `state` nonce** issued at flow initiation and consumes it; extracts the member email from `sub` and **normalizes it** (lowercase, trim, Unicode-NFC — the same normalization the stored `email` uses, decision D97) before resolving it to a `profiles` document. On first successful match, creates the brother's `users` document with `role: "brother"` using **create-if-absent** semantics (a transaction, or `create()` that treats "already exists" as success) so two near-simultaneous first logins cannot race (finding R20). Sets the session cookie with the 4-hour lifetime (this one cookie also authenticates the same-origin `/img/*` image reads — decision D126; there is no separate CDN cookie).
- **Response 200:** `{ "profileId": 5247, "role": "admin", "stars": [5012, 5305] }`
- **Errors:** `401` (token missing/expired/invalid signature/forbidden algorithm, or a missing/replayed `state` nonce). `403 { "error": "unlinked_member" }` when the normalized email matches no profile — the SPA shows the "contact an administrator" message; `403 { "error": "ambiguous_member" }` if it resolves to more than one profile (fail-closed, decision D97); `403 { "error": "debrothered" }` if the resolved profile is **de-brothered** — sign-in is denied and the SPA shows the "contact an administrator" message (decision D115).

> **Flow initiation & nonce (decision D104).** Before redirecting to the Ghost Portal, the SPA obtains a **single-use, server-stored `state` nonce** from Book and carries it through the bridge; every redirect target in the bridge (the Portal `return` URL and the callback URL) is **hardcoded/allowlisted**, not caller-parameterizable. The nonce ties the callback to a Book-initiated request (anti-forgery), composing with D20's fragment-carried token (anti-leakage). The nonce store and the redirect allowlist are detailed in ENGINEERING-DESIGN §2.1/§2.7.

### `GET /api/me`
The caller's own private state **and own full profile**, used by the SPA on load. This is the self-fetch half of the split read (decision D82): the bulk `GET /api/profiles` carries only a *plain role-projection* of the caller's own record, and the SPA overlays the full own record returned here onto its own row.

- **Auth:** any authenticated user.
- **Response 200:** `{ "profileId": 5247, "role": "manager", "realRole": "admin", "impersonating": true, "stars": [5012, 5305], "ghostMemberUuid": "4fa3e4df-…", "profile": { /* the caller's own full Profile — own off-toggle contact values, but never their own adminNote */ } }`
- **Caching:** served **`no-store`** — like `/api/profiles`, this response now carries the caller's own contact values, so D95's no-disk-PII rationale applies.
- **`ghostMemberUuid` (decision D137).** The caller's Ghost member `uuid`, which the SPA uses as its Mixpanel `distinct_id` — the same key pbe400.org has identified on since 2026-05-27, so one brother is one Mixpanel person across both halves of the system. Read from the **caller's own session**, never from a profile record, so it is structurally impossible to return another member's; it is a sibling of `profile`, not a field inside it, and therefore never passes through the per-role projection. Note it is **not** `ghostMemberId` — Ghost's `id` and `uuid` are different fields, and `ghostMemberId` is `system-internal` and always stripped. **The key is absent** whenever the sign-in lookup failed or found no Ghost member: the server fetches it from the Ghost Admin API at session creation and fails soft, because sign-in must never be blocked by an analytics concern. Clients must treat it as optional and skip `identify()` when it is missing rather than substitute another value.
- **`role` vs. `realRole` (decision N31).** `role` is the **effective** role — the projection the caller is currently being served, which equals `realRole` unless a "View as" impersonation is active. `realRole` is the immutable real role and `impersonating` is `role !== realRole`. The SPA gates its UI on `role`, but the masthead's "View as …" / "Stop viewing" controls key on `realRole`, so the way back is always available. `profile` is the role-independent self-view, unchanged by impersonation.
- **Errors:** `401` if no/expired session.

### `POST /api/me/impersonate` · `DELETE /api/me/impersonate`
"View as" role impersonation — a step-**down** testing overlay (decision N31). `POST { "role": "brother" | "manager" }` sets the session's **effective role** so the lower projection is genuinely fetched and the lower powers genuinely enforced (`/api/profiles`, `/api/profiles/{id}`, the PATCH capability gates, and `/api/exports` all read the effective role); `DELETE` clears it, returning to the real role.

- **Auth:** any authenticated user; the step-down is checked on the **real** role.
- **Behavior:** `POST` requires a strict step-down (admin → manager/brother, manager → brother); escalation or same-role is **`403`**, never applied. `DELETE` is always permitted (it can only *restore* powers), so a caller can never lock themselves out. Both transitions are **audited** (decision D61). Identity (`profileId`) is unchanged — only the role. The SPA reloads after either call so the bulk directory re-downloads at the new projection.
- **Response 204** on success.
- **Errors:** `400` (unknown/missing role on `POST`); `401` (no session); `403` (not a permitted step-down).

> Impersonation is **available in production**, not staging-only: an admin already sees all data, so stepping down only *restricts* their view — useful for support ("what does this brother see?") and for exercising every later projection/permission change without a second test account.

### `POST /api/auth/signout`
Clears the Book session (decision D95, reversing D24's "no logout"). Mirrors Ghost's avatar-menu sign-out in Book's top-right.

- **Auth:** **none required** — the endpoint is deliberately *ungated* (decision N55). Behind the session gate, a session already past the 4-hour cap would `401` before the cookie could be cleared, stranding a dead cookie in the browser; sign-out must work regardless. It remains rate-limited.
- **Behavior:** invalidates the server-side session **if the cookie still resolves to one**, clears the session cookie unconditionally (and may emit `Clear-Site-Data`).
- **Response 204** either way.

> The session cookie also clears on browser close, and the 4-hour cap bounds the rest (decision D22); the explicit sign-out is an expected affordance, while `no-store` (decision D95) is the load-bearing no-residue mechanism.

## 3. Profiles

### `GET /api/profiles`
The bulk download — the cornerstone of the app.

- **Auth:** any authenticated user.
- **Behavior:** returns **every** profile as one JSON array, each projected to a **uniform per-role projection** — *including* the caller's own record, which appears here only at the caller's plain role visibility (a brother's own row carries public + own-toggle values, never restricted/staff fields). The caller's **own full record** is fetched separately via `GET /api/me` and overlaid by the SPA (the split read, decision D82). Because the payload no longer varies per *user* — only per *role* — it is identical for all callers of the same role and cannot leak one caller's owner-level fields to another. The **brother-role** projection is precomputed and served from the **backend's in-memory cache** (decision D7); manager and admin projections are computed fresh per request. Contains **no image bytes** — only `hasHeadshot` and `headshotVersion`, from which the SPA builds the image URLs (decision D9). Headshots and thumbnails are fetched separately, served by the backend from a private bucket (decision D126; §6).
- **Whole-record omissions (brother role):** a **de-brothered** (decision D115) or **Unlisted** (decision D124) record is absent from the brother-role array entirely (it does not exist from a brother's vantage); managers and admins receive it, with the `debrothered` / `unlisted` flag set.
- **Caching:** served **`Cache-Control: no-store`** — the payload is real PII (every brother's name, plus shared emails/phones) and must never persist to a shared machine's disk; it is held only in memory while the tab is open and re-fetched on the next fresh load. This **supersedes D76's read-side conditional-GET/`304` caching** (decision D95); the write-side `If-Match`/`updateTime` OCC of §1.4 is unaffected.
- **Response 200:** `{ "profiles": [ { /* projected Profile */ }, … ], "majors": [ { /* Major */ }, … ] }`
  - The `majors` vocabulary is bundled into the same payload so the SPA can resolve major codes to display names in memory (DATABASE-SCHEMA §6.2).
- **Note:** a multi-ID `?ids=` filter is **not** implemented — the SPA bulk-loads everything, and single-record refetch is covered below. A query API is part of the deferred external API (decision D27).

### `GET /api/profiles/{id}`
A single projected record. Used for deep-link refresh and for the repull after a 412.

- **Auth:** any authenticated user.
- **Response 200:** a single projected `Profile`, with an `ETag` header carrying the concurrency token (§1.4).
- **Errors:** `404` if no such brother. For a **brother**, a **de-brothered** (decision D115) *or* **Unlisted** (decision D124) record is projected away and returns `404` (it does not exist from a brother's vantage); managers and admins receive it normally.
- **Caching:** served **`Cache-Control: no-store` on *every* branch** — the `200` (real PII, D95) **and** the error responses (`404`/`401`/`400`). This read's visibility is **per-role**: the same URL is a `404` for a brother and a `200` for an admin, so a cacheable `404` could be replayed by a shared cache to a higher-role caller and the record would "disappear" for them (decision N75). Firebase Hosting injects a default `Cache-Control: max-age=600` on `/api/**` rewrite responses that set none, so the `no-store` must be explicit on the error paths, not just the success path (this manifested as OFC-192; overlaps OFC-212).

### `POST /api/profiles`
Create a brother in one atomic write — a **Book-only** record; it never touches Ghost. **Add Brother is a two-step create (decision N71, OFC-201):** a small **essentials form** (`/brother/new`) collects only the **mandatory** identity fields — the Constitution `id`, first/last name, and class year — POSTs them here, and then hands the admin to the **regular `/brother/:id/edit` page** to fill in everything else. (This replaces the earlier "complete Profile body, no empty-then-fill step" design; the created record is always *valid* because the always-required fields are exactly the essentials collected, so there is no junk-skeleton record and no second parallel create form to maintain.)

**Email is not a create field (decision N96, OFC-232).** Email is optional and belongs on the edit page, where adding it is what mints the brother's Ghost member (decision D133); collecting it here — and minting a member at create time — was an earlier mistake (N71/N72). So the create is always Book-only and the Ghost create/delete logic lives on exactly one surface, the `PATCH` (below).

- **Auth:** **admin only.**
- **Request:** a `Profile` body carrying at least the caller-supplied Constitution `id` (never auto-assigned; it is the brother's physical Constitution signature number) and the always-required fields (`firstName`, `lastName`, `classYear`). A **partial** body is accepted — the server fills the schema privacy defaults and the status flags, so unsent fields take their defaults. A body carrying a non-empty **`email`** is **rejected `422`** (email belongs on the edit page — decision N96), not silently dropped. Client-sent **protected / server-managed** fields (`deceased`, `debrothered`, `hasHeadshot`, `headshotVersion`, `lastVerifiedDate`/`verifiedBy`, `lastModified`, `newsletterConsentChangedAt`, `ghostMemberId`) are **ignored**, not honored, and set by the backend.
- **Book-only create:** no Ghost step. The atomic Firestore `create()` runs under the per-record lock with an in-lock existence re-check; the record is created with no `ghostMemberId`. The reconciliation audit does **not** flag a no-email record as `missingGhostMember` (a no-email brother is expected to be Ghost-less). The Ghost member is minted later, on the email-adding `PATCH` (below, decision N96).
- **Response 201:** the created, projected `Profile`, with an `ETag` header.
- **Errors:** `409` if `id` already exists (the atomic Firestore `create()` is the authoritative guard, with a fast in-memory pre-check); `422` on validation failure (including a missing/invalid `id`, **or an email in the body**); `403` for a non-admin.
- **Headshots:** optional and uploaded separately (§6) — a new profile begins with `hasHeadshot: false` and is complete and valid without a photo.

### `PATCH /api/profiles/{id}`
Partial edit — the normal save path from the profile page. There is no `PUT` for profiles (decision D24).

- **Auth:** owner (own record), manager, or admin, enforced on **two orthogonal axes** (decision D106). **Object-level:** the server checks `request.profileId == session.profileId OR session.role ∈ {manager, admin}` *before* the write — a bare "is authenticated" check would be an IDOR, since Constitution IDs are contiguous guessable integers. **Field-level:** a **positive per-role writable-field allowlist** (the write-side dual of the §1.3 read projection); a field outside the caller's allowlist is **rejected**, never silently ignored. A manager may not set another brother's `privacy` flags, `allowNewsletterEmail`, `allowShareWithMITAA`, or `unlisted` — those are **owner-only** (an admin may also set them on another brother; a manager may not — `unlisted` per decision D124); and all system/verification/Ghost fields (`id`, `role`, `lastVerifiedDate`, `verifiedBy`, `lastModified`, `newsletterConsentChangedAt`, `hasHeadshot`, `headshotVersion`, `ghostMemberId`, `deceased`, `debrothered`) are unwritable via PATCH by *every* role, set only by their dedicated server actions (verification via `POST …/verify`; the deceased state via `PUT …/deceased`; the de-brother state via `PUT /api/profiles/{id}/debrothered`, below — decision D115; the headshot pointer via the §6 upload pipeline). The staff-internal `adminNote` is PATCH-writable by managers and admins only, never the owner (the shipped capability matrix's `staff` class — DECISIONS N10; an earlier draft of this list misplaced it among the protected fields). **Record-aware narrowing (decision N70, OFC-206):** the field-level allowlist is further narrowed by the record's own privacy flags — a **manager** may not write a `toggle` field (`email`/`alternateEmail`, `phone`, `address`, `emergencyContacts`, `spousePartnerName`) whose owner has the governing share-flag **off**, because the read projection hides that field's value from the manager and a write would be a blind overwrite of data they cannot see. Owners (their own record) and admins (who see through every toggle, D19) are unaffected; a rejected field is a `403`, not a silent drop.
- **Headers:** `If-Match: <token>` **required** (§1.4).
- **Request:** a partial `Profile` — only the changed fields.
- **Response 200:** the updated, projected `Profile`, with a fresh `ETag`.
- **Verification side-effect (decision D28):** when the PATCH actually changes content and the profile is **not** deceased, the server adjusts verification automatically — an edit by the **owner** auto-(re)verifies it (`lastVerifiedDate = today`, `verifiedBy =` the owner); an edit by a **manager/admin on another brother's** profile clears verification if it was verified, and leaves it unverified otherwise. Deceased profiles are exempt (verification unchanged). The unverify is server-enforced; the manager-facing "saving will mark this unverified" warning is client-side courtesy only — there is no force flag.
- **Ghost email lifecycle (decisions D96/N65/D133/N96) — Ghost-first-gated:** the PATCH is the **sole** surface that creates or deletes a brother's Ghost member, keeping it in step with whether he has a usable email (the email↔Ghost-record invariant — a brother has a member iff living + not-de-brothered + has a usable email). Before committing, the server takes exactly one Ghost action, chosen from the `stored → next` transition:
  - **create** — the email is *added* to a living, non-de-brothered, Ghost-less brother: mint the Ghost member (`send_email=false`, honoring his current `allowNewsletterEmail`) and fold the fresh `ghostMemberId` into the same write (decision D133);
  - **delete** — the email is *cleared* on a brother who had a member: delete the member and drop the `ghostMemberId` (decision N96);
  - **update** — a brother who keeps his member: push the changed pushed fields (`email`, a Canonical-Name input — `firstName`/`lastName`/`classYear`, or `allowNewsletterEmail`) as a **diff** addressed by `ghostMemberId` (the prior N65 behavior);
  - **none** — a Book-only brother stays Book-only, or no pushed field changed: **no** Ghost call.
  Create and delete fire only when the **email itself changes**, so an unrelated edit (a phone change) never mints or deletes a member. Every case is Ghost-first: Ghost must accept before Book commits, or the save fails with a `502` and the record is untouched. A **deceased** or **de-brothered** brother is never given a member here (both are Ghost-less by invariant).
- **Errors:** `428` if `If-Match` is missing; `412` if stale; `403` if the caller may not edit this record or included a field outside their powers; `422` on validation failure — **including an added *or changed* email that collides with an existing Ghost member**, returned as a field issue on `email` (a permanent collision an admin must reconcile, not a retryable outage — decisions N96/N114, Option B; the collision is caught on both the create and the update PUT — Ghost `422`s each, verified against ghost-staging); `409 { "error": "last_admin" }` if the edit would strip the **sole usable admin's** usable email (email is the only usability factor an edit can touch — role/deceased/de-brothered are protected against PATCH; decision D130); `404` if no such brother; `502 { "error": "ghost_update_failed" | "ghost_create_failed" | "ghost_delete_failed" }` if the Ghost-first step of the email lifecycle fails (Book untouched — decisions N65/N96).

### `DELETE /api/profiles/{id}`
- **Auth:** **admin only.**
- **Behavior:** deletes across Firestore, GCS, and Ghost in a fixed order so a partial failure leaves a benign state (decision D98). The **last-admin invariant is checked first** (decision D106; DECISIONS N49): deleting the only remaining admin is rejected (`409 last_admin`) **before** the Ghost-first step, so a rejection leaves Ghost, GCS, and Book untouched — the delete-path dual of the `PUT /api/profiles/{id}/role` guard, and the same lockout it prevents. The check is a server-side in-memory `ProfileCache.adminCount()` (decision D128, amending D51/D106 — no longer a Firestore `users where role == admin` query); it is a pre-check, not transactional (the delete spans Ghost/GCS/Firestore), which is acceptable at `--max-instances=1` where delete is a rare action. Then the **Ghost member is deleted first** (synchronous, decision D96); if that fails the delete **aborts cleanly** (Book untouched, admin retries). Then the Book-side steps run, each **idempotent** so a re-run completes a partial delete: the GCS image objects, the `users` document, and the `profiles` document. Before deleting, the server **scrubs inbound references** in the in-memory dataset — clearing any `bigBrotherId == id` and removing `id` from any `users.stars` — so the delete leaves no dangling references (decision D98); graceful rendering of any straggler is the backstop. No dedicated orphan-sweep job: residue is covered by the D94 GCS lifecycle and the D55/D99 reconciliation audit. Finally, the deleted brother's **live sessions are revoked** so a surviving session cannot keep reading after the record is gone; the audit entry carries the `sessionsRevoked` count (decision N53).
- **Response 204.**
- **Errors:** `404` if no such brother; `409 { "error": "last_admin" }` if the target is the only remaining admin (the delete would lock the org out); `502 { "error": "ghost_delete_failed" }` if the Ghost-first step fails (Book is left unchanged).

### `POST /api/profiles/{id}/verify`
Stamp the record as freshly verified. A dedicated action (not a `PATCH`) so the timestamp and verifier are **server-set** and cannot be forged by the client.

- **Auth:** owner, manager, or admin (the UI shows role-specific confirmation copy; PRD §4).
- **Behavior:** sets `lastVerifiedDate = today` and `verifiedBy =` the authenticated caller's Constitution ID. Does not change any other field.
- **Response 200:** `{ "lastVerifiedDate": "2026-06-03", "verifiedBy": 5247 }`, with a fresh `ETag` (the verify counts as a write).
- **Errors:** `404` if no such brother.

> Profile *edits* also affect verification automatically (the `PATCH` side-effect above, decision D28). This explicit action covers the cases edits do not: the owner confirming with nothing to change, and a manager/admin re-verifying after an edit (with the cautioned copy). Headshot writes (§6) deliberately do **not** participate in this coupling (DECISIONS N42).

### `PUT /api/profiles/{id}/deceased`
Raise, edit, or clear a brother's **deceased** state — the mark-deceased action behind the Profile page's guided flow (decisions D49/D80/D122; DECISIONS N40, which closed this endpoint's spec gap). A dedicated action (not a `PATCH` field) because raising it has coordinated consent side-effects, and the `deceased` field is `protected` from PATCH by every role.

- **Auth:** **manager or admin.**
- **Request — raising or editing (`true`):** `{ "deceased": true, "dateOfDeath": "2026-01-15", "deathYear": 2026, "birthYear": 1948, "obituaryUrl": "…", "inMemoriamUrl": "…" }` — the flag plus the five D122 deceased fields (all five optional per the schema's rules, including the `deathYear`⊕`dateOfDeath` mutual exclusion, validated by the shared validator). Because `PATCH` rejects the `deceased` field entirely, **later staff corrections to the deceased fields ride this same endpoint** — a re-`PUT` with `deceased: true` and the corrected fields.
- **Behavior — raising (first `true`):** snapshots the brother's consent/verification state (system-internal, DATABASE-SCHEMA §8), forces `allowNewsletterEmail` **off**, stamps `newsletterConsentChangedAt`, sets the deceased fields, and freezes verification (D48) — the D80 Book-side coordination, unchanged. On the Ghost side, the first raise **deletes the Ghost member** (Ghost-first, mirroring the de-brother raise) and drops the `ghostMemberId` — a deceased brother is Ghost-less (decision D134, amending D80; the email↔Ghost invariant, D133). A Ghost failure fails the action (`502 { "error": "ghost_delete_failed" }`, Book untouched); a profile with no `ghostMemberId` (a Book-only brother, or a facts-only re-PUT of an already-deceased record) makes no Ghost call. **Reversing (`false`):** restores the snapshot (consent flag and verification exactly as captured — D80), and **re-creates the Ghost member** when the brother is once again Ghost-eligible (living + not-de-brothered + usable email), created with the **restored** newsletter consent so Ghost and Book agree from the first moment, folding the fresh `ghostMemberId` into the write; an email-less (or still-de-brothered) brother is reinstated Book-only. Then stamps `newsletterConsentChangedAt` again and clears the snapshot and the deceased fields. *(The former companion flag `allowCommentReplyEmail` was removed — DECISIONS N68.)*
- **Response 200:** the updated record at the caller's projection, with a fresh `ETag`.
- **Errors:** `404` if no such brother; `422` on invalid deceased-field values; `403` if the caller is a brother; `409 { "error": "last_admin" }` if raising deceased on the **sole usable admin** (it would leave zero usable admins — decision D130; note this route is manager-or-admin tier, so this also stops a *manager* from locking the org out); `502 { "error": "ghost_delete_failed" }` (raise) or `{ "error": "ghost_create_failed" }` (reverse) if the Ghost-first member delete/re-create fails (Book untouched — decisions N65/D134); `422 { "error": "validation_failed", "issues": [{ "field": "email", … }] }` on **reverse** when the re-created member's email already exists in Ghost under an account Book is not linked to (the Book↔Ghost drift collision — a permanent, admin-resolvable condition surfaced distinctly rather than as a retryable `502`, matching the PATCH email path — decisions N96/N133, OFC-316).
- **Audit:** one entry per call (`profile.deceased` raise/edit/clear, names-not-values).

### `PUT /api/profiles/{id}/debrothered`
Raise or clear a brother's **de-brothered** state — a rare, admin-only action with coordinated side-effects (decision D115). A dedicated action (not a `PATCH` field) because raising it deletes the Ghost member and denies sign-in, and clearing it re-creates the Ghost member.

- **Auth:** **admin only.**
- **Request:** `{ "debrothered": true }` (or `false` to reverse).
- **Behavior — raising (`true`):** snapshots the brother's consent/verification state (system-internal, DATABASE-SCHEMA §8), sets `debrothered.isDebrothered = true` (with `debrotheredAt`), and **deletes the Ghost member via the Ghost-first delete path** (decision D98 — abort-clean on Ghost failure, so Book is untouched if Ghost fails). From then on the record is projected away for brothers (§1.3/§3) and sign-in for the resolved profile is denied (§2), and the brother's **live sessions are revoked** so a session opened before the mark cannot keep reading during the 4-hour window — the audit entry carries the `sessionsRevoked` count (decision N53). **Reversing (`false`):** restores the snapshot and **re-creates the Ghost member** via the Ghost-first create path (decision D96), capturing the **fresh `ghostMemberId`** the re-created member receives into the same write (a new member gets a new id — the stale id must not survive the reversal), then clears the flag; reversing revokes nothing (access is being *restored*). The reconciliation audit treats a de-brothered profile as expected to have no Ghost member (no `missingGhostMember` drift, decision D99).
- **Response 200:** the updated record at the **manager/admin projection**, with a fresh `ETag`.
- **Errors:** `404` if no such brother; `409 { "error": "last_admin" }` if raising de-brother on the **sole usable admin** (sign-in is then denied, D115, leaving zero usable admins — decision D130); `502 { "error": "ghost_delete_failed" }` or `{ "error": "ghost_create_failed" }` if the Ghost-first step fails (Book left unchanged); `422 { "error": "validation_failed", "issues": [{ "field": "email", … }] }` on **reverse (reinstate)** when the re-created member's email already exists in Ghost under an account Book is not linked to (the Book↔Ghost drift collision, surfaced distinctly rather than as a retryable `502` — decisions N96/N133, OFC-316); `403` if the caller is not an admin.

## 4. Stars (caller's own list)

Stars live in the caller's own `users` document (private state, DATABASE-SCHEMA §6.1). Both writes are **scoped to the `stars` field exclusively** — the server applies a `stars`-only update and never accepts a `role` (or any other) field on the shared `users` doc through these endpoints (decision D106).

### `PUT /api/me/stars/{id}`
Add brother `{id}` to the caller's star list. Idempotent — implemented as a Firestore **`arrayUnion`**, so a repeat add is a no-op (finding R17).
- **Auth:** any authenticated user (acts only on the caller's own list).
- **Response 200:** `{ "stars": [5012, 5305, 5247] }`

### `DELETE /api/me/stars/{id}`
Remove brother `{id}` from the caller's star list. Idempotent — implemented as a Firestore **`arrayRemove`**, so removing an absent id is a no-op (finding R17).
- **Auth:** any authenticated user.
- **Response 200:** `{ "stars": [5012, 5305] }`

## 4a. Export-audit ping

CSV export is generated **client-side** from the already-projected in-memory dataset (decision D41), so it leaves no server-side trail. This thin notify endpoint closes that gap (decision D92): after generating the file, the client POSTs here and the server writes one `export` audit entry. It carries **no profile data** — only a coarse scope label and a row count — so it stays inside the §1.4 names-not-values boundary.

### `POST /api/exports`
Record that a CSV export occurred. Fire-and-forget — the client does not block its download on the response.
- **Auth:** **manager or admin only** (`403` otherwise) — export is a staff directory-maintenance action and the action bar that triggers it is staff-only (decision D41).
- **Request:** `{ "scope": "selection" | "view", "count": 42 }` — the egress scope (the selected rows, or the whole current view) and the exported row count.
- **Response 204:** no body; the `export` audit entry (actor, scope, count, timestamp) is written to the audit stream (§6.1, decision D92).
- **Errors:** `400` on a missing/invalid `scope` or a non-integer/negative `count`.

## 5. Roles

> **The `GET /api/users/{id}/role` read endpoint is removed (decision D128, supersedes N50).** `role` now lives on the `Profile` and is a **public** projected field, so the admin **Change role** control reads the current role straight off the record it already holds (`record.role`) — there is no separate role read.

### `PUT /api/profiles/{id}/role`
The admin **Change role** function — a **protected-field profile write** (re-pathed from `PUT /api/users/{id}/role` when `role` moved onto the `Profile`, decision D128).
- **Auth:** **admin only.**
- **Request:** `{ "role": "manager" }` (`brother` | `manager` | `admin`).
- **Behavior:** sets the target profile's `role`, subject to a **server-enforced last-admin invariant** — the demotion of the **only remaining admin** is rejected (a direct API call must not be able to lock the org out of backup/restore, add/delete, role changes, and Ghost sync). The admin count is now read from the in-memory **`ProfileCache.adminCount()`** (decision D128), not a Firestore `users where role == "admin"` query. The write is committed through `commitStatusWrite` (advancing the cache token in lock-step, exactly like mark-deceased / de-brother), so it is a **protected** field set only by this dedicated action — never via PATCH. The profile always exists (it is the directory record), so there is no create-if-absent case; `role` stored optionally means an omitted value is a `brother` (DATABASE-SCHEMA §3.1). Every role change is **audit-logged with the before and after role** (decision D106; "before" is `brother` when the record carried no explicit role); this entry also feeds the D101 forensic privileged-roster log and the D105 detect-and-reverse posture. When the role **actually changes**, the target's **live sessions are revoked** (the audit entry carries the `sessionsRevoked` count): a session snapshots the caller's role, so without this a demoted admin would keep admin powers — including re-promoting themselves through this very endpoint — until the 4-hour cap; the next request re-auths at the new role (decision N53). A no-op reassignment (same role) revokes nothing.
- **Response 200:** `{ "id": 5305, "role": "manager" }`
- **Errors:** `404` if no profile with this id exists; `422` on an invalid role value, **or on an attempt to promote a brother who cannot sign in (deceased, de-brothered, or with no usable email) to `admin` — the promote-guard (decision D130), which stops a nominal, unusable admin being created**; `409 { "error": "last_admin" }` if the change would demote the **sole usable admin** (usable = living, non-de-brothered, has a usable email — decision D129).

## 6. Headshots & thumbnails

**Reads are served by the backend from a private bucket (decision D126).** Both images are immutable, versioned GCS objects (DATABASE-SCHEMA §7) addressed at `/img/headshots/{id}/{version}.webp` and `/img/thumbnails/{id}/{version}.webp`; the SPA builds these URLs itself from `id` and `headshotVersion`. The `/img/*` prefix is rewritten by Firebase Hosting to the **Cloud Run backend**, which reads the object from the private bucket and serves it gated by the **ordinary session cookie** (set at session establishment, §2) with `Cache-Control: private, max-age=31536000, immutable`. The grant is coarse — any authenticated brother may view any brother's photos (decision D23) — but because the app mediates the read, an `unlisted` or de-brothered brother's image is withheld from a brother (it returns `404`, mirroring the record projection); the visibility check runs at the caller's **effective** role, so a View-as session (DECISIONS N31) sees exactly what the assumed role would. The route parses its path **strictly** — only the two literal shapes `headshots/{id}/{version}.webp` and `thumbnails/{id}/{version}.webp` are served, anything else is `404` — which also forecloses reading any other bucket object through the rewrite (DECISIONS N43). A read with no valid session returns `401`/`403`, on which the SPA re-auths and retries (§1.2, decision D109). There is no Cloud CDN and no signed cookie.

The backend also touches images on the **write** path:

### `PUT /api/profiles/{id}/headshot`
Upload (create-or-replace) the brother's headshot. `PUT` because the headshot is a singleton sub-resource at a fixed, caller-determined URL.

- **Auth:** owner, manager, or admin.
- **Request:** the cropped image (JPEG or PNG), already framed 1:1 by the client crop UI; `Content-Type` set accordingly. The client **downscales before upload** (DECISIONS N42): the cropped region is re-rendered through a canvas to at most **1024×1024 JPEG (quality ≈0.9)** — a multi-megabyte original never crosses the wire (the slow-link audience), and the canvas re-encode strips EXIF/GPS metadata. The file input accept-lists `image/jpeg,image/png` and the client shows a clear error for anything else (notably HEIC, which desktop browsers cannot decode into a canvas; iPhone Safari converts HEIC→JPEG on file inputs itself). The server-side checks below remain the authority — client preprocessing is a courtesy, not a trust boundary.
- **Behavior:** validates the upload by **magic-byte inspection** (not the declared `Content-Type`) and bounds it to **≈40 MP decoded** (with decoder memory/time limits) so a decompression bomb cannot exhaust the instance — a ceiling set high enough that a genuine high-resolution headshot is never bounced (decision D107); transcodes to WEBP in a pinned, least-privileged imaging library. It then writes the 512×512 headshot and the derived 96×96 thumbnail to GCS **first** and advances the `headshotVersion` **pointer last** (decision D98), so the pointer never names objects that don't yet exist. The new `headshotVersion` is an **opaque, collision-free token** (e.g. a UUID/timestamp), not a sequential counter — which also defeats URL-enumeration (finding R16); minting it yields fresh immutable URLs and sets `hasHeadshot: true`. After the pointer advances, the **superseded objects of the prior version are deleted** — each version is a distinct key, so nothing else ever removes them; with the bucket's object versioning and 90-day noncurrent-age lifecycle rule, the deleted objects remain recoverable for decision D94's window (DECISIONS N42). The write is **audited** (names-not-values: the field name `headshot`), and it does **not** touch verification — the D28 coupling is a PATCH-path side-effect only (DECISIONS N42).
- **Response 200:** `{ "hasHeadshot": true, "headshotVersion": "f3a9c1e8b2" }`, with a **fresh `ETag`** — the upload advances the profile document, so without a new token the client's held `If-Match` goes stale mid-Save and the *next* edit would hit a spurious `412`; the SPA's container applies the response fields and the token in place (DECISIONS N42).
- **Errors:** `415` on an unsupported image type; `413` if the body exceeds the route's upload limit (8 MB — generous, since a downscaled client upload is well under 2 MB); `422` if the image fails the magic-byte check or exceeds the ~40 MP decode cap (DATABASE-SCHEMA §7); `404` if no such brother; `403` if the caller may not edit this record.

### `DELETE /api/profiles/{id}/headshot`
- **Auth:** owner, manager, or admin.
- **Behavior:** removes the headshot/thumbnail objects and sets `hasHeadshot: false`. Audited like the upload; same D94 recovery window via the bucket's versioning + lifecycle rule; no verification side-effect (DECISIONS N42).
- **Response 200:** `{ "hasHeadshot": false }`, with a **fresh `ETag`** (same rationale as the upload).

> **No thumbnail-regenerate endpoint (decision D114).** An earlier draft reserved `POST /api/profiles/{id}/thumbnail:regenerate`. It is **removed**: the thumbnail and headshot of a given version are written together before the `headshotVersion` pointer advances (D98), so they never drift, and the only re-derivation triggers (a thumbnail-spec change or a generation-bug fix) are rare developer events handled by an ad-hoc offline script over the retained 512² headshots — not an online feature. A brother who wants a different thumbnail re-uploads/re-crops.

## 7. Admin operations (reserved)

These are admin-only. The bulk-operations surface was reshaped in the resolution pass: **Book has no online bulk-write path** — every write is a single authenticated edit through the one live instance (decision D100) — so the online bulk-import and online-restore endpoints the earlier draft reserved are **descoped**.

| Endpoint | Method | Status | Purpose |
|---|---|---|---|
| `/api/admin/backup` | GET | MVP | Download a full database backup (text + images); a daily automated backup also runs server-side (decision D63). The admin is **custodian** of the downloaded archive (decision D101; USER-MANUAL). |
| `/api/admin/ghost-audit` | GET | MVP | Run the **Book / Ghost alignment audit** (decisions D55/D99/N69) and return the discrepancy report (shape below). **Read-only into Book in every category** (N69, amending D103 — it resolves nothing). The same audit runs on a schedule inside the consolidated health-check job (decision D99). Renamed from `POST /api/admin/sync-ghost` (read-only ⇒ `GET`; nothing is "synced"). |
| `/api/admin/bounce-report` | GET | MVP | Run the **email-bounce report** and return per-brother bounce aggregates (decision D120, as amended by N69 — its own endpoint, not riding the audit). Reuses the `export-bounces.js` join. |
| `/api/admin/import` | — | **deferred (post-MVP)** | Online bulk-CSV upsert is **removed from MVP** (no online bulk-write path, decision D100, amending D52/D68); a MITAA-specific import is backlogged. Any rare bulk reconciliation is an **offline** operator task, not an online endpoint. |
| `/api/admin/restore` | — | **offline (no API endpoint)** | Restore is an **offline maintenance event** (decisions D100/D101): Book goes hard-down, the three collections are replaced from a **structurally-validated** backup (cycle/ID-uniqueness/email-uniqueness/reference-integrity), and the single instance cold-hydrates on restart. Operator tooling, not an online endpoint. |

**Backup envelope (`GET /api/admin/backup` response).** As shipped in Phase 5a-1 the download is **JSON-only** — the collections snapshot — served as a dated download attachment (`Content-Disposition: attachment; filename="book-backup-YYYY-MM-DD.json"`, `no-store`) and audited as `backup.download` (decisions D63/N58). The body is `{ "version": 1, "generatedAt": "<ISO>", "collections": { "profiles": [{ "id": "<docId>", "data": { … } }], "users": [ … ], "config": [ … ] } }` — each collection is an array of `{ id, data }` documents so a restore is a faithful, key-preserving replay. The `bugReports` collection (decision D121) is **not** in the backup: it is transient triage data an admin clears (like `sessions`/`authNonces`), not part of the durable directory a restore reconstructs. The **image-object bundle** (the zipped headshots/thumbnails, decision D63) and the **nightly automated backup** are Phase 7 (ENGINEERING-DESIGN §6.3), not this endpoint.

**Reconciliation audit — discrepancy-report shape (`GET /api/admin/ghost-audit` response).** The audit (decisions D55/D99) is **read-only into Book in every category** — decision N69 removed D103's scoped newsletter write-back, so it reports differences and **changes nothing**. It returns a list of discrepancies, each tagged by category; the SPA formats it into a Markdown download (nothing is rendered in the UI — N69):

```json
{
  "generatedAt": "2026-07-09T12:00:00Z",
  "discrepancies": [
    { "category": "newsletterDrift", "profileId": 5247, "ghostMemberId": "6612af…",
      "field": "allowNewsletterEmail", "bookValue": true, "ghostValue": false,
      "bookChangedAt": "2026-01-01T09:00:00Z", "ghostChangedAt": "2026-06-01T00:00:00Z" }
  ]
}
```

- **Categories:** `unmatchedGhostMember` (a Ghost member with no Book profile — including a still-live member for a **deceased** or de-brothered brother, whose member should have been deleted), `fieldDrift` (a pushed field — email / name — differs), `missingGhostMember` (a Book profile with an email whose Ghost member is gone or was never linked; a **deceased** (decision D134), de-brothered, or no-email profile is *expected* to have none and is excluded), `bookInternalOrphan` (a dangling `bigBrotherId`, or a `users` doc with no live profile — decision D98), and `newsletterDrift` (Book and Ghost disagree on `allowNewsletterEmail`, carrying `bookChangedAt` vs. `ghostChangedAt` so a human resolves it by hand). **Every category is report-only** (N69).
- **Per-row fields:** `{ category, profileId?, ghostMemberId?, field?, bookValue?, ghostValue?, bookChangedAt?, ghostChangedAt? }`. There is **no `resolution` field** — the audit acts on nothing (N69, amending D103). The identical shape is produced by the scheduled health-check job (decision D99; ENGINEERING-DESIGN §5.1).

**Bounce report — shape (`GET /api/admin/bounce-report` response).** Per-brother bounce aggregates (decision D120), formatted by the SPA into a CSV download (not rendered in the UI). `{ generatedAt, skipped, rows: [{ email, bounce_count, last_bounce_at, last_bounce_newsletter }] }`, where `skipped` counts bounce events whose member Ghost has since hard-deleted (unresolvable to an email). Rows are ordered most-bounces-first.

Both endpoints are admin-only at effective role (N31), `no-store`, and fail closed with **`503 { "error": "ghost_unconfigured" }`** when the Ghost Admin API is not configured, or **`502 { "error": "ghost_read_failed" }`** when a Ghost read fails.

## 8. First-party service access: the Linter roster

The one non-browser, first-party consumer — the **PBE News Linter** — reads a names-and-years roster over a dedicated endpoint authenticated **not** by the Book session cookie but by a **Google service-account identity token** (decision D58; ENGINEERING-DESIGN §5.2). This is the single exception to §1.2's cookie-only rule. It is read-only and exposes no contact or restricted data.

### `GET /api/roster`
- **Auth:** a GCP **service-account OIDC identity token** in `Authorization: Bearer <token>`, **verified in-code against Google's JWKS** requiring **issuer = Google**, **audience = Book**, **and subject = the exact `linter` service account** (decision D78, amending D58). The earlier "Cloud Run front-door IAM" option is **dropped**: `run.invoker` is enforced per-*service*, and this same service hosts the **unauthenticated** sign-in endpoint (`/api/auth/session`), so requiring IAM would also lock out sign-in and `/api/profiles`. The **subject pin is essential** — issuer+audience alone would accept *any* Google-issued token for that audience. The verification mirrors the Ghost-JWKS check, with Google as a second trusted issuer; the `linter` SA stays least-privileged. The Book session cookie is **not** accepted here, and this service-account token is **not** accepted on any other endpoint.
- **Behavior:** returns the whole roster — the least-sensitive slice of every profile — projected to the name fields, class year, the deceased flag, and the **server-constructed `canonicalName`** (so the canonical string has a single source of truth across the language boundary; the Linter consumes it rather than recomputing it, refining decision D15). No contact information, no restricted fields, no image bytes. The response carries an explicit **`contractVersion`** (also surfaced as an `X-Contract-Version` header): the Linter **pins** a version, and `contractVersion` is **bumped on any breaking shape change** with a deprecation note recorded in this spec — closing the silent-break risk of an independently-deployed, cross-language consumer (decision D112).
- **Response 200:** absent optional fields are **omitted**, not sent as `null` (the schema's `?`-means-absent convention — finding C11; it matters because the Linter distinguishes "no value" from a literal `null`):
  ```json
  { "contractVersion": 1,
    "roster": [
      { "id": 5247, "firstName": "James", "lastName": "Smyth",
        "classYear": 1984, "isDeceased": false, "canonicalName": "James Smyth '84" }
    ] }
  ```
  (Here `middleName`, `fullLegalName`, and `mugName` are simply absent for this brother.)
- **MVP scope — stub only.** For the initial release this endpoint is implemented as a **stub that returns no roster data** — it authenticates the caller and responds `200 { "contractVersion": 1, "roster": [] }`, establishing the contract and the auth path so the Linter project can build against them, but it serves real roster data only once the Linter integration is actually wired up (decision D58).
- **Errors:** `401` / `403` if the service-account token is missing, invalid, wrong-audience, or not an authorized invoker.

## 9. Deferred: external / third-party API

There is no programmatic API surface for arbitrary external applications in MVP — no API keys, no per-app credentials, no public contract (decision D27, extending D11). The one known non-browser consumer, the **PBE News Linter**, is handled as a scoped first-party path (§8, decision D58), not via this deferred public-API mechanism.

## 10. System banner, bug reports, and maintenance

Three small surfaces added in the post-resolution amendments pass (decisions D117, D121, D118). The banner read and the bug-report POST are available to any authenticated user; setting the banner and reading/clearing the bug-report queue are admin-only.

### `GET /api/banner`
The current site-wide system banner, fetched by the SPA on load and rendered across the top of every page (decision D117).
- **Auth:** any authenticated user.
- **Response 200:** `{ "active": true, "message": "Scheduled maintenance Sunday 2–3 am ET.", "severity": "warning" }`, or `{ "active": false }` when none is set.
- **Caching:** short-lived/revalidated; the banner is global and carries no PII. Independent of Ghost's announcement bar (decision D117).

### `PUT /api/admin/banner`
Set or clear the system banner (decision D117).
- **Auth:** **admin only.**
- **Request:** `{ "active": true, "message": "…", "severity": "info" }`; `active: false` clears it. The banner **persists until an admin changes it** — it is not per-user dismissible.
- **Response 200:** the stored banner (DATABASE-SCHEMA §6.3).
- **Errors:** `422` on a missing `message` when `active` is true, or an invalid `severity`.

### `POST /api/bug-report`
File a bug report (decision D121). Stores the report and writes an audit entry (decision D61); **no email is sent**, which keeps the admin's inbox out of the attack surface.
- **Auth:** any authenticated user (Book is members-only, so the submitter is always a known brother).
- **Request:** `{ "page": "/brother/5247/edit", "url": "https://book.pbe400.org/brother/5247/edit", "description": "Save did nothing", "clientContext": { "userAgent": "…", "viewport": "1280x720", "webVersion": "a1b2c3", "device": "Desktop", "os": "Windows 11", "browser": "Chrome 130", "network": "Wi-Fi · ~10 Mbps" } }`. `description` is required, trimmed, and **capped at 2000 characters**; it is treated as untrusted and never emailed or interpolated into a dangerous sink. `page` (the SPA route, path + query) and `url` (the absolute location) are captured by the client so an admin can see exactly where the report was filed from. `clientContext` is best-effort device/OS/browser/network diagnostics (fields absent where the browser doesn't expose them, DATABASE-SCHEMA §6.4). The server ignores any client-sent `apiVersion` and **stamps its own** build id.
- **Behavior:** persists a `bugReports` document (DATABASE-SCHEMA §6.4) with the authenticated submitter, their canonical name **snapshotted from the session identity**, and a server-set timestamp, at status `new`; an admin reviews the queue. **Rate-limited (5 per minute per session) and size-capped** (decision D86), so even an authenticated brother cannot flood it.
- **Response 201:** `{ "id": "…", "status": "new" }`.
- **Errors:** `422` on a missing/oversized `description`; `429` if the rate limit is exceeded.

### `GET /api/admin/bug-reports`
The bug-report review queue (decision D121). Book is a **triage-and-clear** surface, not a bug tracker: an admin reads reports here, copies any worth keeping into the real bug tracker, and deletes them. There is no lifecycle beyond that — Book exists as a viewer only because it has no email and reading raw Firestore by hand would be cumbersome.
- **Auth:** **admin only** (at the caller's effective role, N31). A non-admin probe is audited as a denial (OFC-190).
- **Response 200:** `{ "reports": [ { "id": "…", "submitterId": 5247, "submitterName": "James Smyth '84", "submittedAt": "2026-06-12T14:02:00Z", "page": "/", "url": "https://…/", "description": "…", "clientContext": { … }, "status": "new" } ] }`, **newest first**. The volume is small (a members-only directory), so the response is unpaginated. `submitterName` is read straight from the stored record (snapshotted at filing, so the admin read does no roster lookup and a report still names its submitter even after their profile is deleted); the raw `submittedBy` is surfaced as `submitterId`. `no-store` (it names a submitter).

### `POST /api/admin/bug-reports/mark-reviewed`
Mark reports as seen — the one-way `new → reviewed` transition (decision D121). `new` means the admin has not yet seen the report; `reviewed` means it has been displayed but not yet deleted. This is an **unread marker** (like unread email): the SPA calls it after rendering the queue so newly arrived reports show their **NEW** badge on the current visit and are quiet on the next.
- **Auth:** **admin only** (effective role). Non-admin probe audited as a denial.
- **Request:** `{ "ids": ["…", "…"] }` — the ids to mark reviewed. Unknown ids are ignored (idempotent); already-`reviewed` ids are a no-op.
- **Response 200:** `{ "reviewed": 2 }` (the count actually transitioned).

### `DELETE /api/admin/bug-reports/{id}`
Delete a bug report from Book — the terminal act, once it has been copied into the real tracker or rejected (decision D121). Deletion removes the document entirely; there is no stored terminal status.
- **Auth:** **admin only** (effective role). Non-admin probe audited as a denial.
- **Response 204:** on success (idempotent — deleting an already-absent report also returns `204`).

### Maintenance / outage signalling (decision D118, as simplified by N69)
Two parts, and — per decision N69 — **no backend maintenance-mode flag** and **no planned-vs-unplanned distinction on the cached-SPA path**:

- **Fresh load during planned downtime** is served a **static maintenance page at the Hosting / edge layer**, independent of the backend (so it works even when Cloud Run is stopped) — swapped in by an operator script (`infra/maintenance-on.sh`, which deploys the alternate `firebase.maintenance.json`; `maintenance-off.sh` restores normal serving). This is Forrest's chosen mechanism over an admin-page toggle.
- **An already-loaded (cached) SPA that cannot reach the backend for any reason** — a network drop, a cold-start timeout, or a `5xx`/`503` — shows one calm, generic "Book is temporarily unavailable" page with a manual retry. The SPA does not try to tell planned from unplanned (N69). Crucially, a `5xx`/`503` from `/api/me` is treated as *unavailable*, **not** as signed-out: only `401`/`403` routes to the sign-in flow (ENGINEERING-DESIGN §2.3, D118/N69). See ENGINEERING-DESIGN §6.3.
