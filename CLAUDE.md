# PBE Address Book ("Book")

Members-only directory web app for the ~700 living brothers of Phi Beta Epsilon (MIT), sibling to the Ghost newsletter site pbe400.org. The audience skews 60+ and includes slow connections: be byte-frugal, calm, and legible.

## Development workflow

Sessions follow the committed **`dev-workflow` skill** (`.claude/skills/dev-workflow/`) — invoke `/dev-workflow` before starting any task that changes code or docs. The short version: discuss and plan first, wait for explicit approval; all work on a feature branch → PR; `/code-review` for deep changes, CI-green suffices for shallow follow-ups; **merge only with Forrest's explicit OK** (merging to main auto-deploys staging).

## Stack

npm-workspaces monorepo, TypeScript end-to-end with one shared `Profile` type (D3):

- `apps/web` — React + Vite + Tailwind v4 + shadcn/ui; TanStack Table/Virtual; React Router + nuqs.
- `apps/api` — Fastify on Cloud Run, bundled by esbuild; Firestore + private GCS image bucket. Firebase Hosting serves the SPA and rewrites `/api/*` and `/img/*` to Cloud Run (single origin).
- `packages/shared` — the shared `Profile` type, validation, capabilities, canonical names.
- `packages/help-content`, `tools/fake-data`, `tools/migration`, `infra/`, `e2e/`.

Tooling: Biome (format + lint), Vitest (unit + Firestore-emulator integration — emulator tests are `*.emulator.test.ts` and need JDK 21), Playwright + @axe-core/playwright, tsx for scripts.

## Commands

- `npm run verify:gate` — the full local gate (typecheck, all tests, build, Biome, bundle-size ceiling, token drift, no-dev-provider). Must be green before any push.
- `npm run seed` — seed the emulator with fake data. Staging seed/link scripts live in `tools/fake-data`; provisioning playbooks in `infra/`.
- CI runs the same gate; a green push to `main` auto-deploys staging (`pbe-book-staging.web.app`) via the `workflow_run` deploy workflow.

## Documentation map

`docs/initial-build/` holds the delivered design docs (PRD, DATABASE-SCHEMA, ENGINEERING-DESIGN, API-SPEC, CODING-PROJECT-PLAN, USER-MANUAL, DECISIONS, PRE-LAUNCH-TOOLS, UAT-PLAN, CUTOVER-PLAN). **`DECISIONS.md` is the authoritative, append-only decision log** (`D*` design decisions, `N*` implementation notes) — when a significant decision lands, append it there, update **`DECISIONS-INDEX.md`** (the subsystem → currently-authoritative-decisions map) to match, and propagate the change to the affected docs **in the same PR as the code**. The log is huge: **consult the index first and read only the governing entries — never read the whole log.** `docs/initial-build/history/` is frozen history — never edit it. DATABASE-SCHEMA §3 is authoritative for field names and semantics.

Deferred work and bugs are Linear tickets (team Techgnosys, project PBE-Book, `OFC-*`): file tickets for anything deferred, close them with evidence when resolved.

## Standing invariants (landmines — do not violate)

- **This repo is PUBLIC.** No secrets and no real member PII anywhere in the tree — ever. Fake-data exemplar is "James Smyth '84 (#5247)"; fake Constitution IDs are > #5000.
- **WCAG 2.2 AA is a CI-gated hard requirement** (D79), including keyboard alternatives for every drag interaction (2.5.7).
- PII JSON endpoints (`/api/profiles`, `/api/me`, `/api/profiles/{id}`) are `Cache-Control: no-store` (D95). Member images are app-served from the private bucket via `/img/*` behind the session cookie; there is **no CDN and no external load balancer** (D126).
- Server-side per-role projection (`apps/api/src/projection/`) is the **single visibility-enforcement point** (D5/D82). Unlisted (D124) and de-brothered (D115) records are whole-record-omitted from the brother view.
- Cloud Run runs `max-instances=1` + scale-to-zero — one authoritative in-memory instance by design, not autoscaling (D83).
- The session cookie **must be named `__session`** — Firebase Hosting strips every other request cookie before Cloud Run (N5).
- The Firebase CLI deploy step is **pinned to Node 20** (google-auth-library STS dies under newer Node) — don't remove the pin (see `infra/README.md`).
- `DevIdentityProvider` stays compiled out of the prod bundle (D108); the gate's `assert:no-dev-provider` enforces it.
- Ghost integration is tested against self-hosted **ghost-staging** (`staging.pbe400.org`), never the live pbe400.org until production cutover. The Ghost auth-bridge theme files have a byte-identical mirror in `ghost-bridge/` — keep it in sync with the `pbe-news-ghost-theme` repo.
- Staging **wipe-reseeds `profiles` *and* `users` (per-viewer stars) on every deploy** (N18, N90/OFC-197) — don't hand-edit staging data or stars and expect them to survive; the tester link is re-applied automatically. (Column preferences live in browser localStorage and are *not* reset by a deploy — clear them in-app via the column picker's "Reset to default columns", or clear site data.)
- Book is the membership system-of-record: a brother may legitimately have **no email and no Ghost account** (~1/3 of records). Every Ghost operation must tolerate Ghost-less brothers.
