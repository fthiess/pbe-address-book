# PBE Address Book — Triage & Mitigation Plan

How we get from "design review complete, 81 findings in hand" to "ready to start coding Book." This plan sequences the triage of [`DESIGN-REVIEW-COMPOSITE.md`](DESIGN-REVIEW-COMPOSITE.md) and the resolution of whatever triage selects for fixing. It is a **process doc**, not a design doc — it decides *how* we decide, not what we decide.

> **Status:** Drafted 2026-06-08, before triage begins. The composite's §12 worksheet is the recording surface for dispositions; this plan is the running order for filling it in. New decisions land in [`../DECISIONS.md`](../DECISIONS.md) as `D77+`.

---

## 1. The shape of the problem

81 findings overstates the work. The composite already did the expensive part — consolidation, de-duplication, severity reconciliation, cross-referencing, and the **Editor's context notes** that flag which findings collide with a deliberate decision versus which are plain gaps. Sorted by *how much of Forrest's judgment each actually needs*, the 81 split roughly:

- **~12 genuine judgment calls** — the §10 decision-tensions, where a finding challenges a choice made on purpose (D75 brotli economics, D45 nudge ethics, D54 Ghost dependency, MITAA always-flow, `adminNote` hidden-from-subject, no-logout, WCAG 2.1→2.2). These trade product values and cost, so they are Forrest's to make.
- **~69 ratify-a-proposal items** — stale references, "make the intent testable," standard hardening, missing ARIA, undefined-but-obvious mechanics. Claude pre-drafts a disposition for each; Forrest confirms or redirects.

So the real work is: **make ~12 hard calls, ratify ~69 proposals.** That shapes everything below.

---

## 2. Guiding principles

1. **Group by cluster, not by severity.** The findings are densely interdependent and the composite repeatedly says "triage these together" (S1+R3+S6; the R1 outbox spine; the privacy egress register; restore). Severity-grouping would split conjoined findings across sessions — you cannot decide S1's caching fix without simultaneously deciding R3 and S6. Severity is used *within* the plan as a priority-and-depth dial: blockers go first and get the deepest thinking; minors get fast ratification.

2. **Gating questions first.** A handful of decisions scope everything downstream (does CCPA bind a nonprofit? is the Cloud Run IAM front-door real? is the Ghost push sync or async?). Settling these before the clusters avoids wasted deliberation.

3. **A persistent brief before every session, drafted just-in-time.** Claude pre-drafts a triage brief for each cluster — a proposed disposition (a/b/c/d) and fix sketch for *every* finding in it, with the one or two questions only Forrest can answer flagged in bold. Each brief is **saved as its own file** (`history/TRIAGE-BRIEF-{n}.md`) and **drafted in its own step immediately before its session**, not all up front, because later clusters consume earlier decisions (the Session-4 brief needs Session-0's R1 axis and Session-3's P3 tombstone). Each brief is written to **teach as well as propose** — every finding carries the *why* (the architecture tradeoff, what makes it a blocker, why one option wins) so the files double as a learning record. The session is then Forrest reacting to concrete proposals, not deriving from scratch — the single biggest time multiplier.

4. **Three recording surfaces, by a rising threshold** (resolves the old §8 question). Every triaged finding is recorded in one-to-three places: **(i) the composite §12 worksheet** — *every* finding, always (disposition + one-line action); **(ii) the delivered design docs** (ENGINEERING-DESIGN, API-SPEC, DATABASE-SCHEMA, PRD) — *anything load-bearing for the build*, since those specs drive the coding; **(iii) `DECISIONS.md` as `D77+`** — *only foundational policy/design decisions*, the durable rationale. A stale-ref fix touches (i) and (ii); a blocker like P4 touches all three; a label rename may touch only (i) plus a trivial doc edit. Not every real decision earns a D-number.

5. **Propagation is concentrated at the end.** Editing the eight delivered docs to match the new decisions happens in one focused resolution pass, so each doc section is touched once with the full resolution (e.g. ENGINEERING-DESIGN §1.6 gets the whole S1+R3+S6+R8 answer at once, not four times).

6. **Preserve the credited strengths (composite §9).** A clean-context reviewer can call a sound, deliberate decision "wrong" for lacking the constraint that justified it. Any fix must not dismantle a strength (server-side projection, the read-only Ghost audit invariant, names-not-values logging, the fragment-carried token, optimistic concurrency).

---

## 3. Disposition mechanics

Each finding gets one disposition in the §12 worksheet, per the composite's legend:

- **(a) fix** — apply the change and record it across the surfaces in principle 4 (always the worksheet; the delivered docs if load-bearing; `DECISIONS.md` `D77+` only if foundational).
- **(b) as-designed** — reject, with the reason written in the worksheet.
- **(c) deferral** — already an intentional post-MVP deferral; cross-check `PRD.md` §3.2.
- **(d) external-context** — the reviewer lacked a real constraint we have; note it.

The three-tier recording rule (principle 4) supersedes the composite's literal "record as a new decision, don't edit the delivered docs" wording: the delivered specs **are** updated during resolution (they drive the build), `DECISIONS.md` carries only the foundational *why*, and the worksheet stays the complete register.

---

## 4. Session map

Eight triage sittings (0–6 plus a fast-track) feeding a resolution phase. Each finding is assigned to exactly one session for its disposition; cross-references note where a facet informs another session. **All 81 are placed** — the per-session rosters below sum to 81 (with C4 tracked as an umbrella in resolution).

| # | Session | Findings | Count |
|---|---|---|:--:|
| 0 | **Gating decisions** | P18, P19, S17, U1 (+ pre-decide the R1 sync/async axis and the R8 pull-forward direction) | 4 |
| 1 | **Fast-track ratification** | C1, C2, C3, C6, C8, C10, C11, C12, C13, C14, P6, P15, R16, R17, R19, R20, U6 | 17 |
| 2 | **Read / cache / compute** | S1, S6, R3, R8, R2, R6, S10 | 7 |
| 3 | **Privacy / consent / egress** | P1, P2, P3, P4, P5, P7, P8, P9, P10, P11, P12, P13, P14, P16, P17, S9, S12, C5, C7 | 19 |
| 4 | **Write-integrity / Ghost seam (+ restore)** | R1, R4, R5, R7, R9, R10, R11, R12, R13, R14, R15, R21, S2, S13 | 14 |
| 5 | **Auth & input hardening** | S3, S4, S5, S7, S8, S11, S14, S15, S16, S18, S19 | 11 |
| 6 | **UI / a11y + leftovers** | U2, U3, U4, U5, U7, C9, C15, R18 | 8 |
| — | **Resolution / propagation** | C4 umbrella + all `D77+` propagation into the 8 delivered docs | 1 |

**Ordering rationale.** Gating (0) scopes the rest. Read/cache (2) is self-contained and a good warm-up for the heavy reasoning. Privacy (3) runs *before* write-integrity (4) on purpose: P3 defines the deletion **tombstone/deny-list**, which R5 (restore) and R1 (create-orphans) must consume — so the tombstone is decided first. Restore is the suite's biggest multi-lens hotspot (R5 + S13 + the P3 restore facet); **Session 4 owns restore** and pulls S13 in with R5, consuming P3's tombstone decision from Session 3. Auth-hardening (5) and UI (6) are mostly high-ratify and come last.

> **Update (Session 0, 2026-06-08 — D77):** the **tombstone/deny-list dependency above is removed.** Triage decided Book has no privacy-driven record deletion (the only required data is the immutable Constitution signature-page fact; whole-record deletion is admin error-correction only), so there is no deleted person to resurrect and no tombstone is built. R1's create path is instead made safe by idempotent create (address by `ghostMemberId`), and R5's restore→Ghost divergence is caught by the existing read-only reconciliation audit (D55). P3/P8 are now pre-framed toward **(b)** in Session 3. The Privacy-3 → Write-integrity-4 ordering no longer carries a hard data-dependency, though the sequence is still fine to keep.

---

## 5. Per-session detail

For each session: what's being decided, the **bolded judgment calls** (the §10 tensions — everything else arrives pre-proposed), and the thinking level for the brief-drafting step versus the live session. Thinking levels use the Claude Desktop UI scale — **Low / Medium / High / Extra / Max** — plus a note on **Ultracode** (see §7).

### Session 0 — Gating decisions · brief **Max** · live **High**
The scoping forks. **P18** — does CCPA legally bind a nonprofit fraternal/alumni group? (Claude lays out the framework and can research; a definitive answer is a lawyer's call — recommendation: build to the stricter standard until a determination exists, so the privacy cluster isn't blocked.) **P19** — are any data subjects minors? (likely one-line close: population is 18+). **S17** — settle the factual dispute: is Cloud Run per-service IAM actually all-or-nothing, making the roster "front door" infeasible? (Reviewer B's claim is load-bearing; resolve, then apply subject-pinning to the surviving option.) **U1** — adopt WCAG 2.2 AA over 2.1 AA? Plus two directional pre-decisions consumed later: the **R1 sync-vs-async push** axis (gates the Session-4 outbox design) and whether to **pull R8's denormalized snapshot forward** (gates Session 2). Max on the brief because these forks ripple downstream.

### Session 1 — Fast-track ratification · brief **Medium** · live **Medium** (Sonnet 4.6 adequate)
The mechanical (a)-fixes and stale-ref cleanups, pre-drafted so the session is confirmation, not derivation: cookies→localStorage stale ref (C1), the D45 six/two→seven/three drift (C2), the `allowCommentReplyEmail` projection reconcile (C3), missing capability-matrix rows (C6), the `verifiedBy` export asymmetry (C8), endpoint-name and example nits (C10/C11), Add-Brother documentation (C12), the "Toggle Privileges" rename (C13), un-decease behavior (C14), making the Mixpanel "no-PII-in-properties" claim testable (P6), the `ghostMemberUuid` minimization call (P15), opaque headshot tokens (R16, also resolves the P7 race), `arrayUnion`/`arrayRemove` for stars (R17), single-clock `classYear` (R19), create-if-absent first login (R20), and virtualized-list ARIA (U6). No bolded calls — these are lookup-and-confirm.

### Session 2 — Read / cache / compute · brief **Max** · live **Extra**
The hardest interdependency cluster, all anchored on D75/D76 and Cloud Run scale-to-zero. **The S1+R3+S6 economic knot** — per-caller projection keying (S1) would collapse the brotli-11 amortization rationale (R3) and the role-blind ETag (S6); these must be decided as one. **R8** — pull the denormalized all-profiles snapshot forward (already a recorded PRD §3.2 deferral) to collapse cold-start reads? **R2** — accept "CPU always allocated" (ending scale-to-zero economics) or re-architect cache refresh, given the stale-but-304-confirmed failure? R6 (persist JWKS across cold starts) and S10 (rate-limiting; the brotli amplifier facet co-decided with R3) round it out. Max on the brief: this is where reasoning-chain truncation would hurt most.

### Session 3 — Privacy / consent / egress · brief **Extra** · live **High**
The "data leaving Book" register, scoped by P18 from Session 0. Bolded calls: **P1** — Mixpanel PII minimization and the `ignore_dnt: true` justification (drop name? hash `distinct_id`? send `role`?). **P4/P5** — default `allowShareWithMITAA` to opt-in, and whether the deliberate always-flow of identity/death survives a CCPA opt-out, plus a use-limitation agreement. **P8/P17** — `adminNote` and the photo grant: deliberate asymmetries (D56/D23) now colliding with a right-to-access; fix or disclose? **P11** — HTTP-cache residue on shared machines (privacy-vs-performance trade). **P12** — the log-reader agent's possible LLM egress. **S12** — add a server touchpoint for export auditing vs. the deliberately client-side export (D41). This session also **defines P3's tombstone/deny-list**, the dependency Session 4 consumes. The rest (P2 notice/DSAR, P7 headshot retention, P9 Referrer-Policy, P10 log discipline, P13/P14 third-party data, P16 retention schedule, S9 formula injection, C5 manager-deceased side-effect, C7 MITAA mechanism) arrive pre-proposed.

### Session 4 — Write-integrity / Ghost seam (+ restore) · brief **Max** · live **Extra**
The non-atomic-multi-store spine. Bolded calls: **R1** — the transactional outbox / pending-push design (building on the Session-0 sync/async decision), with the email-change-lockout special case; must preserve D55's read-only-into-Book invariant. **S2** — email uniqueness/normalization and fail-closed resolution (the other path to the same lockout). **R5 + S13** — restore: read-freeze/maintenance mode, structural-validation-on-restore, post-restore Ghost reconciliation, role-delta auditing, backup integrity/encryption — consuming P3's tombstone so restore doesn't resurrect deleted brothers. The supporting ops findings (R4 async long-running ops, R7 multi-store ordering/compensation, R9 trace correlation, R10 push-failure alerting, R11 bulk-import atomicity, R12 dangling refs, R13 idempotency keys, R14 Ghost-contract brittleness, R15 migration execution, R21 DR/RPO/RTO) arrive pre-proposed and mostly cohere around the outbox + orphan-sweep + async-job patterns.

### Session 5 — Auth & input hardening · brief **High** · live **Medium–High**
Mostly standard best-practice with a high ratify ratio. Bolded calls: **S5** — accept Ghost as a single point of total compromise (D54) with a documented threat model, and/or add step-up confirmation for restore/bulk-delete/role-grants? **S16** — harden the `DevIdentityProvider` bypass beyond a single env gate. The rest are near-obvious (a)-fixes: positive write-field allowlist (S3), object-level authz/IDOR (S4), JWT alg-pinning (S7), login-CSRF state/nonce (S8), image decode-bomb bounding (S11), CSP/security headers (S14), strict URL-scheme allowlist (S15), server-side last-admin invariant (S18), deny-by-default CORS + host-only session cookie (S19).

### Session 6 — UI / a11y + leftovers · brief **High** · live **Medium**
Small and mostly ratify, but accessibility is hard project policy (D32/D67) so the a11y items carry weight beyond their severity. Bolded calls: **U4** — add a logout control (reopens D22)? **U7** — simplify the privacy-toggle copy into popovers vs. D45's deliberate state-both-consequences nudge? **U3** — specify the 401-mid-edit recovery so unsaved form data survives an expired session. The rest: in-page-help phasing (U2), main-thread phonetic jank → Web Worker (U5), API versioning / stale-SPA (C9), no-email-brothers limitation stated (C15), CDN-cookie mid-session expiry handling (R18).

---

## 6. Resolution / propagation phase

After triage, a concentrated editing pass — decisions are already made, so the risk shifts from *reasoning* to *introducing new inconsistencies*. Brief/edit at **Medium**, with a final cross-document consistency sweep at **High**.

Scope:
1. **Finalize `D77+`** in `DECISIONS.md` (most are drafted inline during triage; this tidies and numbers them).
2. **Propagate into the eight delivered docs** — each section touched once with its full resolution, decisions cited.
3. **Close C4's TBD/Session-6 mechanics** into concrete specs where triage chose (a): the CSV escaping/formula rules (with S9), the Ghost-sync discrepancy-report JSON shape, the MITAA column format — while separating genuine gaps from stale forward-references already overtaken by D63/D68.
4. **Final consistency sweep** across all docs (a sub-agent can fan out across the suite to catch dangling refs and contradictions), and fill in the composite's §13 triage summary (disposition counts, new-decision list, anything consciously left open).

Optionally, a lightweight self-review pass over only the changed sections — not a full re-run of the two-reviewer machinery.

---

## 7. Thinking-level philosophy (Claude Desktop UI)

Levels below are the Desktop UI scale: **Low / Medium / High / Extra / Max**, with **Ultracode** as a separate mode.

**Two different axes.** Max is the top of the *depth* ladder — one agent reasoning as hard as possible before answering. Ultracode is a *breadth* mode — a fleet of parallel agents at a slightly lower per-agent budget, billed accordingly. Triage needs depth, not breadth.

**Why the levels land where they do.** Deep thinking buys room for long chains of interdependent reasoning that would otherwise truncate — exactly the blocker clusters (the S1/R3/S6 knot, the R1 outbox). But that chain-heavy work is **front-loaded into the brief-drafting**, not the live session, where Forrest is in the loop and discussion carries the value. So **Max appears on three brief-drafting steps only** (Gating, Read/cache, Write-integrity), where truncation risk is real and the payoff concrete. Everything Forrest live-discusses runs **Extra or below**. Fast-track and propagation run **Medium**. This keeps the highest-cost setting off whole sessions and on the few moments that earn it.

**Ultracode is not used for triage.** Triage is sequential, interdependent, and human-in-the-loop — parallel agents have no independent breadth to fan out across, and the lower per-agent budget is a depth *downgrade* for precisely the work that needs depth. Ultracode is reserved for the **implementation phase** (the ~24–25 coding sessions in `CODING-PROJECT-PLAN.md`), where genuinely parallelizable, codebase-spanning work justifies its cost.

| Session | Brief-drafting | Live session |
|---|---|---|
| 0 · Gating | **Max** | High |
| 1 · Fast-track | Medium | Medium (Sonnet 4.6 ok) |
| 2 · Read / cache / compute | **Max** | Extra |
| 3 · Privacy / consent / egress | Extra | High |
| 4 · Write-integrity / Ghost | **Max** | Extra |
| 5 · Auth & input hardening | High | Medium–High |
| 6 · UI / a11y + leftovers | High | Medium |
| — · Resolution / propagation | Medium | High (final sweep) |

---

## 8. Recording policy (resolved 2026-06-08)

Settled with Forrest, superseding the composite's literal overlay-only wording — the three-tier rule in principle 4 governs. In short: the **delivered design docs are updated** for anything load-bearing (they are the specs the coding follows), **`DECISIONS.md` records only foundational** policy/design decisions as `D77+`, and the **composite §12 worksheet logs every finding**. Applied as decisions are made (worksheet + any D-number inline during triage) and during the resolution pass (doc propagation).

---

## 9. Compact variant

If fewer, longer sittings are preferred: fold Fast-track into Gating, and merge Auth-hardening with UI/leftovers — giving **~4 triage sittings** instead of six, at the cost of longer, more fatiguing sessions. Given the stakes (public repo, ~700 brothers' real PII, accessibility as hard policy), the thorough six-session version is recommended, but the clustering and counts are adjustable.

---

## 10. Next steps

1. Plan approved 2026-06-08.
2. ~~In a fresh session set to Max (or High), Claude drafts the Session 0 gating brief → `history/TRIAGE-BRIEF-0.md`~~ **DONE 2026-06-08.** Session 0 ran live and closed: P18→(d)/**D77**, P19→(b), S17→(a)/**D78**, U1→(a)/**D79**, with the R1 (async outbox) and R8 (provisional pull-forward) directions set. *(Session 0's brief was pre-drafted in its own session as a one-off, because the gating forks were heavy/Max-depth.)*
3. Run each remaining session in order. **Workflow (Forrest, 2026-06-08): from Session 1 on, each session opens by drafting its OWN brief in-context, then runs the live triage in the same session** — not pre-drafted in a separate prior session. Record dispositions in the composite §12 worksheet and any foundational decisions in `DECISIONS.md` as `D77+`.
4. Resolution / propagation pass — update the delivered docs, close C4's TBD mechanics, fill the composite §13 summary.
5. Implementation per `CODING-PROJECT-PLAN.md`.

*— Drafted 2026-06-08. Input: [`DESIGN-REVIEW-COMPOSITE.md`](DESIGN-REVIEW-COMPOSITE.md) (81 composite findings). Recording surfaces: composite §12 worksheet + [`../DECISIONS.md`](../DECISIONS.md).*
