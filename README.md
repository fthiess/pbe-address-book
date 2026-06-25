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

> **Status: Phase 1 — the walking skeleton (in progress).** Phase 0 (the
> monorepo, the toolchain, the CI gate, the deterministic fake-data generator,
> and the role-switchable `DevIdentityProvider`) is complete. Phase 1a's
> **backend read path** is now in: a Firestore-hydrated in-memory cache, the
> server-side privacy-projection seam (brother role), and `GET /api/profiles`
> served brotli/gzip-negotiated and `no-store`. Still ahead in Phase 1: the
> staging infrastructure bring-up (the rest of 1a) and the Ghost auth bridge
> plus the SPA shell and rendered list (1b).

## Layout

| Path | Contents |
|---|---|
| `apps/web/` | The React + Vite SPA (shadcn/ui on Tailwind v4). |
| `apps/api/` | The Node + TypeScript backend (Fastify) destined for Cloud Run. |
| `packages/shared/` | Types and the shared client/server validation module (the one `Profile` type). |
| `packages/help-content/` | The single-source in-page help / manual entries. |
| `tools/fake-data/` | The deterministic seeded fake-data generator (D65). |
| `tools/migration/` | One-time pre-launch migration utilities (never deployed). |
| `docs/` | Design and build documentation, by build. The initial release lives in `docs/initial-build/`. |
| `.github/workflows/` | The CI pipeline (the tests-green gate). |

## Prerequisites

- **Node.js 24+** and npm (see `.nvmrc`).
- **A JVM** (JDK 17+) — the Firestore emulator runs on the JVM. On Windows:
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
```

## Environments

Three environments, by design (`CODING-PROJECT-PLAN.md` §4): **local** (this
machine — Vite, the API, the Firestore emulator, fake data, the
`DevIdentityProvider`), **staging** (an ephemeral, script-provisioned cloud Book
holding fake data only), and **production** (`book.pbe400.org`, real data, the
real Ghost integration). The `DevIdentityProvider` is locked out of production
by four independent layers (D108) and must never run anywhere near it.
