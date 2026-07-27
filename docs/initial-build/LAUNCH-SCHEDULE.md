# PBE Address Book — Launch Schedule

The calendar-bearing plan for getting Book from a hardened staging application to a publicly launched production service, expressed as **stages**. Created 2026-07-26 (DECISIONS **D152**), when the remaining work was re-indexed off the old phase labels and onto stage labels in Linear.

This document is the **single source for the schedule and for the phase→stage mapping**. `CODING-PROJECT-PLAN.md` remains the single source for what the work *is* and what "done" means for each workstream; it carries pointers here rather than repeating any of this. Dates churn and the plan is a 90 KB reference every new session reads, which is why the two are separate files — the same reasoning that split `UAT-PLAN.md` and `CUTOVER-PLAN.md` out of the plan before it.

## Stages and phases are different structures, and both are live

A **phase** asks *"is this workstream complete and good?"* Its answer is its gate, and those gates still decide whether a body of work is finished. A **stage** asks *"when does this happen, given the August blackout and the immovable September 19 launch?"*

The two are orthogonal and **they do not map one-to-one.** Stage 2, for instance, contains a piece of Phase 7 (7c), a large piece of Phase 8 (the migration tools and the cutover *planning*), and standalone operations work that belongs to no phase at all. Anyone who tries to force a bijection between the two will conclude the plan is broken; it isn't, they are simply different axes over the same work.

The switch point is precise: **session 7b-3 is the last work completed under phase numbering.** 7b-4 had already been moved out by D151. Everything after that — 7b-5, 7b-6, 7c, and Phases 7.5, 7.7, 7.8 and 8 — is what got re-indexed onto stages.

Stage labels live in Linear, one per work session, each label's description carrying its scope. Filter by the stage label to see a session's tickets, and **read a ticket's guidance comment before planning** — every scheduled ticket received one at the 2026-07-26 triage, and they carry the pairing rationale, the landmines and the design forks.

## The schedule

| Stage | When | What |
|---|---|---|
| **1.05** | Mon Jul 27, first | Docs reconciliation: this document, the additive overlay on `CODING-PROJECT-PLAN.md`, D152/D153 (OFC-349), folding in OFC-335 |
| **1.1** | Mon Jul 27 | **Forrest:** Ghost-staging outbound email (OFC-252) + theme zip and Mixpanel snippet uploaded to Ghost-staging (OFC-337). **A hard blocker for everything downstream.** |
| **1.2** | Jul 27–28 | `seed:staging-testers`, the photo corpus, and the deploy-workflow `paths-ignore` (OFC-248 / OFC-249 / OFC-336) |
| **1.3** | Jul 28–29 | D74 route code-splitting and the D119 overlay re-measure (OFC-323 / OFC-324). Runs **before** 1.5. |
| **1.4** | flex | Pre-UAT polish (OFC-290 / OFC-318 / OFC-313). **The true drop-first item** — anything dropped here simply becomes a UAT fix. |
| **1.5** | Jul 29–30, **last in Stage 1** | **Phase 7.5, the client data-layer unification (OFC-179)** — Forrest's call to run it pre-UAT. Two PRs: 7.5a the store (must land pre-UAT), 7.5b the server `304` (may cross the kickoff). **DEEP** — `/code-review` at high effort, and it pauses for Forrest. |
| **2.1** | **~Jul 31 – Aug 12**, wind-down Aug 13 | **The UAT window** (OFC-338), plus the backup absence-alert verification (OFC-330) |
| **2.2–2.3** | during UAT, Forrest | Ghost-account dedup (OFC-339) — **start as early as possible, it is the longest chain** — and course curation (OFC-320) |
| **2.4–2.5** | during UAT | Phase-8 migration tools pulled forward: pull-and-seed (OFC-340), the bulk loader and adapters (OFC-341) |
| **2.6** | during UAT | **Write `CUTOVER-PLAN.md`** (OFC-342 + OFC-238) — the rollback plan first |
| **2.7–2.9** | during UAT | The regression net (OFC-228); the a11y audit, measurement only (OFC-261); ops, docs and Dependabot (OFC-308 / OFC-334 / OFC-314) |
| — | **Aug 14–27** | **BLACKOUT. No changes at all.** |
| **3.1–3.5** | Aug 28 – ~Sept 4 | UAT wind-down (OFC-343); fix-before-cutover (OFC-295 / OFC-242, the a11y fixes, and any UAT blockers); the production environment and deploy path (OFC-253 / OFC-229); **dry runs until clean** (OFC-344); **cutover** (OFC-345) |
| **4.1–4.3** | ~Sept 4 – Sept 19 | Soft-launch watch (OFC-346); the backup-integrity job (OFC-333); **public launch at the Reunion, Sept 19 — immovable** (OFC-347) |
| **5** | Sept 20 onward | Post-launch. Deliberately **not** sub-divided — re-triage after launch. |

**Target the early end of the cutover window — Sept 1–4, not Sept 11.** A cutover on Sept 2 buys 17 days of real-user observation before the Reunion demo; Sept 10 buys 9.

⚠ **A slipped UAT start compresses the window, it does not move it.** The blackout fixes the end at Aug 13 no matter when the start lands. A realistic kickoff after Stage 1.5 is **Jul 31, or Aug 3 in the worst case** — and either way UAT ends Aug 13.

## Why the schedule has this shape

Two structural findings drove it, and both are worth understanding before proposing any change to the sequence.

**The blackout caps UAT at two weeks.** No changes at all happen between Aug 14 and Aug 27. A three-week UAT window straddles that gap, and a tester cohort that goes quiet for a fortnight mid-test does not come back — participation, not calendar time, is the scarce resource in UAT. So the window must *end* by Aug 13, which fixes its length far more rigidly than its start date does.

**Phase 8 sat almost entirely on the far side of the blackout.** That left roughly fifteen days to perform a first production cutover whose data load is a manual, multi-source, human-plus-AI merge — the riskiest and least reversible operation in the whole project, on the least slack. The fix was to pull the migration *tools* and the cutover *planning* into the UAT window: they are standalone programs that never ship in the deployed service and are completely invisible to testers, and `CODING-PROJECT-PLAN.md` §7 explicitly blesses interleaving them with late app-build work. The Ghost-account dedup starts immediately for a different reason — it is Forrest's own manual effort rather than a coding session, so it competes with nothing on the critical path, and §9's dedup-before-load ordering makes it the head of the longest dependency chain in the project.

## Phase → stage mapping

The authoritative mapping, for reading the phase-numbered sections of `CODING-PROJECT-PLAN.md`. It is stated here and nowhere else.

| Phase / session | Scheduled as |
|---|---|
| `7b-5` (schema-migration tooling scaffold) | Stage 5 (OFC-348) |
| `7b-6` (D74 route code-splitting) | Stage 1.3 |
| `7c` (regression net + a11y audit) | split: Stage 2.7 (e2e and Ghost integration tests) + Stage 2.8 (a11y audit) |
| **Phase 7.5** (client data-layer unification) | **Stage 1.5** — OFC-179 only; the absorbed OFC-68 and OFC-119 stay in Stage 5 |
| **Phase 7.6** (Ghost↔Book theme integration) | Stage 1.1's theme upload closes it |
| **Phase 7.7** (UAT) | Stages 1.1–1.2 (preparation) + 2.1 (execution) + 3.1 (wind-down) |
| **Phase 7.8** (backup-integrity job + DR runbook) | Stage 4.2 |
| **Phase 8** (migration and cutover) | Stages 2.4–2.6 (tools and planning) + 3.3–3.5 (production environment and cutover) |

Phases 0 through 7b-3 completed under phase numbering and have no stage.

## Open forks

Both are Forrest's to settle; each records the current lean and the alternative.

**The a11y audit's timing.** It currently runs during UAT as **measurement only** (Stage 2.8), with the resulting fixes queued into Stage 3.2 — the reasoning being that an accessibility *fix* is visible to testers while the audit itself is not, so the measurement can safely overlap the window. The alternative is to run it fully pre-UAT, which is more conservative and costs one to two days on the UAT start date — days that come straight out of the window, since the blackout fixes its end.

**Phase 7.8's placement.** It currently sits *after* cutover, at Stage 4.2. This is not a new decision so much as D151's own stated fallback being taken: D151 already recorded that the phase moving past cutover is an acceptable outcome and a better one than compressing it into cutover week, since its value is highest once the pipeline holds real member data. What must not slip with it is the cutover item that repoints the job at production, which lives in `CUTOVER-PLAN.md`.

## Related documents

- **`CODING-PROJECT-PLAN.md`** — what each phase builds and what its gate requires. Authoritative for scope; carries pointers here for timing.
- **`UAT-PLAN.md`** — the Phase 7.7 / Stage 2.1 execution detail: platform, tester provisioning, process, exit criteria.
- **`CUTOVER-PLAN.md`** — the production cutover, written at Stage 2.6.
- **`DECISIONS.md`** — **D152** records why this document exists and why the plan was overlaid rather than renumbered.
