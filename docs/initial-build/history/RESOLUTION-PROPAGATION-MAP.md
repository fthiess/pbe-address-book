# PBE Address Book — Resolution / Propagation Map

The execution contract for the resolution / propagation pass (TRIAGE-PLAN §6). Triage is complete: all 81 composite findings are dispositioned in `DESIGN-REVIEW-COMPOSITE.md` §12, and all 37 new decisions (**D77–D113**) are drafted in `../DECISIONS.md`. What remains is to *apply* those decisions to the eight delivered docs without introducing new inconsistencies — a precision pass, not a reasoning pass.

This map compiles, from each decision's own *"Records to / updates `<DOC §x>`"* clause plus the §12 worksheet's non-`D`-numbered (a)-fixes, **which doc section gets touched by which decision** — so the propagation runs **document-by-document, each section touched once** with its full resolution.

> **Status:** Drafted at the start of the resolution pass (session 1 of 2). Session 1 = this map + the `DECISIONS.md` finalize/cross-ref retrofit. Session 2 = doc-by-doc propagation (Part 1), then C4 (Part 3), the final consistency sweep, and the §13 summary (Part 4).

**Legend.** Each row: target section · driving decisions/findings · one-line change. A `D##` drives the change; a bare finding ID (e.g. `S9`, `C1`) is an (a)-fix recorded only in the §12 worksheet with no D-number, still to be applied here.

---

## Part 1 — Propagation matrix, by document

Execution order is dependency-sensitive: **schema → API → engineering → PRD → user-manual → pre-launch-tools → coding-plan**. Data-shape decisions land first so later docs cite a settled schema.

### 1. `DATABASE-SCHEMA.md`

| Section | Decisions / findings | Change |
|---|---|---|
| §3.1 (Profile fields) | D81 · D97 · D103 | Remove `ghostMemberUuid` from MVP schema; store email **normalized-only** (lowercase/trim/NFC); add `newsletterConsentChangedAt` (timestamp). |
| §4 (population/scope) | P19 | State the population is adults (18+); no minor-consent machinery. |
| §6.1 (client storage) | C1 · D106 | "cookies" → `localStorage` per D30 (kill the dead ref); note the authz/write model home. |
| §7 (image assets / links) | D98 · D107 · D109 | Headshot `headshotVersion` opaque-token (R16) + pointer-last ordering note; `links[].url`/`obituaryUrl`/`inMemoriamUrl` carry a strict `http`/`https` scheme constraint. |
| §8 (validation rules) | D80 · D97 · D101 · D103 · D106 | Deceased consent/verification **snapshot+restore** (C14); email normalization + uniqueness (one namespace, primary+`alternateEmail`); structural-validation-on-restore rules; `newsletterConsentChangedAt` write rule; write-field allowlist cross-ref. |
| §9 (projection) | D82 | The split read: uniform per-role projection of all records + the caller's own full record out-of-band. |
| §10 (CSV export) | C8 · S9 · C7/D90 | Add `verifiedBy` as a read-only manager/admin export column; formula-injection neutralization rule; the two-tier MITAA export columns (see C4, Part 3). |

### 2. `API-SPEC.md`

| Section | Decisions / findings | Change |
|---|---|---|
| §1 (`/api/profiles`) | D82 · D95 | Bulk read = uniform per-role projection; **`no-store`** (supersedes the §1 `private,no-cache`/304 of D76); a companion `GET /api/me` self-fetch. |
| §1.2 (caching/headers) | D95 · D109 | `no-store` rationale; 401-on-state-change handling contract. |
| §2 (auth/session) | D97 · D104 · R20 | Email normalization at resolution; single-use `state`/nonce + redirect allowlist; create-if-absent first-login `users` doc. |
| §3 (profiles CRUD) | D98 · D106 | Delete cascade ordering (Ghost-first-abort-clean); object-level predicate + per-role write-field allowlist. |
| §4 (stars / matrix) | R17 · D106 | `arrayUnion`/`arrayRemove` for stars PUT/DELETE; write matrix as the read-projection's dual. |
| §5 (role endpoint) | D106 | Server-enforced last-admin invariant in `PUT /api/users/{id}/role` + before/after audit. |
| §6 (headshot / media) | D98 · D107 · R16 | Pointer-last headshot write; magic-byte + 40 MP decode cap; fix the `headshotVersion` example to the schema's string type. |
| §8 (roster endpoint) | D78 · C11 · D112 | Subject-pinned in-code Google-JWKS auth (IAM front door dropped); omit absent optionals in the roster example (`?`=absent, not `null`); add a `contractVersion` field/header + deprecation note. |

### 3. `ENGINEERING-DESIGN.md`

| Section | Decisions / findings | Change |
|---|---|---|
| §1.4 (projection / enforcement) | D82 · D106 | Read split sharpens the single enforcement point; the write-field allowlist is its write-side dual. |
| §1.5 (cache / cold start) | D83 · D85 | `max-instances=1` + scale-to-zero, single instance authoritative; cold-hydrate from the backend-internal GCS snapshot. |
| §1.6 (compression / ETag) | D82 (S6) · D84 | ETag keyed by role/projection identity (demotion-invalidates); brotli-11 off the event loop, precomputed into the snapshot, debounced + batch-regen hook. |
| §2.1 (auth verify) | D97 · D99 · D104 · D105 · R20 | In-memory email index + normalization; trace-id on the save path; alg-pin + nonce; Ghost-SPOF threat-model note; create-if-absent. |
| §2.2 (authz / threat model) | D105 | "Book's authorization trust equals Ghost Pro's account security" written threat-model note; no step-up. |
| §2.3 (session cookie) | D107 · D109 | Host-only session cookie; 401-recovery (absolute 4h cap → child-window re-auth). |
| §2.4 (read API) | D82 | Per-role bulk + `/api/me`. |
| §2.5 (media / CDN cookie) | D94 · D107 · D109 | Headshot-version purge note; CSP/headers context for images; image-`403` re-auth-and-retry (R18). |
| §2.6 (concurrency UX) | D109 | Extend D25's preserve-edits-on-412 to the 401 path; resume Save with original `If-Match`. |
| §2.7 (rate limits / JWKS / CORS) | D86 · D87 · D104 · D107 | Rate limits/concurrency caps; JWKS persist/seed + single-flight; nonce store; deny-by-default CORS. |
| §5.1 (Ghost sync) | D96 · D97 · D98 · D99 · D103 | Synchronous diff-based push, create-Ghost-first, email-commit-gated; in-memory uniqueness; multi-store ordering; trace ids; newsletter bidirectional most-recent-wins. |
| §5.2 (Linter roster) | D78 · D112 | In-code subject-pinned auth; roster `contractVersion`. |
| §6.1 (logging / audit / ops) | D83 · D86 · D99 · P10 · P16 | Cache-age/listener watchdog + alert; rate-limit policy; **scheduled** consolidated sysadmin job (reconciliation audit + login canary + contract test) + Book-internal-orphan reporting; names-not-values on **all** log streams (amends D61); audit-log retention **3 months**. |
| §6.2 (analytics) | D88 · P6 | Drop `name`, keep email/CID/role/`ignore_dnt`; event-property no-PII rule (no search term, no viewed/starred IDs, no values). |
| §6.3 (backups) | P16 · D101 · D102 | Backup retention **3 months**; bucket ACL + encryption-at-rest; ≈24h RPO, single-region, ephemeral-staging integrity verification. |
| §6.4 (TLS / headers) | D107 (amends D64) | Headers grow from HSTS-only to **CSP** (Mixpanel-allowlisted, no `unsafe-inline`) + `nosniff` + framing + **`Referrer-Policy`** (lands P9). |
| §6.5 (deploy / SPA) | D112 | Server-advertised client version → stale-tab refresh prompt + graceful stale-write failure. |
| §6.6 (testing / a11y) | D79 · D82 · D104 · D108 · U6 | WCAG **2.2** SCs into the checklist (drop 4.1.1 Parsing); cross-caller isolation test; forged-`alg` JWT tests; dev-provider compiled-out + CI assertion; virtualized-grid ARIA (`aria-rowcount`/`-rowindex`/`-setsize`) test. |
| §5.1/§5.2 + client architecture (unsectioned) | D110 | Name-search Fuse + phonetic index built in a **Web Worker**; IndexedDB memo dropped. |
| Profile-UI subsection | D113 | Toggle copy: active-side consequence inline, counterfactual in the `?` tip. |

### 4. `PRD.md`

| Section | Decisions / findings | Change |
|---|---|---|
| §1 (overview / limitations) | C15 · P19 · D54 | No-email/unidentified brothers are staff-maintained, can't self-serve; population 18+; composite-system framing already present. |
| §3.1 (endpoints) | C10 | Align endpoint wording to the real API surface. |
| §3.2 (deferred list) | D85 · D100/R11 | **Remove** the denormalized-snapshot item (promoted to MVP); **add** MITAA bulk-CSV import as a deferral. |
| §4 / §4.1 / §4.3 (capability matrix) | C5 · C6 · C13 · D106 | Name the manager-set-deceased consent/Ghost-side-effect exception; add a headshot add/change/remove row; "Toggle Privileges" → "Change role"; verify owner-vs-other; write matrix. |
| §5 / §5.5 (pages / a11y) | C12 · D79 · U6 | Count `/brother/new` as an explicit admin page (reconcile "four pages"); WCAG 2.2 AA; ARIA-row checks. |
| §5.6.1 / §5.6.3 / §5.6.4 | C3 · D110 | `allowCommentReplyEmail` consistent manager column+filter; search worker note. |
| §5.7.2 | C3 | `allowCommentReplyEmail` consistency. |
| §5.7.3 | D113 | Privacy-toggle copy. |
| §5.7.4 / §5.7.5 / §5.7.7 | D107 | URL-scheme allowlist + `rel=noopener` on rendered links. |
| §5.7.10 | C13 · D106 | "Change role"; server-enforced last-admin. |
| §6.1 (integration reqs) | D96 · D99 · D103 | Synchronous push; scheduled audit; newsletter bidirectional reconcile. |

### 5. `USER-MANUAL.md`

| Topic | Decisions / findings | Change |
|---|---|---|
| §1 / §11 | P19 · C15 | 18+ population; no-email brothers are staff-maintained. |
| §8 (MITAA) | D89 · P5 · P17 | Disclose the identity/public-death always-flow off the switch; coarse photo-grant asymmetry disclosed. |
| Add-Brother | C12 | Document the admin-only Add-Brother page. |
| Sign-out | D95 / U4 | Document the new Sign-out control. |
| Backup custodianship | D101 | Name the admin as custodian of the downloadable backup archive. |

### 6. `PRE-LAUNCH-TOOLS.md`

| Topic | Decisions / findings | Change |
|---|---|---|
| Notice link | D77 | Build-checklist item: link the public privacy notice from Book's login/landing so notice precedes first-sign-in provisioning. |
| JWKS seed | D87 | Seed/persist Ghost JWKS so a cold start survives a Ghost blip. |
| Ephemeral staging | D102 · D108 | Setup/teardown IaC scripts (double as DR runbook + backup-integrity job); dev provider's only legitimate home. |

### 7. `CODING-PROJECT-PLAN.md`

| Topic | Decisions / findings | Change |
|---|---|---|
| Phase gates §7/§10 | D111 | AA-baseline labels/instructions (3.3.2) ship **with** each page (Phases 3–5); enrichment `?` tips + manual stay Phase 6; per-phase gate wording. |
| CI gate | D108 | CI assertion that the prod artifact can't instantiate `DevIdentityProvider`. |
| Search phase | D110 / U5 | Web-Worker index build scheduled with the search work. |
| Ops tooling | D100 · D102 | Offline-restore procedure; migration/regen-thumbnails as operator scripts; ephemeral-staging + backup-verification job in the tooling inventory. |

---

## Part 2 — Cross-reference retrofit catalog (`DECISIONS.md`)

Per Forrest's instruction, **every** amendment relationship is made symmetric: a later decision's *"amends/supersedes/refines/extends/reverses/corrects/clarifies D##"* gets a matching forward-pointer on the **earlier** decision — across the whole ledger, including the pre-existing D1–D76 internal relationships that currently carry only back-references.

**Convention:** append one italic line to the earlier decision (after its `**Why:**` paragraph): `*Later updated by: D## (reason); D## (reason).*` — multiple modifiers grouped on one line, in numeric order.

### Forward-pointers onto D1–D76

| Earlier | Later modifiers to add |
|---|---|
| D5 | D16 (visibility taxonomy extends it) |
| D8 | D94 (3-month headshot-version purge) |
| D11 | D27 (Linter first-party path), D60 (Mailman deferral) |
| D15 | D58 (Book serves the canonical name across the language boundary) |
| D16 | D19 (three-tier projection; supersedes "managers see all"), D93 (third-party-data toggles) |
| D17 | D94 (headshot-version purge) |
| D18 | D37 (US/CA state-province vocabulary) |
| D19 | D28 (verification coupled to edits) |
| D20 | D104 (alg-pin + callback nonce/redirect allowlist), D105 (SPOF dependency documented) |
| D22 | D109 (401/403 session-expiry recovery for the 4h cap) |
| D23 | D94 (purge), D107 (host-only discipline extended to the session cookie), D109 (image-403 re-auth) |
| D24 | D82 (`/api/me` split), D95 (adds Sign-out, reverses "no logout"), D112 (version endpoint) |
| D25 | D109 (preserve-edits extended to the 401 path) |
| D26 | D83 (single-instance; "correct at any instance count" retired) |
| D28 | D68 (import-verification open question resolved), D80 (deceased consent/verification snapshot) |
| D35 | D66 (phonetic A/B criterion), D110 (Web Worker; IndexedDB memo dropped) |
| D41 | D90 (dedicated MITAA export), D92 (export audit ping), D100 (bulk-delete dropped) |
| D45 | D59 (MITAA master-switch redefinition), D89 (MITAA opt-in + copy), D93 (`shareEmergency` off, `shareSpousePartner` added), D113 (toggle copy presentation) |
| D48 | D80 (deceased snapshot/restore) |
| D52 | D55 (Ghost-sync mechanics), D63 (backup/restore), D68 (import), D100 (bulk import deferred; bulk-delete dropped) |
| D53 | D111 (help split along the WCAG line), D113 (reuses the toggle-tip) |
| D55 | D96 (synchronous diff-push), D98 (audit reports Book-internal orphans), D99 (audit scheduled), D101 (post-restore reconcile), D103 (scoped newsletter bidirectional exception) |
| D56 | D70 (id-vs-uuid correction), D81 (`ghostMemberUuid` removed), D106 (`adminNote` unwritable via PATCH) |
| D58 | D78 (roster auth subject-pin; IAM front door dropped), D112 (roster contract version) |
| D59 | D89 (MITAA opt-in/copy), D90 (dedicated export), D100 (bulk import deferred) |
| D61 | P10 (names-not-values on all streams), D91 (log-reader local-only), D92 (export audit event), D99 (trace ids + scheduled audit), D101 (forensic privileged-roster log) |
| D62 | P6 (event-property no-PII rule), D88 (drops `name`; keeps `ignore_dnt`) |
| D63 | D68 (restore exempt from import rules — already noted; make symmetric), D101 (offline restore + structural validation + forensic log), D102 (continuous integrity verification) |
| D64 | D107 (headers grow: CSP + nosniff + framing + Referrer-Policy) |
| D67 | D79 (WCAG 2.2 SCs), U6 (virtualized-grid ARIA), D111 (help phase split) |
| D68 | D100 (MITAA bulk import deferred to backlog) |
| D70 | D81 (capture deferred; `ghostMemberUuid` removed) |
| D71 | D100 (R15 execution-hardening folded in) |
| D72 | D102 (staging → ephemeral), D108 (dev provider compiled out of prod) |
| D73 | D112 (stale-SPA refresh prompt) |
| D75 | D84 (compression off the event loop, precomputed) |
| D76 | D82 (ETag keyed by role — S6), D85 (snapshot stays backend-internal), D95 (read-side superseded by `no-store`) |

### Forward-pointers onto D77–D113 (internal)

| Earlier | Later modifiers to add |
|---|---|
| D96 | D103 (the stale-Book-record clause superseded by auto-reconcile) |
| D99 | D101 (immediate post-restore trigger), D103 (audit gains scoped write), D106 (role audit feeds the forensic log) |
| D100 | D101 (restore detailed), D105 (cited in the no-step-up rationale) |
| D101 | D105 (socially-engineered-restore residual absorbed into the threat model), D106 (role-change audit extends the forensic log) |
| D104 | D105 (layered to close replay/forced-login) |

*(D83, D85, D87, D97 are heavily **relied upon** by later decisions but not *amended* — no forward-pointer needed; the reliance reads naturally from the later decisions' own text.)*

### D77–D113 finalize tidies
Numbering is already contiguous and correct (D77→D113, no gaps/dupes). Spot-checks for the finalize: confirm D100's parenthetical "(and its provisional D100)" reads cleanly now that the real D100 is assigned; verify every "(amends D##)" in a D77–D113 **title** has its body counterpart. No renumbering required.

---

## Part 3 — C4 umbrella: TBD mechanics to close (Session 2)

C4 ("MVP mechanics 'TBD/Session 6' in delivered docs") is the one worksheet row left blank by design — its mechanics are closed here. Separate **genuine gaps** from **stale forward-refs** already overtaken by D63/D68/D100.

1. **CSV escaping / formula-injection rules** (with **S9**) — concrete spec: neutralize leading `= + - @ \t \r` on every text cell (prefix `'`, OWASP), applied to **both** the general export (D41) and the MITAA export (D90); add the malicious-leading-char test. Lands in `DATABASE-SCHEMA §10` + the §6.6 test plan.
2. **Ghost-sync discrepancy-report JSON shape** — define the read-only reconciliation audit's output (D55/D99): categories (`unmatchedGhostMember` / `fieldDrift` / `missingGhostMember` / `bookInternalOrphan` / `newsletterDrift`), per-row `{category, profileId, ghostMemberId, field?, bookValue?, ghostValue?, bookChangedAt?, ghostChangedAt?, resolution?}`. Lands in `ENGINEERING-DESIGN §5.1` + `API-SPEC` (the admin audit endpoint).
3. **MITAA column format** — the two-tier export layout (D90/D89): identity + public-death columns for all; contact columns populated only where `allowShareWithMITAA=true`; emergency never. Lands in `DATABASE-SCHEMA §10`.
4. **Stale forward-refs to retire** — the §5.8.2 "format edge cases & the D28 verification-field tension Session 6" pointer is **overtaken by D68** (import ignores verification fields); the restore "format Session 6" pointer is **overtaken by D63** + now D101; the bulk-import mechanics are **overtaken by D100** (deferred). Replace these "TBD" pointers with the settled references rather than new specs.

---

## Part 4 — Composite §13 summary: outstanding (Session 2)

§13 currently runs through **Session 5**. To finish:
- **Add the Session 6 paragraph** (U2, U3, U4, U5, U7, C9, C15, R18 → D109–D113; U4 stays D95; C15 no-number).
- **Add the overall roll-up:** disposition counts across all 81 (a/b/c/d), the full new-decision list **D77–D113** (37 decisions), and the items consciously closed as (b)/(d) (e.g. P3 no-tombstone, P8 adminNote, P17 photo grant, P16 retention).
- **Disposition tally to compute** during the sweep (from §12): the (a) vs (b)/(d) split, confirming all 81 placed.

---

*Drafted at the start of the resolution / propagation pass. Inputs: `DESIGN-REVIEW-COMPOSITE.md` §12 worksheet + `../DECISIONS.md` D77–D113. This map is the doc-by-doc checklist for Session 2.*
