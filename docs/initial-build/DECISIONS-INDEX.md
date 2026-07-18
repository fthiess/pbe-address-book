# PBE Address Book — Decision Index

The subsystem → currently-authoritative-decisions map for [DECISIONS.md](DECISIONS.md). **Consult this file first and read only the entries it cites — never read the whole log into context** (it exceeds 400 KB). Every PR that appends to the log updates the affected line(s) here in the same commit.

How to read a line: chains run oldest → newest; **bold** marks the current word on a matter; plain IDs stand as written but may be amended in detail (each entry's own "*Later updated by*" trailer is authoritative); ~~struck~~ IDs are wholly superseded, kept in the log for their reasoning. `D*` = design decisions, `N*` = implementation notes.

## Architecture & stack

- Foundations: **D2** (custom app, no framework), **D3** (TypeScript end-to-end, Biome), **D4** + **D6** (SPA bulk-download of the full permitted set), **D10** (React + Vite; Node on Cloud Run; Firebase Hosting), **D29** (shadcn/ui; TanStack Table/Virtual).
- Runtime shape: **D83** (single Cloud Run instance, scale-to-zero — the one in-memory cache is authoritative).
- Overview diagrams: **N100** (`docs/architecture/` — token-palette SVGs, slide + annotated README pairs in light/dark; README `<picture>` embed).

## Read path, caching & performance

- Store & cache: D7 (Firestore system of record; in-memory cache) → D26 (snapshot listener, demoted to safety net by D83) → **D82** (split bulk read: roster projection + self-fetch) → **D83** → **D85** (GCS snapshot for cold-start hydration).
- Dataset compression: D75 → **D84** (brotli-11 precomputed on write, off the event loop).
- HTTP caching: **D73** (content-hashed immutable assets, no-cache HTML) + **N25** (no-cache SPA shell at every route) → **N78** (long-lived-tab version.json toast); ~~D76~~ (conditional GET — retired by **D95** `no-store`); **N75** (per-role `/api` responses `no-store` on *all* branches — Hosting caches header-less `/api` rewrites `max-age=600`; overlaps OFC-212); planned app-level conditional read: **N62** + **N63** (Phase 7.5).
- Bundle discipline: **D74**. Slow-load UX: **D119** (threshold-gated loading overlay).

## Data model & vocabularies

- Collections & ids: **D12** (three collections; private state split), **N6** (single numeric id = Constitution ID).
- Fields: **D13** (classYear `number | null`), **N34** (middleName retained), **N38** (US-only ZIP validation).
- Names: **D15** (constructed Canonical Name, derived ambiguity; served to the Linter per D58).
- Majors: D14 → **D69** (checked-in vocabulary + seed/reconcile script); interim display names **N29**.
- Country/state: D18 (ISO country codes) → **D37** (US/CA state-province vocabulary); display names via **N7**.
- Ghost-coupled fields: D56 → D70 → **D81** (uuid capture deferred); **N68** (allowCommentReplyEmail removed entirely).

## Auth & sessions

- Ghost bridge: D20 → **D104** (alg-pin, nonce, redirect allowlist) → **D105** (Ghost accepted as single point of compromise); implementation **N1** (RS512, Node crypto), **N2** (one live relay, hardcoded callback allowlist).
- Sessions: D22 (4-hour cap) → **D109** (non-destructive 401/403 recovery) → **D125** (sessions + nonce persisted in Firestore) → **N53** (active revocation on trust withdrawal) → **N76** (central 401 interceptor → signed-out; carve-out: the edit-form Save path keeps the form per D109) → **N98** (full D109 recovery built: a child-window re-auth resumes the held request with its original `If-Match`, deduped + was-authenticated-gated; the directory read recovers in place, OFC-153; **amends D109** — image retry is a re-arm-after-re-auth not status-aware per-image re-auth, and the `sessionStorage` draft stash is dropped for in-memory + a recover-here message); cookie must be named `__session` **N5**; JWKS persisted across cold starts **D87**.
- Gate liveness check: **OFC-147** (present-and-de-brothered session → 401 + destroy) → **D130** (also a role-**downgrade** re-check: live cache role below the session snapshot → 401 + destroy, OFC-239; the free per-request backstop to N53's active revocation, now that role is cache-resident per D128).
- Identity: **D21** (IdentityProvider seam); **D97** (email uniqueness via in-memory index; alias clause dropped by N65); **N8** (de-brothered sign-in denied).

## Permissions & visibility projection

- Read projection: D5 → D16 → **D19** (three roles, three tiers) → **D82**; exhaustive keyof-Profile tables **N9**; staff-internal classes **N10**; whole-record omission **D115** (de-brothered) + **D124** (unlisted); `role` on the profile, **public** — **D128** (reverses OFC-139's staff-only; stored optional, normalized→brother at hydration).
- Write side: **D106** (field allowlist, object predicate, last-admin invariant) + **N70** (managers can't write privacy-hidden toggle fields); role write **D128** (re-pathed to `PUT /api/profiles/{id}/role`, protected field, last-admin over `ProfileCache.adminCount`; supersedes N44/N50's `users`-doc model) → **D129** (last-admin counts only *usable* admins — `isUsableAdmin`: living, non-de-brothered, has usable email; nominal-only admins were an org-lockout hole, OFC-241) → **D130** (enforce the usable-admin invariant across *all five* removal/transition paths — role/delete/mark-deceased/de-brother/PATCH-email — via `cache.isSoleUsableAdmin`; a promote-guard rejects making an ineligible brother admin; and the session gate 401s a role **downgrade** re-check, OFC-239) → **N86** (live-test fixes: promote-guard covers *any* staff role, not just admin; the last-admin/promote refusals are surfaced in the mark-deceased/de-brother/role UIs — they were silently swallowed) → **D135** (clearing a previously-usable email is gated behind a client-side "this locks *name* out" confirmation on all three edit paths; no new server guard — the general clear stays soft, the sole-usable-admin case keeps its D130 hard block; OFC-272) + **N105** (`wouldClearUsableEmail` pure predicate; and the PATCH-email `409 last_admin` now mapped client-side — the one path N86 left throwing the generic banner).
- Impersonation: **N31** (admins step *down* a role; server-side effective role).

## Privacy & consent

- Consent toggles & copy: D45 → **D89** (MITAA opt-in) → **D93** (third-party data defaults off) → **D113** (consequence-copy model) → **N68** → **N102** (switch copy — label/whenOn/whenOff — folded off `consent.ts` into the help-content registry, Option A; `ConsentSwitch` takes an `entryKey`) → **N103** (the counterfactual is dropped from the `?` as redundant with the inline consequence — amends D113; a switch's `?` shows only its optional static `toggleTip`, so only MITAA and Listed keep one; the `?` unified onto `ControlHelp`) → **N107** (6b-5: the `shareEmergency`/`shareSpousePartner` toggles relocated into the Privacy & consent group beside the reachability switches, and their off-copy rewritten to name the field so each row self-identifies away from it; **OFC-268 declined — D93 stands**, emergency/spouse stay opt-in — OFC-270) → **N115** (one canonical switch order across the Profile view and edit pages — Email, Telephone, Mailing, Emergency, Spouse, PBE News, MITAA, Directory listing; the view digest completed with the Emergency/Spouse lines and an always-shown Directory-listing line — OFC-278 — current).
- Posture: **D77** (no CCPA machinery) + **D116** (persistent footer privacy notice).
- PII egress: **D95** (`no-store` PII endpoints; sign-out control), **D88** (Mixpanel identity drops name), **D80** (mark-deceased consent snapshot; narrowed by N68; Ghost member now deleted/re-created rather than left subscribed-off — **D134**).

## Verification

- **D28** (verification coupled to content edits) → **D48** (surfacing + staleness nudge) → **D68** (CSV import ignores verification fields) → **D80** (snapshot on mark-deceased) → **N73** (read reclassified public — verification visible to all brothers, verifier Canonical Name shown; write coupling unchanged); endpoint **N40**.

## Directory page

- Columns & grid: **D33** → **N16** (resizable, keyboard-operable) → **N27** (double-click auto-fit) → **N112** (auto-fit measures the full course-chip strip, not the primary only — OFC-277); **N17** (labels/status treatments), **N22** (4-digit Class year), **N15** (column lens mirrored to URL); Course column shows ALL courses as chips **D136**/**N106** (amends D33's primary-only; sort still keyed on primary), header background fills past the last column **N106** (OFC-262); course chip + aligned name unified as `CourseChipName` (shared by the Course filter and the Profile course picker) **N108** (refines N106) → **N111** (filter checkbox aligns to a wrapping name's first line); sort **D34**; virtualization & thumbnail prefetch **D42** (images app-served per D126); horizontal scrollbar: grid fills to the viewport bottom so the bottom-edge scrollbar is on-screen **N85** (measured max-height; corrects **N84**'s overlay-scrollbar root cause), with **N84**'s `.always-scrollbars` (classic non-overlay) kept as a complementary always-visible-scrollbar improvement — OFC-205.
- Behavior: **D36** (deceased default-hidden, dual marker), **D38** (filter panel; filterable ⟺ visible) + **N51** (always returns collapsed) + **N81** (one-sided open-bound year/ID ranges) + **N110** (multi-selects dismiss on outside-click/Escape via `useDetailsAutoClose`), **D39** (stars) + **N80** (masthead clean-slate clears Starred-only) + **N99** (Star also on the Profile page; the set hoisted to a shell provider shared by the Directory and Profile — OFC-256), **D40** (row opens the Profile page), **N26** (short search placeholder); **N92** (mobile "Options" fold — below `md`, search stays visible and the toggles/columns/filters/action-bar collapse into one disclosure, closed by default).
- Manager/admin action bar & selection: D41 (bulk-delete since dropped by D100; exports per D90/D92) → **N79** (selection persists across search/filter/sort/navigation — D41's clear-on-view-change reversed; a per-instance in-memory bucket beyond D31's three; select-all unions the view; Export spans the whole selection; explicit Clear); **N99** (a subtle vertical rule separates the Select column from the adjacent universal Star to reduce staff misclicks — OFC-64).

## Name search

- D35 (fuzzy + phonetic over tokenized names) → D66 (A/B criterion) → **N19** (Beider-Morse via bmpm) → **D110** (Web Worker; memo dropped) → **D123** (curated nickname expansion) → **N83** (fold atomic Latin letters NFKD can't — ø/æ/ß/…; worker result ⊇ substring match, so a query never drops a hit it once showed); package + highlighting **N20**.

## Profile page

- Model: **D43** (view/edit, two-up layout) + **N33** (edit mode accumulates no history), **D44** (one layout, four role projections), **D50** (validation/save/conflict) with guard order **N11**.
- Controls: **D46** → **N36** (Radix Combobox, editable address, sanitized repeatables) → **N108** (Combobox gains a `renderOption` prop; the course picker shows chips via the shared `CourseChipName` — OFC-265 follow-up); polish N35 → **N37** (incl. phone canonicalization) → **N107** (6b-5: the emergency/spouse share toggles unified into the Privacy & consent group; Admin Note promoted to its own "Administrative" view section, left column under Preferences; repeatable Remove-button centring + spacing — OFC-270/271/260) → **N109** (live-test: the repeatable spacing was inert — `space-y` cancelled by the rows' `m-0` → 0px; real fix is flex `gap` + `self-start` on the Add button; and the "Administrative" Admin-Note section reaches the edit page too — current).
- Headshot: **D47** (crop-on-upload, staged until Save).
- Deceased: D49 → **D122** (birth/death years, b./d. display).
- Prev/next: N32 → N45 → **N52** (sessionStorage stash of the displayed set; pure derivation).

## Images

- Storage: **D8** + **D17** (versioned, immutable, WEBP in GCS) → **D94** (3-month purge of superseded versions).
- Serving: ~~D23~~ (CDN signed cookies) → **D126** (app-served from the private bucket via `/img/*`; no CDN, no load balancer); thumbnails D9 → D42 → **D126**; strict path parse + effective-role visibility **N43**.
- Pipeline: **N42** → **N47** (seams, ordering, purge) + **N48** (live-test fixes); regenerate-thumbnails feature dropped **D114**.

## Ghost sync

- Frame: **D54** (one composite system), **D55** (single-master, Book authoritative; the read-only-into-Book invariant restored by N69).
- Push path: D96 → **N65** (Ghost-first-gated update; prior-email alias dropped); pushed field set per **N66** + **N68**; write ordering/compensation **D98**; lifecycle seam N41 → **N67** (5b split, roster stub).
- Email↔Ghost-record invariant (a brother has a Ghost member iff living + not-de-brothered + usable email — the `shouldHaveGhostMember` predicate): **D133** (auto-create on the PATCH that adds the email) → **N96** (implemented: PATCH create/delete/update lifecycle; email removed from the create surface — `POST` 422s it, a create is Book-only; a Ghost-member collision is rejected on `email` not linked — Option B; de-brother-reverse gate unified on the predicate) → **N114** (Option-B collision guard extended to the email-change PUT — an email *change* that collides `422`s on `email`, not a generic `502`; Ghost's PUT-collision `422` verified against ghost-staging — OFC-276) + **D134** (mark-deceased now deletes the member and un-mark re-creates it — amends D80; audit exempts a deceased brother like a de-brothered one).
- Newsletter flag & audit: ~~D103~~ (bidirectional write-back — reverted) → **N69** (alignment audit fully read-only; bounce report a separate CSV; one generic outage screen); event-fetch bound **N97** (audit/bounce member-events fetched with a 24-month NQL date bound, not the whole append-only history — OFC-231; a bigger page `limit` is foreclosed by Ghost 6.0, OFC-217) → **N113** (fixes N97's field name — the bound must filter `data.created_at`, not the bare `created_at`, which Ghost's `/members/events` allowlist rejects `400`; and makes the audit's *advisory* newsletter-events read swallow failure to `[]` while the bounce report's read still surfaces 502 — OFC-275).
- Ghost-less brothers always tolerated: **N72**.

## Linter roster

- D27 → **D58** (read-only roster endpoint, canonical names served) → **D78** (in-code Google-JWKS verification, subject-pinned) → **D112** (versioned contract + stale-SPA refresh prompt).

## MITAA & Mailman

- MITAA: D59 (manual, low-trust) → **D89** (opt-in default) → **D90** (dedicated consent-aware export; de-brothered excluded per D115).
- Mailman: **D60** (out of MVP; replacement directions recorded).

## API conventions

- Surface: **D24** (as amended by D82/D95/D112/D126).
- Concurrency: **D25** (optimistic, on updateTime) → N13 → **N46** (quoted ETag; If-Match normalized); structural write checks **N12**.
- Endpoints: **N28** (`POST /api/exports`), **N40** (`PUT …/deceased`), **N44**; create flow N71 → N72 → **N96** (create is Book-only — email removed from `POST /api/profiles`, which 422s one; the Ghost member is minted later on the email-adding PATCH); single-record read `no-store` on all branches **N75**.

## Security hardening

- **D86** (rate limits), D107 → **N54** (security headers; CSP hashes CI-pinned), **D108** (DevIdentityProvider lockout, four layers), **D64** (Google-managed TLS), **N55** (generic 500 body; ungated sign-out), **D105** (threat posture) + **N56** (accepted residual risks).
- CodeQL baseline: **N88** (triaged all 8 `main` alerts → 0 open: fixed the `EMAIL_RE` polynomial-ReDoS via a 254-char cap, added `permissions: contents:read` to the CI gate, and escaped backslashes-before-pipes in the Ghost-audit Markdown escaper `cell()`; dismissed-with-reason the untrusted-checkout, test-RSA-key, and three `writeRateLimit`-config rate-limit false-positives; OFC-152). Making CodeQL a *required* check needs branch protection created from scratch (main was unprotected) → **N91** (branch protection created 2026-07-14: require PR + 0 approvals, CodeQL + Verify gate as `strict` required checks, force-push/delete off, admin bypass allowed; OFC-246). The untrusted-checkout alert re-raises when its checkout line changes (#1→#19).
- Dependency/supply-chain hygiene: **N74** (transitive-dep advisory policy — assess reachability, prefer `overrides` when no patched parent version exists; the uuid CVE-2026-41907 fix, Dependabot #7) → **N89** (accept `@opentelemetry/core` as a documented dev-only residual — dev-only via firebase-tools, no clean upstream fix, an `overrides` pin would break pubsub's `^1.30.1`; revisit when upstream moves to otel ≥ 2.8; OFC-234).

## Logging & analytics

- Logging/audit: D61 → **D91** (no audit-log egress to external LLMs) → **D92** (export audit via notify endpoint); stream structure **N14**.
- Analytics: D62 → **D88** (Mixpanel identity payload).

## Backups, restore & DR

- D63 → **D101** (offline hardened restore; forensic privileged-roster log) → **D102** (≈24h RPO; ephemeral verification staging); JSON export **N58**.
- Bulk ops: **D100** (no online bulk writes; restore is an offline maintenance event) → **D114**; maintenance screen D118 → **N69**; bounce reporting D120 → **N69**.
- Migrations: **D71** (code defaults vs versioned scripts); initial data load **D57** (external one-time tooling).

## Ops

- **D99** (trace IDs on the save path; consolidated periodic sysadmin job — audit read-only per N69); backend env vars **N3**.

## Testing & environments

- **D65** (Vitest + emulator; Playwright; committed fake-data generator) + **N23** (planted name collision) + **N4** (fixed dev ids).
- Staging/UAT: D72 → **D108** + **N18** (staging wipe-reseeds every deploy) + N64 (UAT on test data, non-production) → **D132** (UAT = its own Phase 7.7 on staging in a frozen-autoseed window — code deploys continue, data survives; real-named testers via a private-GCS roster + `seed:staging-testers`, blank-beyond-identity profiles; UAT photo corpus; real magic-link flow required — email fix OFC-252; theme integration split off as Phase 7.6; plan `UAT-PLAN.md`, cutover items parked in the `CUTOVER-PLAN.md` stub); backup-verification staging per D102; **N82** (docs-only merges skip the post-merge CI re-run → no deploy; PR gate unfiltered); **N90** (reseed wipes `users`/stars too, deterministic deploy; column prefs are a localStorage residual reset in-app, OFC-197).
- CI/deploy action pins: **N87** (all `uses:` bumped to latest Node-24 majors, OFC-62; the Firebase-CLI step's `@v7` action pin is orthogonal to its load-bearing `node-version: "20"` install — don't collapse them).

## Accessibility & help

- A11y: D32 → D67 (three verification layers) → **D79** (WCAG 2.2 AA, CI-gated) → **D111** (help split along the WCAG line). Automated axe covers text contrast (1.4.3) but **not 1.4.11 non-text contrast** of custom indicators — **OFC-261** (Phase 7/7c) adds a token-pairing contrast matrix + a manual state-indicator check (N101, the consent-off-ring miss).
- Help model: **D53** (layered, embedded, toggle-tips) → **D111** → **N102** (the `CircleHelp` toggle-tips wired across every page via `HelpToggleTip`/`ControlHelp` — Radix Popover, D111's above-baseline layer; registry is the single source read by the UI and the 6c manual; interim `<details>` `HelpTip` retired) → **N103** (live-test polish: switch `?` drops the counterfactual, keeps only static context) → **N116** (6c-1: the **About page** — the first standalone guidance *page*, `/about` from the avatar menu; copy in `src/content/about.md` compiled to HTML at **build time** by `aboutHtmlPlugin` so no Markdown parser ships; the repo's first `dangerouslySetInnerHTML`, made safe by build-failing guards in `compileAboutHtml`; About's copy is its **own** source, not registry-generated — D53's no-drift rule is about per-control help, not descriptive prose — current); consent-copy pattern **D113** (counterfactual-in-`?` since removed, N103).
- Product naming (member-facing copy): **N116** — "PBE Address Book" on first use, "the Address Book" thereafter; bare "Book" is internal shorthand only (code, comments, docs). ⚠ The rule **stops at member-facing copy**: the admin Ghost alignment-audit surface deliberately keeps "Book" as a system name contrasted with "Ghost" ("Book value | Ghost value") — don't "fix" it. No mechanical guard beyond a unit assertion over `about.md`.
- Icons: **N101** — `lucide-react` is the app icon set (one-sweep 6a adoption); every icon a monochrome Lucide glyph inheriting `currentColor` + `aria-hidden` (no emoji/multicolour icons); `DebrotheredMark` and the Avatar silhouette kept bespoke.

## UI shell & app-wide

- **D30** (client prefs in localStorage) + **N15** → **N104** (the column-lens "foreign shared link" test compares `cols` to the saved value, not mere URL presence — so an impersonation hard reload no longer misreads the user's own view as foreign and breaks "Reset to default columns"; OFC-263, refines D30/D31; residual OFC-274); **D31** (three-bucket URL/state model) → **N79** (adds a fourth bucket: per-instance transient row selection) + **N99** (stars hoisted into that same per-instance shell context, shared by the Directory and the Profile — OFC-256) + **N80** (masthead clean-slate `reset` vs. place-preserving back-nav); **N21** (full-bleed shell); **N24** → **D131** (masthead font-size **and** theme toggles now live in the avatar menu; PBE News top-bar link restored; wordmark truncates so the bar never clips — current) + **N93** (icon-only masthead controls use `sr-only`, not `hidden`, so they keep an a11y name on a phone — WCAG 4.1.2) + **N94** (the PBE News link URL is environment-specific — build-time `BOOK_PBE_NEWS_URL`, defaults prod, staging.env overrides to ghost-staging); **D117** → **N57** (admin-set system banner); **D119** (loading overlay); **N77** (client-rendered 404 for unknown URLs); **N78** (long-lived-tab new-version toast).

## Admin surfaces

- **D52** (control-panel surfaces; amended by D55/D63/D68/D100/D114); **D51** + ~~N50~~ → **D128** (segmented role control now reads `record.role`; role write re-pathed to `PUT /api/profiles/{id}/role`; last-admin over the ProfileCache); N49 (4c-2 privileged-action slice).
- Bug reports: **D121** → **N60** (Book receives bugs, doesn't track them) → **N61** (endpoints; two-value status; DELETE verb).

## Process & scope

- **D1** (doc homes), **D11** (MVP line; → D27, D60); re-plans **N30** (Phase 4), **N39** (4c split), **N59** (Phase 5.5 batches), **N67** (5b split), **N62** (Phase 7.5), **D132** (UAT → Phase 7.7 + theme-integration Phase 7.6; `UAT-PLAN.md` + `CUTOVER-PLAN.md` stub), **N95** (second Todo triage: sessions 5.5i–5.5l appended, order 5.5k→l→i→j; the rest of the backlog scheduled onto Phases 6–8 by Linear label; pre-session ruling D133).
- Licensing: **D127** (repo is MIT — code only; PBE names, marks + brand-artwork files reserved to Phi Beta Epsilon Corporation).

---

*When the initial build closes, this index becomes the skeleton of the as-built digest: the chronological log freezes into `history/` and the digest replaces it as the read-first artifact (see the dev-workflow skill, "The decision log").*
