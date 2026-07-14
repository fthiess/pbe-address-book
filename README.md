# PBE Address Book ("Book")

[![CI](https://github.com/fthiess/pbe-address-book/actions/workflows/ci.yml/badge.svg)](https://github.com/fthiess/pbe-address-book/actions/workflows/ci.yml)

A members-only directory for the brothers of PBE — a sibling to the Ghost
newsletter site at `pbe400.org`, to live at `book.pbe400.org`.

This repository is a TypeScript monorepo. It is being built phase by phase per
[`docs/initial-build/CODING-PROJECT-PLAN.md`](docs/initial-build/CODING-PROJECT-PLAN.md);
the design is settled in the companion docs (PRD, database schema, engineering
design, API spec) and the decision log
([`docs/initial-build/DECISIONS.md`](docs/initial-build/DECISIONS.md)) is
authoritative for *why* anything is the way it is.

**Project status & roadmap.** Development is tracked ticket by ticket in Linear
(project *PBE-Book*, not publicly viewable). The phased roadmap lives in
[`CODING-PROJECT-PLAN.md`](docs/initial-build/CODING-PROJECT-PLAN.md), and how
each phase actually landed is recorded in the decision log's `N`-notes
([`DECISIONS.md`](docs/initial-build/DECISIONS.md)).

## Layout

| Path | Contents |
|---|---|
| `apps/web/` | The React + Vite SPA (shadcn/ui on Tailwind v4). |
| `apps/api/` | The Node + TypeScript backend (Fastify, esbuild-bundled) on Cloud Run. |
| `packages/shared/` | Types and the shared client/server validation module (the one `Profile` type), capabilities, canonical names, vocabularies. |
| `packages/help-content/` | The single-source in-page help / manual entries. |
| `tools/fake-data/` | The deterministic seeded fake-data generator (D65) + the staging seed/link scripts. |
| `tools/migration/` | One-time pre-launch migration utilities (never deployed; built in Phase 8). |
| `e2e/` | The Playwright end-to-end suite (including the axe WCAG 2.2 AA scans). |
| `scripts/` | The CI gate guards: no-dev-provider, tokens-in-sync, bundle-size, CSP hashes, CI timing. |
| `infra/` | Staging provisioning + Workload Identity Federation setup scripts, and the environment notes. |
| `ghost-bridge/` | Reference mirror of the Ghost-side relay (`book.hbs` + routes snippet); the deployment home is the `pbe-news-ghost-theme` repo — keep the two in sync. |
| `docs/` | Design and build documentation, by build. The initial release lives in `docs/initial-build/`. |
| `.github/workflows/` | `ci.yml` (the tests-green gate) and `deploy-staging.yml` (deploy on merge). |

## Prerequisites

- **Node.js 24+** and npm (see `.nvmrc`).
- **A JVM (JDK 21+)** — the Firestore emulator runs on the JVM, and
  `firebase-tools` v15 requires Java 21. On Windows:
  `winget install --id Microsoft.OpenJDK.21 -e`.
- Everything else (Vite, Vitest, Playwright, the Firebase CLI) is installed
  locally via `npm install`; nothing needs to be global.

## Getting started

```bash
npm install
npx playwright install --with-deps   # one-time: download the E2E browsers

npm run check        # Biome format + lint
npm run typecheck    # tsc across every package
npm run build        # build libs, the SPA bundle, and the API bundle
npm run test         # Vitest unit/integration (non-emulator)
npm run test:emulator   # Vitest with the Firestore emulator running
npm run seed         # seed the deterministic fake dataset into the emulator
npm run e2e          # Playwright end-to-end
npm run verify:gate  # the full tests-green gate, end to end

npm run ci:timing            # per-step timing for the latest CI + deploy runs
npm run ci:timing -- --runs 10   # trend across the last 10 runs (spot pipeline regressions)
```

## Running the app locally

The SPA, the API, and the Firestore emulator run side by side. The
`DevIdentityProvider` gives a Ghost-free, role-switchable login (D72), so no
Ghost is needed locally.

```bash
# 1. Start the emulator and seed the fake dataset (leave it running):
npx firebase emulators:start --only firestore   # in its own terminal
npm run seed                                     # once, into the running emulator

# 2. Start the API against the emulator (its own terminal):
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run dev --workspace apps/api

# 3. Start the SPA (its own terminal); it proxies /api and /img to the API:
npm run dev --workspace apps/web
```

Open the SPA, and on the sign-in screen use the **Local development** role
switcher (brother / manager / admin) to sign in. In production that block is
absent — only the real Ghost **Sign in** button ships (`import.meta.env.DEV`),
and the dev session route exists only in the dev API entry point (D108).

## Environments

Three environments, by design (`CODING-PROJECT-PLAN.md` §4):

- **Local** — this machine: Vite, the API, the Firestore emulator, fake data,
  the `DevIdentityProvider`.
- **Staging** — a persistent cloud Book, live at
  `https://pbe-book-staging.web.app` (GCP project `pbe-book-staging`: Firebase
  Hosting → Cloud Run + Firestore + a private image bucket, provisioned by
  `infra/provision-staging.sh`). **Fake data only.** Sign-in goes through the
  real Ghost bridge against the self-hosted ghost-staging instance
  (`staging.pbe400.org`) — never production Ghost (D72).
- **Production** — `book.pbe400.org`, real data, the real Ghost integration.
  Not yet stood up; it comes up in Phase 8 (migration & cutover).

The `DevIdentityProvider` is locked out of production by four independent
layers (D108) and must never run anywhere near it.

## CI/CD

Every push runs `ci.yml` — the same `verify:gate` you run locally (format,
lint, typecheck, build, unit + emulator tests, Playwright + axe, the bundle
budget, and the guard scripts). A green CI on a push to `main` triggers
`deploy-staging.yml`, which authenticates to GCP **keylessly via Workload
Identity Federation** (no service-account key exists) and deploys Hosting,
Firestore rules, and Cloud Run. Each deploy wipe-reseeds the staging profiles,
images, and tester link (the `STAGING_AUTOSEED` repo variable), so staging
never drifts from the generator. One landmine documented in
[`infra/README.md`](infra/README.md): the Firebase CLI deploy step is pinned to
**Node 20** to dodge a Node-24 undici/STS bug — don't "fix" it.

## License

The source code is released under the **MIT License** ([`LICENSE`](LICENSE)) —
you're welcome to use, modify, and redistribute it. The MIT grant covers the
**code only**. The Phi Beta Epsilon names and marks — "Phi Beta Epsilon,"
"PBE," the crest, the triangle device, and the gold leaf — and the brand-artwork
asset files that depict them are trademarks and brand assets of **Phi Beta
Epsilon Corporation**, are reserved, and are **not** licensed for reuse. See
[`TRADEMARKS.md`](TRADEMARKS.md) for the specifics.
