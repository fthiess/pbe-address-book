---
name: dev-workflow
description: Forrest's development-session methodology — the plan → build → review → remediate → live-test → close loop and its approval gates. Invoke at the start of ANY session that will change code or docs (feature, bugfix, refactor, ticket batch), and for triage sessions that schedule Linear tickets into work sessions, before proposing a plan or writing code. Also covers PR/merge rules, code-review depth, bugfix discipline (repro-test-before-fix), Linear ticket hygiene, triage-session conventions, autonomous Routine-triggered sessions (auto-triage → approved schedule → stop-at-PR), decision-log conventions (append-only + topic index), model/effort guidance, and the session close-out checklist. For new-project design-stage work (seed doc → PRD/engineering design → adversarial review), read design-methodology.md in this skill; for production cutovers and live-data migrations, read launch-and-cutover.md.
---

# Development Session Workflow

Every substantive session follows one loop:

**plan → build → code review → remediate → merge → live-test → remediate → close**

The gates below are firm. When a gate and expedience conflict, the gate wins; when genuinely unsure whether something clears a gate, ask Forrest rather than guessing.

**Freshness check (on invocation):** this skill's canonical upstream is the `fthiess/claude-skills` repo, cloned at `~/.claude/skills/`. When the working project carries a vendored copy (`.claude/skills/dev-workflow/`), diff it against the clone at session start — use **`diff --strip-trailing-cr -r`**, because git normalizes the committed copy to LF while the Windows clone keeps CRLF, so a plain `diff -r` reports every line as changed and false-alarms on a copy that is genuinely in sync. If the *content* differs, say so and offer to sync — usually a shallow doc-only PR bringing the vendored copy up to the upstream, or a commit+push upstream when the newer change originated in the project.

## Gate 1 — Plan first, always

Begin by discussing the work, not doing it. Review the relevant docs/tickets/code, ask clarifying questions, and propose a plan (scope, approach, what will and won't be touched, test strategy). Then **stop and wait for Forrest's explicit approval**. Clarifying questions and his answers are *not* approval — approval is an unambiguous "go." Use plan mode for substantial work. "Measure twice, cut once."

Two standing sub-rules:

- **Forrest decides genuine design forks.** Present options with a recommendation; don't pick for him. Each decided fork is recorded in the project's decision log as "Forrest's call" with the reasoning.
- **Prefer the simple path.** If earlier decisions appear to force complexity, surface the simpler alternative and confirm direction before building.

## Gate 2 — Build on a branch, gate green

- All work happens on a feature branch and lands via a PR. Never commit directly to `main`.
- Unit tests for any non-trivial logic; run the project's formatter/linter on everything.
- **Run the project's fast local checks as you iterate** (for Book: `npm run verify:fast` — gate-list sync, Biome, drift asserts, type-check, unit tests). They catch the great majority of mistakes in seconds, on local hardware, before one costs a remote CI cycle.
- **The pull-request CI run is the authoritative verification — not a local one.** Don't re-run the project's full heavy gate locally merely to confirm what CI is about to confirm: the slow parts (end-to-end, emulator/container suites, the full build) are simultaneously the slowest thing on a dev machine and the *least* faithful there, since CI runs them on the deployment platform from a clean install. Run the full local gate when there is a specific reason — the change touches something the fast lane doesn't cover (build output, CSP hashes, bundle size, e2e), or a CI failure needs a tighter debugging loop — not as a reflex before every push.
- **Never write framework-specific code from memory.** Check the actual dependency versions (`package.json` et al.), verify version-specific APIs against the official docs, and cite the page that settled a non-obvious question. When something can't be verified against official docs, flag it plainly as *unverified — from training data*; an explicit flag beats both confident hallucination and vague hedging.
- **Dependency upgrades are their own PR** — one dependency per change. Read the changelog, not the version number (semver is a promise the maintainer may not have kept), and review the lockfile diff like code.
- **Grep the staged diff for secrets before every push** (`git diff --staged | grep -iE "password|secret|api_key|token"`) — these repos are public.
- **Documentation is code.** Design docs, the decision log, API specs, and user docs are updated in the same PR as the code they describe. Append significant decisions to the decision log (`DECISIONS.md`) as they're made — following the decision-log conventions below — and propagate them to affected docs once, in place.
- **Fix known tech debt now — don't bank it.** AI has made writing code cheap, which flips the economics: a known issue — including small or low-severity ones, and code-review findings — is cheapest to fix the moment it surfaces, while the context is loaded, and it only rots if deferred. So remediate it in the session where it's found. Defer only when the fix is genuinely big enough to need its own focus and plan — and then it follows the deferral rule below (a Linear ticket with the full details, resolved in a dedicated session shortly after).
- Anything discovered but deliberately not done now — deferred features, uncertain items, rough edges — gets a Linear ticket before the session ends, not a TODO comment or a mental note. The PR description ends with a short **"Didn't touch (intentionally)"** list — adjacent issues noticed but left out of scope, each pointing at its ticket — so scope discipline is visible at review time.

## When something breaks

Debugging is where corners get cut fastest, so it has its own discipline:

- **Stop the line.** Don't push past a failing test or broken build to keep feature work moving — errors compound. Fix it, or explicitly park it with a ticket, before building further.
- **Reproduce before you fix (the prove-it pattern).** Never start with the fix. Write the reproduction test first and watch it fail; then fix; then watch it pass and run the full suite. A test written after the fix tends to prove the fix, not the bug — and the repro test stays in the suite as the regression guard. For subtle bugs, have a subagent write the repro test without knowledge of the intended fix.
- **Reduce before you fix.** Shrink the failure to its minimal case first — a minimal reproduction makes the root cause obvious and prevents patching symptoms.
- **One fix at a time.** No unrelated changes in the tree while debugging; a contaminated diff makes the fix unreviewable.
- **Can't reproduce?** Don't guess-patch. Classify the suspect (timing, environment, state), add targeted logging around it, and file a ticket with the evidence so the next occurrence convicts itself. Remove the scaffolding logging once the bug is fixed and guarded.

## Gate 3 — Code review, scaled to depth

- **Deep changes** (new subsystems, auth/privacy/security surface, tricky logic): run `/code-review` at high effort on the PR in-session and remediate the findings directly before merge. For the biggest changes Forrest may instead run `/code-review ultra` from a separate session — findings then come back as Linear tickets to triage and mitigate in the building session. If /code-review is unavailable, say so in the session before proceeding, and run its methodology manually — five independent agents across CLAUDE.md compliance, shallow bug scan, git history, prior-PR guidance, and comment accuracy, then confidence-score the findings and drop anything below ~80. Never silently substitute a single-pass review.
- **Shallow follow-ups** (CSS tweak, test data, doc fix, workflow step): self-review the edge cases; CI green suffices. Still via a PR — the review round is what's optional, never the PR.
- When unsure whether a change is deep or shallow, ask.
- Local `/code-review` subagents inherit the session model — invoke local reviews from the strongest available model.

## Gate 4 — Merge, tiered by change class and presence

Human review is highest-leverage at intent (Gate 1) and outcome (Gate 5); between them, the automated review round plus a green gate is the real quality check, and a merge that deploys only staging is cheap to revert. So the merge pause is tiered, not universal. (In Book, merging auto-deploys staging, so a merge is a deploy.) After any merge, wait for the deploy to complete and confirm it went green before declaring anything live.

- **Interactive sessions, non-deep changes: merge on green.** Once CI is green and the Gate 3 review round (at the depth the change warranted) is clean and remediated, merge without waiting for Forrest's click — and say plainly in the session that the merge happened.
- **The pause stays — explicit go-ahead required, every time — for:** deep changes (Gate 3's taxonomy: new subsystems, auth/privacy/security surface, tricky logic); dependency upgrades; anything touching data shape, migrations, or the Ghost auth bridge; and **every PR produced by an autonomous session** (see "Autonomous sessions" below). When unsure which tier a change is in, ask — it's the same deep/shallow call Gate 3 already requires.
- **Mechanical precondition, per repo:** merge-on-green applies only where CI enforces the project's *full* verification gate and branch protection requires those checks — otherwise "green" doesn't mean verified. **Book now satisfies this** (OFC-297/D141: `assert:gate-in-sync` makes "CI green" and "full gate green" the same claim), together with branch protection requiring `Verify gate` + `CodeQL` as `strict` checks and `enforce_admins: true` (recorded in D143). ⚠ That protection config is load-bearing and lives *outside* the repo where no test can assert it — if admin bypass is ever re-opened, merge-on-green loses its premise along with it.
- **The audit loop replaces the dropped pause:** at each live-test session, Forrest reviews `git log --oneline` on `main` since his last visit as the merge digest. Anything that surprises him means the auto-merge criteria tighten — the relaxation is self-correcting, not a one-way door.

## Gate 5 — Live testing closes the loop

Forrest live-tests on staging after every deploy. Treat his findings as the top priority: diagnose, fix via the same branch→PR→merge loop (usually shallow follow-ups), and iterate until he confirms everything works. A phase or ticket is not "done" at merge — it's done when Forrest has live-confirmed it.

Live cloud-infrastructure changes on his GCP projects (IAM grants, deletions of shared data) are **his to run**: diagnose, hand him the exact command, and where possible fix the provisioning/deploy scripts so the manual step never recurs.

## Gate 6 — Close out the session

Before ending a session, verify every box:

- [ ] Linear tickets for completed work closed **with evidence comments**; tickets filed for everything deferred.
- [ ] Decision log appended, its index (`DECISIONS-INDEX.md`) updated to match, and doc changes committed alongside the code.
- [ ] Merged local branches deleted.
- [ ] Auto-memory updated **in place, not appended**: rewrite the forward-state summary so this session's outcome *replaces* the entry that queued it. Memory keeps only what's next, open blockers, still-active landmines, and pointers into the decision log and tickets — those hold the full detail. If the file no longer fits in a single read (roughly a few thousand tokens), consolidate before closing: copy it verbatim to `archive/<name>-<date>.md`, then rewrite it down to forward state.
- [ ] State plainly what was verified versus what wasn't.

## Rationalizations and red flags

The gates erode through plausible-sounding exceptions, not open defiance. The usual suspects, pre-rebutted:

| Rationalization | Reality |
|---|---|
| "This change is trivial — skip the plan." | Trivial still gets a two-line plan and a "go." Gate 1 is how *trivial* gets confirmed. |
| "He answered my clarifying questions, so that's approval." | Approval is an unambiguous "go," nothing less. |
| "CI is green and review is clean — merging." | Only if Gate 4's tier allows it: interactive session, non-deep change, in a repo whose CI enforces the full gate. Deep/dependency/data-shape changes and all autonomous-session PRs wait for Forrest, every time. |
| "I'm autonomous, but this PR is clean — merging it unblocks the next one." | Autonomous sessions never merge. The stop-at-PR is an integration serialization point, not a quality verdict — Forrest merges the batch in his chosen order and live-tests once. |
| "I'll file the Linear ticket at close-out." | File it when discovered. Close-out verifies tickets exist; it doesn't remember them for you. |
| "This session's full write-up is worth keeping — append it to memory." | Memory is forward state, not a changelog; the write-up already lives in the decision log, the PR, and the ticket's evidence comment. Appending per session once grew a memory file past what a single read can load — every later session then pays for the whole history or misses half of it. |
| "It's minor — I'll TODO it / leave it." | Minor known debt is cheapest to fix now, in context. Defer only if the fix needs its own PR — and then it's a ticket, not a TODO. |
| "The fix is obvious — no need to reproduce first." | Obvious fixes are right most of the time; the rest cost hours. Repro test first. |
| "Docs can follow in the next PR." | Documentation is code. Same PR. |
| "This API is standard — I know it from memory." | Versions drift. Verify against the docs or flag it unverified. |

Red flags — observable signs a session is drifting: the same test/build command run twice with no code change in between (reassurance, not verification); a hundred-plus lines written without running anything; unrelated edits appearing in the diff while debugging; a TODO comment where a ticket belongs; a "while I was in there" refactor that wasn't in the plan; a test modified so the change passes (the behavior probably changed).

## The decision log

The decision log (`DECISIONS.md`) is the compact read-first artifact that lets later sessions honor earlier conclusions. Conventions, learned as Book's log passed 400 KB:

- **Append-only; supersession by pointer.** Never rewrite a past entry's decision text. A change of direction is a *new* entry that names what it changes ("amends D75", "supersedes D16"); the only in-place edit permitted on an old entry is appending an italic "*Later updated by: …*" trailer pointing forward. IDs: `D<n>` for design decisions, `N<n>` for implementation notes.
- **Every entry records the Why**, not just the What — the rationale is the part a later session cannot reconstruct.
- **Keep a topic index from decision one.** A sibling `DECISIONS-INDEX.md` maps each subsystem to its currently-authoritative decision chain (e.g. "read/cache: D7 → D82 → D83 → D84 (current)"). Update it in the same PR as any log append. Sessions consult the index first and jump to the few governing entries — never read the full log into context.
- **Distill at completion.** When a project or major build phase closes, freeze the chronological log into `history/` and write an as-built digest organized by subsystem: the net of all decisions with superseded entries dropped, citing historical IDs for the reasoning. The digest becomes the read-first artifact for the next phase; the index is its skeleton.

## Triage sessions

When the tracker accumulates new Todo tickets, schedule them in a dedicated **triage session** — a planning session that touches only Linear and auto-memory, never the repo. Triage is cheap in tokens but its errors compound (a bad batch degrades an entire implementation session), so run it on the strongest available model. Gate 1 still applies: propose the schedule before applying it, unless Forrest has explicitly delegated the grouping decision up front.

- **Read every candidate ticket in full** (`get_issue`, not list excerpts) before grouping anything.
- **Group for the implementing model's context, not by theme.** Batch by surface affinity — tickets touching the same page or subsystem share a session so the model holds one surface in context. Genuine bugs and behavioral changes get solo or near-solo sessions; cosmetic tickets batch well, even many at a time. Component affinity beats conceptual affinity: two tickets editing the same component belong together even when one is cosmetic and one behavioral.
- **Session labels are the session index.** Apply one label per session (`6b-2`, `7c`, …) following the existing naming, with a one-line scope description on the label entity. Number sessions by priority; execution order may deviate. Labels beat parent/child tickets (a synthetic parent repurposes an issue as a container) and cycles (sessions aren't time-boxed); if label-namespace cruft ever grates, project milestones are the natural upgrade — ordered, progress-rolled, project-scoped.
- **Leave each ticket a guidance comment** — the highest-value artifact of the session, carrying cross-session context the implementing session cannot reconstruct: the session assignment and pairing rationale; any root-cause hypothesis, framed as verify-not-assume; landmines from the decision history that the ticket's surface touches; and design forks to escalate at the plan gate (the comment recommends; Forrest decides).
- **Close-out:** update auto-memory's forward state with the schedule. When a work session later closes, strip its label from the closed tickets; deleting the label entity itself is Forrest's (Linear Settings → Labels — the MCP can't delete labels).

A triage run by a scheduled Routine follows these same conventions — see "Autonomous sessions" below for what changes when Forrest isn't present.

## Autonomous sessions (Routine-triggered)

Some work runs without Forrest present: a scheduled Routine triages the backlog and spawns implementation sessions. The gates don't relax when he's away — they move:

1. **Triage automates the work, not the decision.** The Routine reads every candidate ticket in full, drafts the groupings, session labels, and per-ticket guidance comments per the triage conventions above — then **posts the proposed schedule to Forrest and stops**. His one approval of the schedule satisfies Gate 1 for every session it spawns: the approved schedule plus each ticket's guidance comment *is* the plan. No implementation session starts before that approval.
2. **Spawned sessions run the full loop unattended** — branch, build, gate green, code review at the depth the change warrants, remediate — and **stop with the PR ready. Never merge** (Gate 4). With Forrest absent there is no live-testing between merges, and parallel PRs landing on a moving `main` compound; the batch waits for him to review, merge in his chosen order, and live-test once.
3. **Concurrency follows surface affinity** — the same affinity triage already computed. Sessions on disjoint surfaces may run in parallel; sessions touching the same surface run serially, each starting from the prior session's PR outcome. Never stack PRs across autonomous sessions.
4. **Degrade loudly, never silently.** Cloud/headless environments may lack interactively-authenticated MCP servers (Linear) or the `/code-review` plugin. If Linear is unreachable, record what would have been ticket updates in the PR description and say so; if `/code-review` is absent, say so in the PR and run its five-agent methodology manually (Gate 3). A missing tool changes the mechanics, never the standard.

## Model & effort guidance

- Design/planning sessions: strongest available model (Opus-class or above) at high, extra-high, or max effort.
- Implementation: strongest available model at standard effort is usually right; escalate effort for auth/privacy/concurrency work.
- Adversarial design reviews: a **fresh session** of the strongest model at max effort, with no prior context on the project (see design-methodology.md).
- Split sessions and sub-sessions to manage focus and context — when scope grows mid-session, propose splitting rather than pushing through with a degraded context.

## Starting a new project?

Read `design-methodology.md` (in this skill) for the ideation → design → adversarial review → coding-plan process, and copy this skill folder into the new repo's `.claude/skills/` so the methodology travels with it.

## Heading to production?

When a project approaches production cutover — or any migration touches live data — read `launch-and-cutover.md` (in this skill) **at the planning stage, before proposing the plan**: rollback plans written before deploys, numeric hold/roll-back thresholds, the first-hour watch, and expand/contract for data-shape changes.
