# PBE Address Book — Cutover Plan (Phase 8) — STUB

> **This is a placeholder, not a plan.** Created 2026-07-14 alongside `UAT-PLAN.md` (DECISIONS D132) so that cutover-scope items discovered before Phase 8 have a recorded home. It is filled in at Phase 8 planning, following the dev-workflow skill's `launch-and-cutover.md` methodology: every launch must be **reversible** (a tested way back), **observable** (health legible within minutes), and **incremental** (exposure grows in steps). Until then, `CODING-PROJECT-PLAN.md` §9 remains the authoritative sketch of the migration-and-cutover sequence.

## Parked here so far (accumulating before Phase 8 planning)

- **Production deploy workflow** — a manually-dispatched, deliberate promotion (never merge-triggered; CODING-PROJECT-PLAN §5): `infra/environments/prod.env`, `pbe-book-prod` provisioning + WIF, the prod-hardening notes from `infra/README.md`, and no seeding steps ever pointed at prod. **Ticket: OFC-253.**
- **Theme cutover** — Phase 7.6 deploys the Book-integrated theme to Ghost-staging only; `pbe400.org` stays on the pre-Book theme until cutover. The staging↔prod theme diff (account-portal links → Book, plus the D55 disable-Ghost-member-editing flip) is therefore a cutover artifact to carry and apply here.
- **UAT wind-down feed-in** — UAT-PLAN §10: the tester cohort's experience informs the staged-exposure plan; some UAT testers are natural candidates for the early-exposure ring.

## Sections to be written (skeleton)

1. **Scope and preconditions** — what must be true before cutover is scheduled (UAT exit criteria met, migration rehearsed clean on staging per §9, all fix-before-cutover tickets closed).
2. **Rollback plan** *(written first, per the methodology)* — numeric trigger conditions, the mechanism and time target for each lever (redeploy previous, DNS back, restore data), and the data-considerations answer for anything written during a bad window.
3. **Production environment bring-up** — `pbe-book-prod`, the prod deploy workflow (OFC-253), Secret Manager population, Ghost Admin key for production.
4. **Data migration and the initial Ghost↔Book sync** — the §9 / `PRE-LAUNCH-TOOLS.md` sequence: dedup → pull-and-seed → bulk load → one-time sync; dry-run record.
5. **Ghost theme and portal flip** — the Book-integrated theme to `pbe400.org`; disable Ghost member editing; redirect account UI to Book (D55).
6. **DNS and TLS** — `book.pbe400.org` → Firebase Hosting; Google-managed cert provisioning.
7. **Staged exposure and the first-hour watch** — Forrest → brothers-in-the-know → full-list announcement; the first-hour checklist; who is watching.
8. **Post-launch steady state** — the Book→Ghost push live, the alignment audit cadence, backups verified against production.
