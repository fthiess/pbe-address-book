---
name: dev-workflow
description: Forrest's development-session methodology — the plan → build → review → remediate → live-test → close loop and its approval gates. Invoke at the start of ANY session that will change code or docs (feature, bugfix, refactor, ticket batch), before proposing a plan or writing code. Also covers PR/merge rules, code-review depth, Linear ticket hygiene, decision-log conventions (append-only + topic index), model/effort guidance, and the session close-out checklist. For new-project design-stage work (seed doc → PRD/engineering design → adversarial review), read design-methodology.md in this skill.
---

# Development Session Workflow

Every substantive session follows one loop:

**plan → build → code review → remediate → merge → live-test → remediate → close**

The gates below are firm. When a gate and expedience conflict, the gate wins; when genuinely unsure whether something clears a gate, ask Forrest rather than guessing.

## Gate 1 — Plan first, always

Begin by discussing the work, not doing it. Review the relevant docs/tickets/code, ask clarifying questions, and propose a plan (scope, approach, what will and won't be touched, test strategy). Then **stop and wait for Forrest's explicit approval**. Clarifying questions and his answers are *not* approval — approval is an unambiguous "go." Use plan mode for substantial work. "Measure twice, cut once."

Two standing sub-rules:

- **Forrest decides genuine design forks.** Present options with a recommendation; don't pick for him. Each decided fork is recorded in the project's decision log as "Forrest's call" with the reasoning.
- **Prefer the simple path.** If earlier decisions appear to force complexity, surface the simpler alternative and confirm direction before building.

## Gate 2 — Build on a branch, gate green

- All work happens on a feature branch and lands via a PR. Never commit directly to `main`.
- Unit tests for any non-trivial logic; run the project's formatter/linter on everything.
- Keep the project's full verification gate green locally before pushing (for Book: `npm run verify:gate`).
- **Documentation is code.** Design docs, the decision log, API specs, and user docs are updated in the same PR as the code they describe. Append significant decisions to the decision log (`DECISIONS.md`) as they're made — following the decision-log conventions below — and propagate them to affected docs once, in place.
- Anything discovered but deliberately not done now — deferred features, uncertain items, rough edges — gets a Linear ticket before the session ends, not a TODO comment or a mental note.

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
