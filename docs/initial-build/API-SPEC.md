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
| 503 | Service unavailable — Book is in **maintenance / outage** mode; `Retry-After` and a maintenance-flavored body distinguish *planned* maintenance from an unplanned outage, and the SPA shows its maintenance/outage page (decision D118, §10). |

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
- **Response 200:** `{ "profileId": 5247, "role": "manager", "realRole": "admin", "impersonating": true, "stars": [5012, 5305], "profile": { /* the caller's own full Profile — own off-toggle contact values, but never their own adminNote */ } }`
- **Caching:** served **`no-store`** — like `/api/profiles`, this response now carries the caller's own contact values, so D95's no-disk-PII rationale applies.
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

### `POST /api/profiles`
Create a brother. The whole record is created in one atomic write.

- **Auth:** **admin only.**
- **Request:** a complete `Profile` body — the caller-supplied Constitution `id` (never auto-assigned; it is the brother's physical Constitution signature number) plus every field the admin entered on the Add-Brother form. Server-managed fields (`lastModified`, `newsletterConsentChangedAt`, `lastVerifiedDate`/`verifiedBy`, `headshotVersion`, `ghostMemberId`) are set by the backend, not accepted from the body. There is no empty-then-fill step.
- **Response 201:** the created `Profile`, with an `ETag` header.
- **Errors:** `409` if `id` already exists; `422` on validation failure.
- **Headshots:** optional and uploaded separately (§6) — a new profile begins with `hasHeadshot: false` and is complete and valid without a photo.

### `PATCH /api/profiles/{id}`
Partial edit — the normal save path from the profile page. There is no `PUT` for profiles (decision D24).

- **Auth:** owner (own record), manager, or admin, enforced on **two orthogonal axes** (decision D106). **Object-level:** the server checks `request.profileId == session.profileId OR session.role ∈ {manager, admin}` *before* the write — a bare "is authenticated" check would be an IDOR, since Constitution IDs are contiguous guessable integers. **Field-level:** a **positive per-role writable-field allowlist** (the write-side dual of the §1.3 read projection); a field outside the caller's allowlist is **rejected**, never silently ignored. A manager may not set another brother's `privacy` flags, `allowNewsletterEmail`, `allowCommentReplyEmail`, `allowShareWithMITAA`, or `unlisted` — those are **owner-only** (an admin may also set them on another brother; a manager may not — `unlisted` per decision D124); and all system/verification/Ghost fields (`id`, `role`, `lastVerifiedDate`, `verifiedBy`, `lastModified`, `newsletterConsentChangedAt`, `hasHeadshot`, `headshotVersion`, `ghostMemberId`, `deceased`, `debrothered`) are unwritable via PATCH by *every* role, set only by their dedicated server actions (verification via `POST …/verify`; the deceased state via `PUT …/deceased`; the de-brother state via `PUT /api/profiles/{id}/debrothered`, below — decision D115; the headshot pointer via the §6 upload pipeline). The staff-internal `adminNote` is PATCH-writable by managers and admins only, never the owner (the shipped capability matrix's `staff` class — DECISIONS N10; an earlier draft of this list misplaced it among the protected fields).
- **Headers:** `If-Match: <token>` **required** (§1.4).
- **Request:** a partial `Profile` — only the changed fields.
- **Response 200:** the updated, projected `Profile`, with a fresh `ETag`.
- **Verification side-effect (decision D28):** when the PATCH actually changes content and the profile is **not** deceased, the server adjusts verification automatically — an edit by the **owner** auto-(re)verifies it (`lastVerifiedDate = today`, `verifiedBy =` the owner); an edit by a **manager/admin on another brother's** profile clears verification if it was verified, and leaves it unverified otherwise. Deceased profiles are exempt (verification unchanged). The unverify is server-enforced; the manager-facing "saving will mark this unverified" warning is client-side courtesy only — there is no force flag.
- **Errors:** `428` if `If-Match` is missing; `412` if stale; `403` if the caller may not edit this record or included a field outside their powers; `422` on validation failure; `404` if no such brother.

### `DELETE /api/profiles/{id}`
- **Auth:** **admin only.**
- **Behavior:** deletes across Firestore, GCS, and Ghost in a fixed order so a partial failure leaves a benign state (decision D98). The **last-admin invariant is checked first** (decision D106; DECISIONS N49): deleting the only remaining admin is rejected (`409 last_admin`) **before** the Ghost-first step, so a rejection leaves Ghost, GCS, and Book untouched — the delete-path dual of the `PUT /api/users/{id}/role` guard, and the same lockout it prevents (the UI does not show roles, so an admin cannot see they are removing the last one). The check is a server-side `users where role == admin` count; it is a pre-check, not transactional (the delete spans Ghost/GCS/Firestore), which is acceptable at `--max-instances=1` where delete is a rare action. Then the **Ghost member is deleted first** (synchronous, decision D96); if that fails the delete **aborts cleanly** (Book untouched, admin retries). Then the Book-side steps run, each **idempotent** so a re-run completes a partial delete: the GCS image objects, the `users` document, and the `profiles` document. Before deleting, the server **scrubs inbound references** in the in-memory dataset — clearing any `bigBrotherId == id` and removing `id` from any `users.stars` — so the delete leaves no dangling references (decision D98); graceful rendering of any straggler is the backstop. No dedicated orphan-sweep job: residue is covered by the D94 GCS lifecycle and the D55/D99 reconciliation audit. Finally, the deleted brother's **live sessions are revoked** so a surviving session cannot keep reading after the record is gone; the audit entry carries the `sessionsRevoked` count (decision N53).
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
- **Behavior — raising (first `true`):** snapshots the brother's consent/verification state (system-internal, DATABASE-SCHEMA §8), forces `allowNewsletterEmail` and `allowCommentReplyEmail` **off**, stamps `newsletterConsentChangedAt` (the D103 reconcile's causal signal), sets the deceased fields, and freezes verification (D48). The Book-side force-off/snapshot happens **here, at mark time**; pushing the resulting subscription state to Ghost is the Phase-5 write path (decision N40). **Reversing (`false`):** restores the snapshot (consent flags and verification exactly as captured — D80), stamps `newsletterConsentChangedAt` again, clears the snapshot and the deceased fields.
- **Response 200:** the updated record at the caller's projection, with a fresh `ETag`.
- **Errors:** `404` if no such brother; `422` on invalid deceased-field values; `403` if the caller is a brother.
- **Audit:** one entry per call (`profile.deceased` raise/edit/clear, names-not-values).

### `PUT /api/profiles/{id}/debrothered`
Raise or clear a brother's **de-brothered** state — a rare, admin-only action with coordinated side-effects (decision D115). A dedicated action (not a `PATCH` field) because raising it deletes the Ghost member and denies sign-in, and clearing it re-creates the Ghost member.

- **Auth:** **admin only.**
- **Request:** `{ "debrothered": true }` (or `false` to reverse).
- **Behavior — raising (`true`):** snapshots the brother's consent/verification state (system-internal, DATABASE-SCHEMA §8), sets `debrothered.isDebrothered = true` (with `debrotheredAt`), and **deletes the Ghost member via the Ghost-first delete path** (decision D98 — abort-clean on Ghost failure, so Book is untouched if Ghost fails). From then on the record is projected away for brothers (§1.3/§3) and sign-in for the resolved profile is denied (§2), and the brother's **live sessions are revoked** so a session opened before the mark cannot keep reading during the 4-hour window — the audit entry carries the `sessionsRevoked` count (decision N53). **Reversing (`false`):** restores the snapshot and **re-creates the Ghost member** via the Ghost-first create path (decision D96), then clears the flag; reversing revokes nothing (access is being *restored*). The reconciliation audit treats a de-brothered profile as expected to have no Ghost member (no `missingGhostMember` drift, decision D99).
- **Response 200:** the updated record at the **manager/admin projection**, with a fresh `ETag`.
- **Errors:** `404` if no such brother; `502 { "error": "ghost_delete_failed" }` or `{ "error": "ghost_create_failed" }` if the Ghost-first step fails (Book left unchanged); `403` if the caller is not an admin.

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

### `GET /api/users/{id}/role`
Read a brother's current role — backs the admin **Change role** control so its segmented control can highlight the active role (DECISIONS N50). A brother's role lives in the private `users` collection, not the `profiles` projection, so it is fetched here rather than carried on the profile read.
- **Auth:** **admin only** (evaluated at the caller's effective role, N31 — the same role that may change it).
- **Behavior:** returns the target's role, or `brother` when the brother has **no `users` document yet** (never signed in — the role a first sign-in would give, R20/N44). A read: **not audited**, served `no-store`.
- **Response 200:** `{ "id": 5305, "role": "manager" }`.
- **Errors:** `404` if no brother with this id exists in `profiles` (a missing `users` document alone is not an error); `403` for a non-admin caller.

### `PUT /api/users/{id}/role`
The admin **Change role** function.
- **Auth:** **admin only.**
- **Request:** `{ "role": "manager" }` (`brother` | `manager` | `admin`).
- **Behavior:** changes the target's `role`, subject to a **server-enforced last-admin invariant** — the demotion of the **only remaining admin** is rejected (a direct API call must not be able to lock the org out of backup/restore, add/delete, role changes, and Ghost sync); the admin count is checked server-side (a `users where role == "admin"` query — a rare action, trivial at `max-instances=1`). Because `users` documents are created lazily on first sign-in (finding R20), a brother who has **never signed in** has no `users` document yet: the endpoint **creates it with the given role** rather than failing (`{ id, role }`, stars untouched — DECISIONS N44), so every existing brother is promotable. Every role change is **audit-logged with the before and after role** (decision D106; "before" is `brother` for a created-if-absent document, the role a first sign-in would have received); this entry also feeds the D101 forensic privileged-roster log and the D105 detect-and-reverse posture. When the role **actually changes**, the target's **live sessions are revoked** (the audit entry carries the `sessionsRevoked` count): a session snapshots the caller's role, so without this a demoted admin would keep admin powers — including re-promoting themselves through this very endpoint — until the 4-hour cap; the next request re-auths at the new role (decision N53). A no-op reassignment (same role) revokes nothing.
- **Response 200:** `{ "id": 5305, "role": "manager" }`
- **Errors:** `404` if no brother with this id exists in `profiles` (a missing `users` document alone is not an error — see create-if-absent above); `422` on an invalid role value; `409 { "error": "last_admin" }` if the change would demote the only remaining admin.

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
| `/api/admin/sync-ghost` | POST | MVP | Manually trigger the Ghost reconciliation audit (decisions D55/D99) and return the discrepancy report (shape below). The same audit runs on a schedule inside the consolidated health-check job (decision D99). |
| `/api/admin/import` | — | **deferred (post-MVP)** | Online bulk-CSV upsert is **removed from MVP** (no online bulk-write path, decision D100, amending D52/D68); a MITAA-specific import is backlogged. Any rare bulk reconciliation is an **offline** operator task, not an online endpoint. |
| `/api/admin/restore` | — | **offline (no API endpoint)** | Restore is an **offline maintenance event** (decisions D100/D101): Book goes hard-down, the three collections are replaced from a **structurally-validated** backup (cycle/ID-uniqueness/email-uniqueness/reference-integrity), and the single instance cold-hydrates on restart. Operator tooling, not an online endpoint. |

**Backup envelope (`GET /api/admin/backup` response).** As shipped in Phase 5a-1 the download is **JSON-only** — the collections snapshot — served as a dated download attachment (`Content-Disposition: attachment; filename="book-backup-YYYY-MM-DD.json"`, `no-store`) and audited as `backup.download` (decisions D63/N58). The body is `{ "version": 1, "generatedAt": "<ISO>", "collections": { "profiles": [{ "id": "<docId>", "data": { … } }], "users": [ … ], "config": [ … ] } }` — each collection is an array of `{ id, data }` documents so a restore is a faithful, key-preserving replay. The `bugReports` collection (decision D121) is **not** in the backup: it is transient triage data an admin clears (like `sessions`/`authNonces`), not part of the durable directory a restore reconstructs. The **image-object bundle** (the zipped headshots/thumbnails, decision D63) and the **nightly automated backup** are Phase 7 (ENGINEERING-DESIGN §6.3), not this endpoint.

**Reconciliation audit — discrepancy-report shape (`POST /api/admin/sync-ghost` response).** The audit (decisions D55/D99) is read-only into Book for **every field except** the scoped newsletter-flag most-recent-change-wins reconcile (decision D103, which it applies and logs). It returns a list of discrepancies, each tagged by category:

```json
{
  "generatedAt": "2026-06-11T12:00:00Z",
  "discrepancies": [
    { "category": "newsletterDrift", "profileId": 5247, "ghostMemberId": "6612af…",
      "field": "allowNewsletterEmail", "bookValue": false, "ghostValue": true,
      "bookChangedAt": "2026-06-10T09:00:00Z", "ghostChangedAt": "2026-05-01T00:00:00Z",
      "resolution": "rePushedBookToGhost" }
  ]
}
```

- **Categories:** `unmatchedGhostMember` (a Ghost member with no Book profile), `fieldDrift` (a non-newsletter field differs — **report-only**), `missingGhostMember` (a Book profile whose Ghost member is gone), `bookInternalOrphan` (a dangling `bigBrotherId`, or a `users` doc with no live profile — decision D98), and `newsletterDrift` (the one field the audit may **resolve**: most-recent-change-wins by `bookChangedAt` vs. `ghostChangedAt`, re-pushing Book→Ghost or writing Ghost→Book — decision D103).
- **Per-row fields:** `{ category, profileId?, ghostMemberId?, field?, bookValue?, ghostValue?, bookChangedAt?, ghostChangedAt?, resolution? }`. `resolution` is present only where the audit **acted** (the newsletter case, e.g. `rePushedBookToGhost` | `wroteGhostToBook`); every other category is report-only. The identical shape is produced by the scheduled health-check job (decision D99; ENGINEERING-DESIGN §5.1).

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

### Maintenance / outage signalling (decision D118)
When Book is in **planned maintenance**, the backend (if reached) responds **`503`** with `Retry-After` and a maintenance-flavored body, so an already-loaded SPA shows its "down for maintenance, check back" page rather than a generic outage message. An **unplanned** outage (no reachable backend) is detected by the SPA's failed/timed-out API calls and shows the generic outage page. A **fresh** load during planned downtime is served a **static maintenance page at the Hosting / edge layer**, independent of the backend (so it works even when Cloud Run is stopped) — swapped in by an operator script. See the `503` row in §1.5 and ENGINEERING-DESIGN §6.3.
