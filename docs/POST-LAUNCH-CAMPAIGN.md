# PBE Address Book — Post-Launch Campaign

The work plan for the period after the public launch at the 2026-09-19 Reunion: **finish everything that was planned pre-launch and deferred by the compressed cutover (D180), plus every open bug and improvement, before any new feature work.** Written at the 2026-09-16 post-launch triage (Forrest's calls throughout); it replaces the "Stage 5 — re-triage after launch" placeholder in `LAUNCH-SCHEDULE.md`.

**Read this first when starting any post-launch session**, then the target ticket's guidance comment (every scheduled ticket has one, dated 2026-09-16), then the governing decisions via `initial-build/DECISIONS-INDEX.md`. Sessions follow the `dev-workflow` skill as usual: plan gate, branch, PR, review at the depth the change warrants, tiered merge, live test, close-out.

## Ground rules for the campaign

- **No new features until the campaign is complete.** OFC-354 (name-search results order, a PRD-level design change) is explicitly out of scope and is the **first item after** the campaign closes, as a design session under the design methodology.
- **Book is live with real members.** Every merge deploys staging only; production ships by release tag (`deploy-prod.yml`), and Forrest decides when. Batch several sessions into one production release where sensible; a single cosmetic fix does not need its own tag.
- **Any out-of-band Firestore write is followed immediately by a forced cold start** (D181). The cache and the edit tokens both hydrate only at cold start; until then the change is invisible and edits to the touched records fail with 412.
- **Sessions run serially in the order below** unless Forrest reorders. Priority set the order; execution may deviate, but the dependencies noted below hold.
- **Model:** Opus at standard effort unless the row says Fable. Fable is used where the surface is auth, live member data, or a dependency on the auth bridge, and the merge pauses for Forrest on those (Gate 4).
- **Labels are the session index.** Filter Linear by `PL-n` to see a session's tickets; the label description carries the scope. When a session closes, strip its label from the closed tickets. Deleting the label entity is Forrest's (Linear settings).

## The sessions

| Label | Model | Tickets | Scope and why it is here |
|---|---|---|---|
| **PL-1** | Fable | OFC-340 | **Ghost pull-and-seed**: `ghostMemberId`, `adminNote`, and the real newsletter-consent state from Ghost. Until it runs, Book→Ghost push no-ops for every brother and every Ghost opt-out shows as unresolvable drift. Now an in-place backfill in the D181 pattern. Fork: intermediate file (recommended) vs direct write. |
| **PL-2** | Opus | OFC-425, 329, 310 (item 4), 334, 312 | **Production hardening and availability**: Cloud Build SA and `run-sources` grant, stray UAT bucket, the two Mixpanel decisions, Firestore delete-protection + PITR into the provisioner, the uptime check (scale-to-zero interaction is the design question), the JWKS-failure alert, maintenance-mode root coverage, the gsutil audit. Forrest runs the gcloud. |
| **PL-3** | Opus | OFC-427, 422, 428 | **Directory behavioral bugs**: tablet horizontal-scroll capture from the pinned columns, the toast that swallows clicks, the iPhone class-year keyboard. Repro test first on each. |
| **PL-4** | Opus | OFC-420, 418, 426, 237, 360 | **The cosmetic batch.** OFC-360 (hide the empty Professional section) is Forrest's call. |
| **PL-5** | Fable | OFC-295, 419, 242 | **Admin lifecycle** (deep; merge pauses): sole-admin email self-lockout, self-demotion warning, dangling unusable admins. Three forks are Forrest's at the plan gate. Urgent-ish: Forrest is the sole admin and about to hand out roles. |
| **PL-6a** | Opus | OFC-333 (PR 1) | **Backup-integrity job, code**: `--database` on the restore CLI, the `verify-backup` tool, the forensic-entry suppression decision. D151's five shape decisions are settled input. |
| **PL-6b** | Opus | OFC-333 (PR 2), 356 | **Backup-integrity job, infra + docs**: `provision-verify.sh`, `verify-backup.sh` with trap teardown, the DR runbook; plus the operator runbook and the one-document-or-two fork. Target is production from day one; first run confirmed by eye. |
| **PL-7** | Opus | OFC-317, 294, 301, 254 | **Ghost write-path and logging robustness**: log the HTTP status on failed pushes (do first), bound the Ghost HTTP waits, harden the audit sink, confirm on membership-changing saves. |
| **PL-8** | Opus | OFC-423, 352, 414, 280, 385 | **Gate and deploy hygiene**: env-var list derived from the env file (load-bearing), conflict-marker and decisions-unique gate steps, typecheck the build-time TS, the lockfile delta script. Every new step in both `package.json` and `ci.yml` (D141). Runs before PL-9/10 so the delta script is used on them. |
| **PL-9** | Fable | OFC-416, 417 | **Security dependencies**, one PR per dependency: nanoid; Dependabot #211 split into web/build bumps and the jose + fastify pair with a live Ghost sign-in test. Rebuild by local `npm update`, never merge the Dependabot branch (N159). |
| **PL-10** | Opus | OFC-303, 304 | **The two failing tool majors**, separate PRs: Biome 2 config migration, Vitest 4. Full local gate for each. |
| **PL-11** | Opus | OFC-261 | **Contrast-matrix audit and fixes**: the build-time 1.4.11/1.4.3 net axe cannot provide, the D67 checklist extension, and the fixes it finds. |
| **PL-12** | Opus | OFC-359, 325, 119 | **Performance**: commit the overlay harness first, then CLS on both pages (re-measure before fixing), then the per-profile-open roster rebuild. |
| **PL-13** | Opus | OFC-228 | **Automated Book↔Ghost integration tests** against ghost-staging. Fork: hot CI path vs separable check vs scheduled. |
| **PL-14** | Opus | OFC-382, 381, 430 | **Pre-Dec-7 client-staleness hardening and the version surface**: version toast re-arms for later deploys; the SPA↔API compatibility epoch with a 426 forced refresh (epoch placement is Forrest's fork); investigate-and-propose semantic version numbers and user-facing change notes (OFC-430, added 2026-09-16). **The first two must land before the Dec 7 newsletter**, the next load event. |
| **PL-15** | Opus | OFC-314, 408, 264, 331, 343 | **Docs and workflow**: move the user manual, OSS acknowledgements in repo and app, the TODO/PICKUP scan, memory landmine index, the UAT wind-down lessons and thank-yous (Forrest's part). |
| **PL-16** | Opus | OFC-424, 410, 285, 388, 370, 415, 302 | **Small code-quality guards**: `StoredProfile`, the NameRecord hoist, help-label single source, CSV exhaustiveness (Forrest decides the three fields), Mixpanel identify guard, split `Directory.tsx` (after PL-3/4 stop editing it). |
| **PL-17** | Opus | OFC-274, 361, 357, 284, 307, 68 | **Decide-or-close.** Each needs Forrest's yes/no more than code; several will close as won't-fix with the reasoning recorded. |

### Ordering dependencies worth holding

- PL-1 before PL-7: the Ghost write path does not fire in production until PL-1 seeds `ghostMemberId`, so PL-7's logging is only observable afterwards.
- PL-5 before PL-7: OFC-254 reuses the confirmation dialog PL-5 introduces.
- PL-8 before PL-9 and PL-10: the lockfile delta script guards the dependency work.
- PL-3 and PL-4 before PL-16: the `Directory.tsx` split must not collide with bug fixes in the same file.
- PL-10 before PL-16's complexity re-baseline: Biome 2 changes the diagnostics.
- PL-12 before PL-17's OFC-68 decision: measure what OFC-119 leaves behind first.
- PL-14 before Dec 7 regardless of where the campaign stands.

## Out of the campaign, deliberately

Each of these carries a comment (2026-09-16) naming its trigger.

- **OFC-354** name-search results order: the first item after the campaign, as a design session.
- **OFC-348** schema-migration scaffold: triggered by the first real schema change.
- **OFC-332** post-restore bulk Ghost re-push: triggered by a restore whose discrepancy report is too long to hand-fix.
- **OFC-413** proximity vocabulary gaps: waiting for user reports.
- **OFC-217 / 257 / 258** Ghost 6: gated on Ghost 6 shipping and the ghost-staging upgrade. Worth one check at campaign start: what version is Ghost Pro running?
- **OFC-319** worktree-enforcement hook, **OFC-279** tracker choice, **OFC-398** Outlook/Apple Mail check: Forrest's to schedule.
- **OFC-181** accepted residuals: tracking only.
- The Post-MVP feature epics (map view, mentoring, analytics page, Big Brother graph, Ghost content search, MITAA import/export, Mailman, HEIC, seasonal addresses, honorary brothers, bug-report email alerts, AI sysadmin, and the rest): untouched until the campaign closes and OFC-354 is designed.

## Closed at this triage

- **OFC-345** production cutover: done 2026-09-15/16 (N179).
- **OFC-238** initial-load roles: requirement discharged by the cutover plan and verified on production.
- **OFC-346** soft-launch watch and **OFC-347** public launch close after the Reunion (Forrest).

## Production state the campaign inherits (2026-09-16)

- 1,480 profiles loaded; every Full name populated (D181); 135 headshots; Forrest the sole admin.
- Backups landing twice daily on `pbe-book-prod-backups`; three alert policies enabled to Forrest's email; public-access prevention enforced on both buckets; scaling pin max 1, scale-to-zero.
- Firestore delete protection and PITR were **disabled** at launch; Forrest was handed the one-line `gcloud firestore databases update` commands on 2026-09-16. PL-2 confirms and bakes them into the provisioner.
- Book→Ghost push is a no-op for every brother until PL-1. **Do not resolve newsletter drift in Book's favour before then.**
- Fifteen Ghost addresses do not match a Book email (`pbe-data-merge/ghost_unmatched_after_cleanup.csv`); those brothers cannot sign in until an alternate email is added by an admin.
- The Linear connector still posts as Forrest, not Claude's member (N178).

## Related documents

- `initial-build/LAUNCH-SCHEDULE.md` — the pre-launch schedule this campaign follows on from; its Stage 5 row points here.
- `initial-build/CUTOVER-PLAN.md` §8 — what the cutover left owed; every item there is a PL session.
- `initial-build/DECISIONS-INDEX.md` — read-first map into the decision log.
- `.claude/skills/dev-workflow/` — the session methodology, including triage conventions.
