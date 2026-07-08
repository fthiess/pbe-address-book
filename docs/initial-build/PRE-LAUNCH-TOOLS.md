# PBE Address Book — Pre-Launch Tools & Migration Inventory

A living checklist of the **standalone utilities** needed to clean up and migrate data into Book before launch, plus the **ongoing operational side-tools** that support Book but live outside it. Started in Session 5 (2026-06-05); grown as needs surface through Sessions 5–6. See `history/DESIGN-HISTORY.md` for the roadmap and `DECISIONS.md` for rationale.

*(Graduated from the planning vault into the repo under `docs/initial-build/` at the Session-6c close-out, 2026-06-07. Amended in the **early-feedback pass** (2026-06-24) — D123/D125.)*

**Why this list exists.** Book deliberately keeps one-time and external concerns *out* of its own codebase (decision D57): the initial data load runs exactly once and is a messy manual merge across several sources, and some recurring tasks (MITAA format-mapping, the Linter) are separate programs by design. Collecting them here keeps the build plan honest about everything that has to exist *besides* Book for launch to succeed.

## A. One-time pre-launch migration tools

These run once (or a handful of times during pre-launch dry runs) and are then retired.

| Tool | Purpose | Source / adapt from | Status |
|---|---|---|---|
| **Ghost member export** | Pull the current Ghost membership (emails, names, notes, newsletter subscription state, member IDs) for the cleanup and seed steps. | `ghost-member-export` (existing) | Adapt |
| **Mystery-email / Ghost-account dedup** | Collapse the multiple Ghost accounts some brothers have today down to **one primary email per brother** — the prerequisite that lets Book assume a single primary email. Identify the ~70 historical unidentified Ghost addresses. | `mystery-email-address` (existing) | Adapt |
| **Big Brother / Little Brother import** | Source the Big Brother edges (the directed tree) to populate `bigBrotherId`. | `pbe-family-tree` (existing) | Adapt |
| **Headshot & early-class-year import** | Source headshot photos and, for many pre-1970 brothers, class years. | `pbe-yearbook-project` (existing) | Adapt |
| **Ghost pull-and-seed utility** | One-time read from Ghost of the member ID (→ `ghostMemberId`), notes (→ `adminNote`), and current newsletter-subscription state (→ `allowNewsletterEmail`) — seeding the preference *from* Ghost so existing opt-outs are honored. (The comment-reply preference is no longer a Book field — DECISIONS N68.) | New (this session) | To build |
| **Initial bulk-loader** | Write the merged Constitution-roster + MITAA + Ghost + family-tree + yearbook dataset into Book, including `ghostMemberId` (which the normal admin CSV import does **not** accept). | New (this session) | To build |

**Sequencing note.** The dedup (collapse Ghost to one-primary-email-per-brother) must precede the pull-and-seed and the bulk-load. The merge across sources is expected to be substantially manual (human + AI), with these tools doing the mechanical pulls and the final write.

## B. Ongoing operational side-tools (not one-time, not in Book)

Recurring utilities that live outside Book by design — listed here so they aren't mistaken for Book features or for one-time migration tools.

| Tool | Purpose | Status |
|---|---|---|
| **MITAA format mapping** | Map MITAA export spreadsheets ↔ Book's canonical CSV (import side) and a MITAA-shaped export from Book's admin CSV (export side, consenting brothers only). Format kept flexible; MITAA's requirements aren't fully known (decision D59). | Future / as-needed |
| **PBE News Linter** | First-party, non-browser consumer of Book's read-only roster (`GET /api/roster`), authenticated by a Google service-account identity token (decision D58). Its own design (runtime, article source, language) is a separate project (the PBE News Linter). | Separate project |
| **Ephemeral staging + backup-integrity verification** | Setup/teardown infrastructure-as-code that stands a throwaway Book environment up on demand and tears it down after use, so nothing is left idle to rot. A periodic job (weekly by default) uses these scripts to restore the latest backup into a fresh environment, run structural validation + a hydrate-and-count smoke check + checksums, then tear it all down. The **same scripts double as the single-region DR recovery runbook**, so every backup test also rehearses standing Book up from nothing (decision D102; ENGINEERING-DESIGN §6.3). This ephemeral environment is also the **only legitimate home of the `DevIdentityProvider`** — never anything adjacent to production (decision D108; ENGINEERING-DESIGN §6.6). | To build |
| **Email-bounce report** | Each run of the Ghost reconciliation audit produces a **bounce report** — the brothers whose PBE News email is bouncing, with counts and dates — by reusing the existing `export-bounces.js` join of Ghost `email_failed_event` member-events to members. An out-of-band admin artifact (logged / CSV); **not** surfaced in Book's UI (decision D120; ENGINEERING-DESIGN §5.1). | `ghost-member-export/export-bounces.js` (existing) | Adapt / fold into the audit |
| **Maintenance / outage page** | A static `maintenance.html` plus an operator **script** that swaps it in at the Firebase Hosting / edge layer for planned downtime (restore, migration, deploy), independent of the backend; the SPA also self-renders a maintenance/outage fallback when the backend is unreachable (decision D118; ENGINEERING-DESIGN §6.3). | New | To build |

## C. Possible future tools (deferred)

Recorded so the options aren't lost; none are MVP.

- **Mailman bridge** — if Mailman integration is ever taken up, a lightweight HTTP-form-POST client against the MIT-hosted Mailman 2.1.34 admin forms (in-Book vs. side-tool undecided; decision D60).
- **Mailman replacement migrators** — tooling to migrate **pbe-brothers-official** into Ghost as a second newsletter, or to stand up and load a self-hosted **Mailman 3** (decision D60).

## D. Launch-time build & configuration checklist (not tools)

A short list of **non-tool** items that must be in place at launch — configuration and wiring rather than standalone utilities — gathered here so they aren't lost between the design docs and the build.

- **Public privacy-notice link from Book.** PBE's privacy notice — which already names Mixpanel, MITAA, and Ghost — is public at `https://pbe400.org/privacy/`. Book must **link it from the login/landing surface** so the notice precedes the first-sign-in auto-provisioning (decision D77), and **from a persistent footer on every page** inside the app (decision D116). A build-time item, pending Book.
- **Seed the persisted Ghost JWKS.** Book verifies the Ghost member JWT against Ghost's JWKS, and under scale-to-zero a cold-started instance cannot verify any sign-in until it has those keys. The JWKS store is therefore **seeded/persisted with Ghost's current keys** (and refetches single-flighted and capped) so a cold start during a brief Ghost/JWKS hiccup doesn't lock everyone out (decision D87; ENGINEERING-DESIGN §2.7).
- **Create the `sessions` + `authNonces` Firestore collections with TTL policies.** Book persists its server-side session record and the single-use login `state` nonce in Firestore so they survive scale-to-zero cold starts. Each collection needs a native Firestore **TTL policy on its `expiresAt` field** so expired records self-clean. Provision both collections and their TTL policies as part of environment setup / infrastructure-as-code (decision D125).
- **Bundle the diminutives/nickname dictionary for Name Search.** A small static given-name↔nickname dataset (an open diminutives dictionary) is compiled into the Web-Worker search index so "Bob" matches "Robert", A/B-tunable alongside the phonetic experiment. A build-time bundled reference-data asset, like the ISO country list and majors vocabulary (decision D123).
