---
name: dev-workflow
description: Forrest's development-session methodology — the plan → build → review → remediate → live-test → close loop and its approval gates. Invoke at the start of ANY session that will change code or docs (feature, bugfix, refactor, ticket batch), before proposing a plan or writing code. Also covers PR/merge rules, code-review depth, bugfix discipline (repro-test-before-fix), Linear ticket hygiene, decision-log conventions (append-only + topic index), model/effort guidance, and the session close-out checklist. For new-project design-stage work (seed doc → PRD/engineering design → adversarial review), read design-methodology.md in this skill; for production cutovers and live-data migrations, read launch-and-cutover.md.
---

# Development Session Workflow

Every substantive session follows one loop:

**plan → build → code review → remediate → merge → live-test → remediate → close**

The gates below are firm. When a gate and expedience conflict, the gate wins; when genuinely unsure whether something clears a gate, ask Forrest rather than guessing.

**Freshness check (on invocation):** this skill's canonical upstream is the `fthiess/claude-skills` repo, cloned at `~/.claude/skills/`. When the working project carries a vendored copy (`.claude/skills/dev-workflow/`), diff it against the clone at session start; if they differ, say so and offer to sync — usually a shallow doc-only PR bringing the vendored copy up to the upstream, or a commit+push upstream when the newer change originated in the project.

## Gate 1 — Plan first, always

Begin by discussing the work, not doing it. Review the relevant docs/tickets/code, ask clarifying questions, and propose a plan (scope, approach, what will and won't be touched, test strategy). Then **stop and wait for Forrest's explicit approval**. Clarifying questions and his answers are *not* approval — approval is an unambiguous "go." Use plan mode for substantial work. "Measure twice, cut once."

Two standing sub-rules:

- **Forrest decides genuine design forks.** Present options with a recommendation; don't pick for him. Each decided fork is recorded in the project's decision log as "Forrest's call" with the reasoning.
- **Prefer the simple path.** If earlier decisions appear to force complexity, surface the simpler alternative and confirm direction before building.

## Gate 2 — Build on a branch, gate green

- All work happens on a feature branch and lands via a PR. Never commit directly to `main`.
- Unit tests for any non-trivial logic; run the project's formatter/linter on everything.
- Keep the project's full verification gate green locally before pushing (for Book: `npm run verify:gate`).
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

- **Deep changes** (new subsystems, auth/privacy/security surface, tricky logic): run `/code-review` at high effort on the PR in-session and remediate the findings directly before merge. For the biggest changes Forrest may instead run `/code-review ultra` from a separate session — findings then come back as Linear tickets to triage and mitigate in the building session.
- **Shallow follow-ups** (CSS tweak, test data, doc fix, workflow step): self-review the edge cases; CI green suffices. Still via a PR — the review round is what's optional, never the PR.
- When unsure whether a change is deep or shallow, ask.
- Local `/code-review` subagents inherit the session model — invoke local reviews from the strongest available model.

## Gate 4 — Merge only on explicit OK

**Never merge to `main` without Forrest's explicit go-ahead**, even when CI is green and review is clean. (In Book, merging auto-deploys staging, so a merge is a deploy.) After merge, wait for the deploy to complete and confirm it went green before declaring anything live.

## Gate 5 — Live testing closes the loop

Forrest live-tests on staging after every deploy. Treat his findings as the top priority: diagnose, fix via the same branch→PR→merge loop (usually shallow follow-ups), and iterate until he confirms everything works. A phase or ticket is not "done" at merge — it's done when Forrest has live-confirmed it.

Live cloud-infrastructure changes on his GCP projects (IAM grants, deletions of shared data) are **his to run**: diagnose, hand him the exact command, and where possible fix the provisioning/deploy scripts so the manual step never recurs.

## Gate 6 — Close out the session

Before ending a session, verify every box:

- [ ] Linear tickets for completed work closed **with evidence comments**; tickets filed for everything deferred.
- [ ] Decision log appended, its index (`DECISIONS-INDEX.md`) updated to match, and doc changes committed alongside the code.
- [ ] Merged local branches deleted.
- [ ] Auto-memory updated: current forward state, what's next, and any new landmines — lean pointers, not history (the repo's docs and git log are the record).
- [ ] State plainly what was verified versus what wasn't.

## Rationalizations and red flags

The gates erode through plausible-sounding exceptions, not open defiance. The usual suspects, pre-rebutted:

| Rationalization | Reality |
|---|---|
| "This change is trivial — skip the plan." | Trivial still gets a two-line plan and a "go." Gate 1 is how *trivial* gets confirmed. |
| "He answered my clarifying questions, so that's approval." | Approval is an unambiguous "go," nothing less. |
| "CI is green and review is clean — merging." | Merging is Forrest's call, every time. In Book, a merge is a deploy. |
| "I'll file the Linear ticket at close-out." | File it when discovered. Close-out verifies tickets exist; it doesn't remember them for you. |
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

## Model & effort guidance

- Design/planning sessions: strongest available model (Opus-class or above) at high, extra-high, or max effort.
- Implementation: strongest available model at standard effort is usually right; escalate effort for auth/privacy/concurrency work.
- Adversarial design reviews: a **fresh session** of the strongest model at max effort, with no prior context on the project (see design-methodology.md).
- Split sessions and sub-sessions to manage focus and context — when scope grows mid-session, propose splitting rather than pushing through with a degraded context.

## Starting a new project?

Read `design-methodology.md` (in this skill) for the ideation → design → adversarial review → coding-plan process, and copy this skill folder into the new repo's `.claude/skills/` so the methodology travels with it.

## Heading to production?

When a project approaches production cutover — or any migration touches live data — read `launch-and-cutover.md` (in this skill) **at the planning stage, before proposing the plan**: rollback plans written before deploys, numeric hold/roll-back thresholds, the first-hour watch, and expand/contract for data-shape changes.
