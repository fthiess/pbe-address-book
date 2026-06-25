# PBE Address Book — Clean-Context Design-Review Plan

A proposal — produced at the Session-6c close-out — for how to subject the completed initial-build design suite to a **fresh-eyes review by an AI (or person) that was *not* part of the planning**, before implementation begins. This is the standing roadmap item carried since Session 1: "after the final session, propose strategies for conducting a design review of the entire set of output documents by an AI with a 'clean' context not exposed to the preliminary documents." It is a recommendation for a future session, not a step taken here.

## Why a clean-context review

The whole suite was authored across a dozen sessions by the same author/assistant pairing, each session building on the last. The Session-6c consistency pass improves internal coherence but cannot escape that shared context: the people who wrote the documents know what the documents *mean* to say, so they read past gaps, unstated assumptions, and leaps that a first-time reader would trip over. A reviewer who has seen none of the planning — only the delivered documents — reads exactly what is written, which is precisely the test the suite needs to pass: **does the delivered design stand on its own?** The graduated docs were deliberately scrubbed of seed-document dependencies (the decision log's citations were stripped; the seed and this history live apart in `history/`) so that this kind of stand-alone review is meaningful.

## What the reviewers are, and are not, given

**Give the reviewers the eight delivered documents only**, as a future engineer would receive them:

- `../PRD.md`, `../DATABASE-SCHEMA.md`, `../ENGINEERING-DESIGN.md`, `../API-SPEC.md`, `../CODING-PROJECT-PLAN.md`, `../USER-MANUAL.md`
- `../DECISIONS.md` (the "why") and `../PRE-LAUNCH-TOOLS.md`

**Withhold the `history/` folder** (this plan, `DESIGN-HISTORY.md`, and `SEED.md`) and any memory of the planning sessions. The narrative history and the seed would re-anchor the reviewer in the authors' framing and defeat the purpose; they exist for human historical interest, not for the review. (The reviewer may be *told* that certain things are intentionally deferred, by pointing them at `PRD.md` §3.2, so that "missing feature" findings can be triaged against deliberate scope.)

The cleanest way to achieve this in practice is **brand-new sessions/projects** containing copies of only those eight files — not a continuation of any planning conversation, and not this repository with its `history/` folder visible.

## What to review for

We will use two different reviewers to conduct four reviews each.

The reviewers will be two different LLM models (to be identified as “A”, and “B”), both set on one of their highest thinking-depth settings. By using two different models we expect to capture more diverse feedback than if we had used a single model.

The four reviews each model will conduct will be:
* Review 1 — Structural, completeness & consistency (broad)
* Review 2 — Security
* Review 3 — Privacy
* Review 4 — Operations & reliability
All reviews will be with clean context, with the reviewer told they are a senior engineering expert in the field of the review, that they do not have any prior connection to the engineers that produced it, and that they are to conduct the reviews as an adversary, looking for weaknesses, and that a review that fails to find any problems is a failed review.

The specific prompts used are (TK)

## How to run it

- **Independent first pass, then cross-doc pass.** Have the reviewer read each document on its own and note per-document issues, then do a dedicated cross-document pass for the consistency and contradiction dimensions, which are where authored-from-the-same-context suites most often fail.
- **Structured output.** Ask for a findings list, each item tagged by severity (blocker / should-fix / minor / question) and by location (`file §section`), with a one-line description and, where useful, a suggested resolution. A findings *table* is easier to triage than prose.
- **Use more than one reviewer for breadth.** Two or three independent clean-context reviewers (or a multi-agent review such as the `/code-review ultra` cloud review pointed at the docs) surface a wider net than one; reconcile their findings into a single de-duplicated punch list.
- The eight design reviews reports will be written into `docs/initial-build/history/raw-dr-feedback`, and will be named DESIGN-REVIEW-FINDINGS-DR-A-1.md (for reviewer A, review 1), DESIGN-REVIEW-FINDINGS-DR-B-1 (reviewer B, review 1), and so on.
- **Triage, don't auto-apply.** A clean-context reviewer legitimately lacks external constraints the authors had (the real Ghost Pro limitations, MITAA's data quality, the membership's size and demographics). Some findings will be the reviewer rediscovering a constraint that is real; some "gaps" are intentional deferrals. Every finding goes through human triage before any document changes — the review produces a punch list for a follow-up planning session, not edits.

## Follow-up

After the eight reviews have been conducted their reports will be provided back to Claude in a session with access to the full project history and it’s full documentation for compilation into a single composite design review report. That composite report will then be used to triage, and then to resolve, issues triaged as requiring attention.


# Design Review Prompts


> [!abstract] Review 1 — Structural, completeness & consistency (broad)
> You are a senior engineer assigned to peer-review a software design you have never seen before. You have no prior context about this project, no relationship to whoever wrote it, and no stake in defending its decisions. Treat the documents in this folder as a draft produced by a junior engineer. Your job is adversarial: assume the design contains serious problems and find them — do not validate it. A review that finds nothing is a failed review.
> 
> Attached are the eight documents that comprise the design you are to review: a PRD, a database schema, an engineering design, an API spec, a coding project plan, a user manual, a decision log, and a pre-launch-tools inventory.
> 
> First, before any critique: using ONLY these documents, begin by restating the system back to me in your own words — its purpose, who uses it, and how data flows through it. Wherever the documents don't let you do this confidently, stop and record it; a design a new engineer can't reconstruct from its own docs is itself a finding.
> 
> Then review the design as a whole for:
> - What is missing — capabilities, edge cases, error paths, or sections a complete design should have.
> - What is inconsistent — places where two documents contradict each other, or use the same term to mean different things.
> - What could be simplified — accidental complexity, redundant mechanisms, over-engineering.
> - Requirements traceability — does every requirement in the PRD map to something in the design, and does every design element trace back to a requirement? Flag both gaps and gold-plating.
> - Buildability — could a team actually execute the coding plan and arrive at the designed system? Flag hidden inter-phase dependencies, bad sequencing, unrealistic assumptions.
> - UI clarity — what about the interface would confuse or mislead a user.
> - Accessibility — is it specified to a concrete, testable standard (e.g. WCAG 2.2 AA) or merely asserted?
> - Versioning & migration — is there a path for evolving the API and schema without breaking existing clients or data?
> - Implicit assumptions — what is the design quietly assuming about traffic, data volume, users, or external systems that is never stated or justified?
> 
> Read all of the documents before forming conclusions; you need the whole picture even though you report only on the above.
> 
> Produce a structured findings register using DESIGN-REVIEW-TEMPLATE.md. Output your findings in a new file using the format of this template. When you have finished your review, say “My review is complete”.
> 
> Diagnose only — do not edit or rewrite the documents.



> [!abstract] Review 2 — Security
> You are a senior security engineer assigned to peer-review a software design you have never seen before. You have no prior context and no relationship to whoever wrote it. Treat these documents as a draft from a junior engineer. This is a security review ONLY — go deep, not broad. Assume the system has exploitable weaknesses and your job is to find them. A review that finds nothing is a failed review.
> 
>  Attached are the eight documents that comprise the design you are to review: a PRD, a database schema, an engineering design, an API spec, a coding project plan, a user manual, a decision log, and a pre-launch-tools inventory.
> 
> First, orient yourself: summarize the authentication and authorization model, every entry point and external interface, and the trust boundaries — i.e. where data or requests cross from less-trusted to more-trusted territory.
> 
> Then threat-model the design. Walk each trust boundary and reason through spoofing, tampering, repudiation, information disclosure, denial of service, and privilege escalation. Pay particular attention to:
> - Whether every authorization decision is enforced server-side. Treat any control that lives only in the SPA as cosmetic and therefore absent — flag it.
> - The attack surface of the API and the serverless functions: injection, broken object-level authorization, mass assignment, unvalidated input.
> - The integration with the external web app as an attack vector — what it can send you, what it can read, and what a compromise on that side would expose.
> - Secrets, tokens, and key handling across the SPA, backend, and storage.
> 
> Read all of the documents before forming conclusions; you need the whole picture even though you report only on security.
> 
> Produce a structured findings register using DESIGN-REVIEW-TEMPLATE.md. Output your findings in a new file using the format of this template. When you have finished your review, say “My review is complete”.
> 
> Diagnose only — do not edit or rewrite the documents.


> [!abstract] Review 3 — Privacy
> You are a senior privacy engineer assigned to peer-review a software design you have never seen before. You have no prior context and no relationship to whoever wrote it. Treat these documents as a draft from a junior engineer. This is a privacy review ONLY — go deep, not broad. Assume private information can leak here and find the paths. A review that finds nothing is a failed review.
> 
>  Attached are the eight documents that comprise the design you are to review: a PRD, a database schema, an engineering design, an API spec, a coding project plan, a user manual, a decision log, and a pre-launch-tools inventory.
> 
> First, orient yourself: inventory every category of personal or sensitive data the system handles, and map where each one is collected, stored, transmitted, processed, and shared.
> 
> Then assess, distinct from security (assume no attacker is even present):
> - Leakage paths — where private data ends up somewhere it shouldn't by ordinary operation: over-broad API responses, logs and telemetry, error messages, analytics, caches, URL parameters.
> - Third-party exposure — what private data flows to or from the external web app, whether that sharing is necessary and minimal, and what the receiving side does with it.
> - Data minimization — is the system collecting or retaining more than it needs?
> - Retention and deletion — is there a defined lifecycle, and can data actually be fully deleted on request?
> - Regulatory fit (assume California / CCPA applies) — data-subject access and deletion rights, disclosure of sharing, consent where required.
> 
> Read all of the documents before forming conclusions; you need the whole picture even though you report only on privacy.
> 
> Produce a structured findings register using DESIGN-REVIEW-TEMPLATE.md. Output your findings in a new file using the format of this template. When you have finished your review, say “My review is complete”.
> 
> Diagnose only — do not edit or rewrite the documents.


> [!abstract] Review 4 — Operations & reliability
> You are a senior reliability/SRE engineer assigned to peer-review a software design you have never seen before. You have no prior context and no relationship to whoever wrote it. Treat these documents as a draft from a junior engineer. This is an operations and reliability review ONLY — go deep, not broad. Assume this system will fail in production and lose or corrupt data; find out how. A review that finds nothing is a failed review.
> 
>  Attached are the eight documents that comprise the design you are to review: a PRD, a database schema, an engineering design, an API spec, a coding project plan, a user manual, a decision log, and a pre-launch-tools inventory.
> 
> First, orient yourself: map every failure surface, every external dependency, and every stateful or data-mutating operation.
> 
> Then assess:
> - Failure modes and data loss — what happens when each component, function, or dependency fails or times out mid-operation? Where can data be lost, duplicated, or left in an inconsistent state?
> - Data consistency and idempotency — given a NoSQL store, where does the design assume consistency or transactionality it won't actually get? Are writes and external calls idempotent and safely retryable?
> - Brittleness to external change — what breaks if the external web app changes its contract, slows down, or goes offline? Are there retries, backoff, timeouts, and graceful degradation?
> - Observability — could you actually diagnose a production incident with what's specified? Logging, tracing, metrics, alerting.
> - Scale and cost — where are the cost cliffs and scaling limits of this serverless + NoSQL design (per-request billing, hot partitions, read amplification, cold starts)? What does it cost and how does it behave at 10x load?
> 
> Read all of the documents before forming conclusions; you need the whole picture even though you report only on operations and reliability.
> 
> Produce a structured findings register using DESIGN-REVIEW-TEMPLATE.md. Output your findings in a new file using the format of this template. When you have finished your review, say “My review is complete”.
> 
> Diagnose only — do not edit or rewrite the documents.

