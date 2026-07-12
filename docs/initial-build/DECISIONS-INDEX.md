# PBE Address Book — Decision Index

The subsystem → currently-authoritative-decisions map for [DECISIONS.md](DECISIONS.md). **Consult this file first and read only the entries it cites — never read the whole log into context** (it exceeds 400 KB). Every PR that appends to the log updates the affected line(s) here in the same commit.

How to read a line: chains run oldest → newest; **bold** marks the current word on a matter; plain IDs stand as written but may be amended in detail (each entry's own "*Later updated by*" trailer is authoritative); ~~struck~~ IDs are wholly superseded, kept in the log for their reasoning. `D*` = design decisions, `N*` = implementation notes.

## Architecture & stack

- Foundations: **D2** (custom app, no framework), **D3** (TypeScript end-to-end, Biome), **D4** + **D6** (SPA bulk-download of the full permitted set), **D10** (React + Vite; Node on Cloud Run; Firebase Hosting), **D29** (shadcn/ui; TanStack Table/Virtual).
- Runtime shape: **D83** (single Cloud Run instance, scale-to-zero — the one in-memory cache is authoritative).

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
- Sessions: D22 (4-hour cap) → **D109** (non-destructive 401/403 recovery) → **D125** (sessions + nonce persisted in Firestore) → **N53** (active revocation on trust withdrawal) → **N76** (central 401 interceptor → signed-out; carve-out: the edit-form Save path keeps the form per D109); cookie must be named `__session` **N5**; JWKS persisted across cold starts **D87**.
- Identity: **D21** (IdentityProvider seam); **D97** (email uniqueness via in-memory index; alias clause dropped by N65); **N8** (de-brothered sign-in denied).

## Permissions & visibility projection

- Read projection: D5 → D16 → **D19** (three roles, three tiers) → **D82**; exhaustive keyof-Profile tables **N9**; staff-internal classes **N10**; whole-record omission **D115** (de-brothered) + **D124** (unlisted).
- Write side: **D106** (field allowlist, object predicate, last-admin invariant) + **N70** (managers can't write privacy-hidden toggle fields) + **N44** (role PUT creates the users doc).
- Impersonation: **N31** (admins step *down* a role; server-side effective role).

## Privacy & consent

- Consent toggles & copy: D45 → **D89** (MITAA opt-in) → **D93** (third-party data defaults off) → **D113** (consequence-copy model) → **N68**.
- Posture: **D77** (no CCPA machinery) + **D116** (persistent footer privacy notice).
- PII egress: **D95** (`no-store` PII endpoints; sign-out control), **D88** (Mixpanel identity drops name), **D80** (mark-deceased consent snapshot; narrowed by N68).

## Verification

- **D28** (verification coupled to content edits) → **D48** (surfacing + staleness nudge) → **D68** (CSV import ignores verification fields) → **D80** (snapshot on mark-deceased) → **N73** (read reclassified public — verification visible to all brothers, verifier Canonical Name shown; write coupling unchanged); endpoint **N40**.

## Directory page

- Columns & grid: **D33** → **N16** (resizable, keyboard-operable) → **N27** (double-click auto-fit); **N17** (labels/status treatments), **N22** (4-digit Class year), **N15** (column lens mirrored to URL); sort **D34**; virtualization & thumbnail prefetch **D42** (images app-served per D126).
- Behavior: **D36** (deceased default-hidden, dual marker), **D38** (filter panel; filterable ⟺ visible) + **N51** (always returns collapsed) + **N81** (one-sided open-bound year/ID ranges), **D39** (stars) + **N80** (masthead clean-slate clears Starred-only), **D40** (row opens the Profile page), **N26** (short search placeholder).
- Manager/admin action bar & selection: D41 (bulk-delete since dropped by D100; exports per D90/D92) → **N79** (selection persists across search/filter/sort/navigation — D41's clear-on-view-change reversed; a per-instance in-memory bucket beyond D31's three; select-all unions the view; Export spans the whole selection; explicit Clear).

## Name search

- D35 (fuzzy + phonetic over tokenized names) → D66 (A/B criterion) → **N19** (Beider-Morse via bmpm) → **D110** (Web Worker; memo dropped) → **D123** (curated nickname expansion); package + highlighting **N20**.

## Profile page

- Model: **D43** (view/edit, two-up layout) + **N33** (edit mode accumulates no history), **D44** (one layout, four role projections), **D50** (validation/save/conflict) with guard order **N11**.
- Controls: **D46** → **N36** (Radix Combobox, editable address, sanitized repeatables); polish N35 → **N37** (incl. phone canonicalization).
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
- Newsletter flag & audit: ~~D103~~ (bidirectional write-back — reverted) → **N69** (alignment audit fully read-only; bounce report a separate CSV; one generic outage screen).
- Ghost-less brothers always tolerated: **N72**.

## Linter roster

- D27 → **D58** (read-only roster endpoint, canonical names served) → **D78** (in-code Google-JWKS verification, subject-pinned) → **D112** (versioned contract + stale-SPA refresh prompt).

## MITAA & Mailman

- MITAA: D59 (manual, low-trust) → **D89** (opt-in default) → **D90** (dedicated consent-aware export; de-brothered excluded per D115).
- Mailman: **D60** (out of MVP; replacement directions recorded).

## API conventions

- Surface: **D24** (as amended by D82/D95/D112/D126).
- Concurrency: **D25** (optimistic, on updateTime) → N13 → **N46** (quoted ETag; If-Match normalized); structural write checks **N12**.
- Endpoints: **N28** (`POST /api/exports`), **N40** (`PUT …/deceased`), **N44**; create flow N71 → **N72** (two-step create; email optional); single-record read `no-store` on all branches **N75**.

## Security hardening

- **D86** (rate limits), D107 → **N54** (security headers; CSP hashes CI-pinned), **D108** (DevIdentityProvider lockout, four layers), **D64** (Google-managed TLS), **N55** (generic 500 body; ungated sign-out), **D105** (threat posture) + **N56** (accepted residual risks).
- Dependency/supply-chain hygiene: **N74** (transitive-dep advisory policy — assess reachability, prefer `overrides` when no patched parent version exists; the uuid CVE-2026-41907 fix, Dependabot #7). Open dev-only residual: OFC-234 (@opentelemetry/core via firebase-tools). Sibling: OFC-152 (CodeQL alert triage).

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
- Staging/UAT: D72 → **D108** + **N18** (staging wipe-reseeds every deploy) + **N64** (UAT on test data, non-production); backup-verification staging per D102.

## Accessibility & help

- A11y: D32 → D67 (three verification layers) → **D79** (WCAG 2.2 AA, CI-gated) → **D111** (help split along the WCAG line).
- Help model: **D53** (layered, embedded, toggle-tips) → **D111**; consent-copy pattern **D113**.

## UI shell & app-wide

- **D30** (client prefs in localStorage) + **N15**; **D31** (three-bucket URL/state model) → **N79** (adds a fourth bucket: per-instance transient row selection) + **N80** (masthead clean-slate `reset` vs. place-preserving back-nav); **N21** (full-bleed shell); **N24** (masthead font-size control); **D117** → **N57** (admin-set system banner); **D119** (loading overlay); **N77** (client-rendered 404 for unknown URLs); **N78** (long-lived-tab new-version toast).

## Admin surfaces

- **D52** (control-panel surfaces; amended by D55/D63/D68/D100/D114); **D51** + **N50** (segmented role control; delete preserves Directory state); N49 (4c-2 privileged-action slice; its role-control item superseded by N50).
- Bug reports: **D121** → **N60** (Book receives bugs, doesn't track them) → **N61** (endpoints; two-value status; DELETE verb).

## Process & scope

- **D1** (doc homes), **D11** (MVP line; → D27, D60); re-plans **N30** (Phase 4), **N39** (4c split), **N59** (Phase 5.5 batches), **N67** (5b split), **N62** (Phase 7.5).

---

*When the initial build closes, this index becomes the skeleton of the as-built digest: the chronological log freezes into `history/` and the digest replaces it as the read-first artifact (see the dev-workflow skill, "The decision log").*
