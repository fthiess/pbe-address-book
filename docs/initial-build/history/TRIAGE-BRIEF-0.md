# PBE Address Book — Triage Brief 0: Gating Decisions

The pre-session brief for **Triage Session 0** per [`TRIAGE-PLAN.md`](TRIAGE-PLAN.md) §5. It proposes a disposition and a fix sketch for the four gating findings — **P18, P19, S17, U1** — and a *direction* for the two pre-decisions that later sessions consume (the **R1** sync-vs-async push axis, gating Session 4; the **R8** snapshot pull-forward, gating Session 2). Each item is written to *teach as well as propose*: what the finding is, why it scopes everything downstream, the deliberate decision it collides with, and why one option wins — so the live session is you reacting to concrete proposals, not deriving from scratch.

> **Status:** Drafted 2026-06-08 at Max depth, before the live Session 0. **Every disposition here is a proposal, not a decision.** The recording surfaces (the composite §12 worksheet; the eight delivered docs; `DECISIONS.md` `D77+`) stay untouched until you ratify in the live session. The provisional `D##` numbers below are drafts to be finalized/renumbered in the resolution pass (TRIAGE-PLAN §6). Input: [`DESIGN-REVIEW-COMPOSITE.md`](DESIGN-REVIEW-COMPOSITE.md) findings **P18, P19, S17, U1, R1, R8** (with R2, R3, S1, S6, P3 read as context).
>
> **✓ Ratified — Session 0 closed 2026-06-08.** Outcomes recorded in the §12 worksheet and `DECISIONS.md` D77–D79. **One material change from the draft below:** on P18 the editor determined CCPA does **not** apply (no threshold met) and the **"tombstone"/deny-list was dropped entirely** — Book has no privacy-driven record deletion, so there is no deleted person to resurrect (see **D77**). The §1 proposal below is preserved as drafted *for the reasoning trail*; the binding version is D77. P19→(b), S17→(a)/D78, U1→(a)/D79 ratified as proposed; R1 (async outbox) and R8 (provisional pull-forward) directions confirmed.

---

## What Session 0 settles, and what it only points at

Two of these are scoping forks (**P18, P19**) that govern the legal force of the whole privacy cluster but cost little to settle. One is a **factual** dispute the two reviewers actually disagreed on (**S17** — is the Cloud Run "front door" real?), which must be resolved correctly before any roster-auth code is written. One is a low-cost policy bump squarely aligned with your accessibility-as-policy stance (**U1**). And two are *directional pre-decisions* — Session 0 does **not** dispose of R1 or R8 (their worksheet rows belong to Sessions 4 and 2 respectively); it only pins the axis those sessions build on, because settling them late would force rework.

Net effort, as TRIAGE-PLAN §1 frames it: these are mostly ratify-a-proposal, with two genuine judgment calls (the P18 build-to-stricter policy, and the R1 async-outbox direction).

| # | Finding · sev | Proposed disposition | The call that is yours |
|---|---|---|---|
| P18 | CCPA binds a nonprofit? · `question` | **(d) external-context** + policy **D77**: build to the stricter standard regardless of legal compulsion; obtain a legal determination in parallel | Commit to build-to-stricter as policy (recommended), or hold the P-cluster pending a lawyer's read? |
| P19 | Possible minors? · `question` | **(b) as-designed** — close it: the population is adults (≥16, effectively 18+); add a one-line clarification | Confirm no brother in the directory could be under 16 |
| S17 | Roster auth / front-door feasible? · `should-fix` | **(a) fix** — Reviewer B is right; drop the IAM front door, mandate in-code Google-JWKS verification with subject pinning (**D78**) | Accept standardizing on the in-code check (recommended) |
| U1 | WCAG 2.1 → 2.2 AA · `should-fix` | **(a) fix** — adopt WCAG **2.2 AA**; fold the new criteria into the D67 checklist (**D79**) | Ratify the 2.2 AA target |
| R1 | Push sync or async? *(axis only)* | **Direction: async durable outbox** — commit Firestore, then near-real-time push with retry + dead-letter alert; email-change expedited | Confirm the async-outbox axis over a synchronous in-request push |
| R8 | Pull the snapshot forward? *(direction only)* | **Direction: provisional yes**, with the final go/no-go made inside Session 2 alongside the scale-to-zero decision | Confirm the provisional "pull forward" lean |

---

## 1 · P18 — Does CCPA legally bind a nonprofit fraternal/alumni group? · `question`

**What it is.** The clean-context review was told to *assume* CCPA applies, so every privacy blocker (P1 Mixpanel, P2 notice/DSAR machinery, P3 deletion lifecycle, P5 MITAA flow, P8 `adminNote` access) is framed as a legal "must." P18 is the reviewer flagging their own assumption: PBE looks like a nonprofit fraternal/alumni group, which is generally *outside* CCPA's reach. Whether the cluster is "must" or "should" turns on this — which is why TRIAGE-PLAN puts it first.

**The framework (educational, not a legal opinion).** California's CCPA/CPRA regulates a "**business**," defined as a **for-profit** entity that *also* clears at least one threshold: ~$25M annual gross revenue; or annually buys/sells/shares the personal information of 100,000+ California consumers or households; or derives ≥50% of annual revenue from selling/sharing personal information. A nonprofit fraternal organization is not a for-profit "business," and PBE clears none of the thresholds. On the plain reading, **CCPA very likely does not bind PBE.** Two caveats keep this from being a clean "no": a brother who resides in the EU/UK could implicate **GDPR/UK-GDPR** (a separate regime with its own member/non-profit nuances), and the one genuinely regulator-sensitive practice in the suite is the Mixpanel egress with `ignore_dnt: true` (P1) — cross-context behavioral data shipped to a third party is exactly the "sharing" CCPA polices, so it is the practice most worth fixing *on its merits* even absent legal compulsion. None of this is a determination I can make; it is a lawyer's call.

**Why the legal answer should not gate the build.** The data-protection *practices* the P-cluster recommends — a notice at collection, a deletion/tombstone lifecycle, disclosing third parties (Ghost, Mixpanel, MITAA, Google, the log-reader agent), minimizing what leaves Book — are sound regardless of which regime applies. Two facts specific to this project push the same way: the GitHub repo will be **public**, and the dataset is **~700 living brothers' real PII**. Waiting on a legal opinion to scope P2/P3/P5/P8 would stall the largest blocker cluster for an answer that, even if it comes back "CCPA doesn't apply," would not change what a careful publisher should build.

**Proposed disposition — (d) external-context, plus a policy decision.** Record P18 as **(d)**: the review's "CCPA applies" was an assumption, and applicability to a nonprofit is genuinely unsettled — note that a definitive CCPA (and GDPR-for-any-EU-resident) determination is to be obtained, but is *not* a build gate. Pair it with a new foundational decision:

> **Provisional D77 — Book builds to the stricter privacy standard as policy, independent of legal applicability.** Implement notice-at-collection, the deletion/tombstone lifecycle, third-party-egress disclosure, and data minimization because they are correct for a public-repo directory holding real PII — not because a regime compels them. Pursue a legal determination in parallel; treat it as informational, not blocking.

This unblocks Session 3 to triage P1/P2/P3/P5/P8 on the merits, with the legal force settled as "policy floor, lawyer's confirmation pending."

> **Your call:** **Do you want to commit to build-to-stricter as policy (recommended) and pursue a legal read in parallel — or hold the P-cluster's scope until a lawyer weighs in?** And a one-line factual confirm: **is there any PBE revenue stream or data "sale" that could plausibly cross a CCPA threshold?** (I believe not — dues and the manual MITAA exchange are neither a "sale" nor advertising — but you know PBE's finances; one word closes it.)

---

## 2 · P19 — Could any data subject be a minor? · `question`

**What it is.** CCPA imposes special handling for minors — affirmative **opt-in** to sell/share the PI of consumers aged 13–15, and parental consent under 13. The reviewer noticed the user manual says the audience is "as young as 18" while the schema's `classYear` upper bound (`currentYear + 6`) admits current undergraduates, and asked: are any subjects under 18 — or under 16?

**Why it closes quickly.** Membership is by initiation at MIT as an undergraduate, so the floor is matriculation age — effectively 18, and realistically never below 16 even for an early-entrance student. The CCPA minor provisions trigger under 16; nobody in this directory is under 16. So no minor-consent machinery is required. (Note this also moots the question independently of P18: even if CCPA *did* apply, the under-16 rules would not bite.)

**Proposed disposition — (b) as-designed, close the question.** No change to the consent model. The only action is a one-line clarification so the edge the reviewer spotted is no longer ambiguous: state in `USER-MANUAL §1`/`§11` and `DATABASE-SCHEMA §4` that the population is **adults (18+)**. No `D##` — it is a documentation precision, recorded in the worksheet plus a trivial doc edit. (One could equally log this as **(d) external-context**, since the reviewer lacked the initiation-age constraint; either reading reaches the same close.)

> **Your call:** **Confirm there is no scenario in which a brother in the directory is under 16** — and that you're happy stating the population as "adults (18+)." (Recommended: close it.)

---

## 3 · S17 — Linter roster auth: is the Cloud Run "front door" real, and pin the SA subject · `should-fix`

**What it is.** This is the review's one outright **factual disagreement**, so it cannot be ratified by instinct — one reviewer is wrong about the platform. `D58`/`ENGINEERING-DESIGN §5.2`/`API-SPEC §8` offer the Linter's roster endpoint *two co-equal* auth options: verify the Google service-account token **(A)** "at the Cloud Run front door" (require auth + grant the `linter` SA `roles/run.invoker`), or **(B)** in-code against Google's JWKS. Reviewer A treats both as fine and focuses on a real hardening gap (pin the *subject*). Reviewer B argues the front door is **architecturally impossible** for Book.

**Who is right — Reviewer B.** I checked the topology against the design. Per `D10` and the §1.2 diagram, the **SPA is served from Firebase Hosting/CDN**, not Cloud Run — so it is not on the service and is not the issue. But the **Cloud Run backend serves both `/api/auth/session` and `/api/roster`**, and `/api/auth/session` *must* be reachable **unauthenticated** — it is the endpoint a signed-out brother hits to establish a session. Cloud Run's `roles/run.invoker` IAM is enforced **per service**, not per path: "require authentication" is a service-level setting, with no way to gate one route while leaving a sibling route public on the same service. Requiring IAM on `/api/roster` would therefore also lock out `/api/auth/session` (and `/api/profiles`), breaking sign-in for everyone. **B's claim is load-bearing and correct; the front-door option is infeasible as architected.**

(The only way to keep an IAM front door would be to split `/api/roster` onto a *separate* Cloud Run service with its own IAM — a second service, a second deploy, and either a duplicated in-memory cache or direct Firestore reads. That is strictly more infrastructure for no benefit over the in-code check, which is already the co-equal option, is runtime-agnostic, and mirrors the Ghost-JWKS path the app already implements. I recommend against the split.)

**The subject-pin (Reviewer A) still matters on the surviving option.** An in-code check that verifies only **issuer = Google** and **audience = Book** would accept *any* Google-issued token for that audience — every GCP service account in existence. The check must additionally pin **subject = the exact `linter` service account**. This preserves the credited keyless-SA strength (TRIAGE-PLAN principle 6) while closing the over-broad-acceptance hole.

**Proposed disposition — (a) fix.** Amend `D58` and the two specs to **remove the IAM-front-door option** and mandate the in-code path:

- Verify the Google OIDC identity token against Google's JWKS, requiring **issuer + audience = Book + subject = the `linter` SA**; reject on any mismatch.
- Keep the SA least-privileged; the service stays publicly invocable (it must, for auth), so `run.invoker` is not the control here — the in-code subject check is.
- Add tests asserting wrong-issuer / wrong-audience / wrong-subject are all rejected (a natural extension of the §6.6 auth tests).

> **Provisional D78 — The Linter roster endpoint is authenticated solely by an in-code Google-JWKS check pinning issuer + audience + the `linter` service-account subject; the Cloud Run IAM front door is dropped as infeasible on a single-service deployment.** Records to `D58` (amended), `ENGINEERING-DESIGN §5.2`, `API-SPEC §8`.

> **Your call:** This is mostly ratify — **do you accept dropping the front-door option and standardizing on the subject-pinned in-code check?** (Recommended.) The only alternative is the separate-service split above, which I'd reject.

---

## 4 · U1 — Adopt WCAG 2.2 AA over 2.1 AA · `should-fix`

**What it is.** `D32`/`D67` adopt **WCAG 2.1 AA** as hard policy and back it with real verification (axe-core in CI, a contrast gate, a manual per-page checklist). **WCAG 2.2 AA** was published October 2023 and is a strict superset; targeting the superseded version for a 2026 accessibility-first launch is the gap. To the design's credit this is a *concrete, testable* standard already, so the machinery to extend exists.

**What 2.2 adds, and why it fits this audience.** The new success criteria at levels A/AA — and Book's posture toward each:

- **2.4.11 Focus Not Obscured (Minimum) — AA.** A focused element must not be entirely hidden by sticky headers/toolbars. Directly relevant to the Directory's sticky header over the virtualized grid; a real thing to verify, not free.
- **2.5.8 Target Size (Minimum) — AA.** ≥24×24 CSS px for targets. Book's `D32` already commits to **≥44×44**, so this is **already satisfied** (2.1 AA had no target-size criterion at all — the 44px rule was AAA — so adopting 2.2 here just makes an existing strength conformant).
- **3.2.6 Consistent Help — A.** Help mechanisms appear in a consistent relative order across pages. Dovetails with the in-context help work (`D53`, and `U2`'s phasing question).
- **3.3.7 Redundant Entry — A.** Don't force re-entry of information already provided in the same process. Relevant to the multi-step edit/save and the bulk-import confirm flows.
- **3.3.8 Accessible Authentication (Minimum) — AA.** No cognitive-function test (e.g. remembering a password, solving a puzzle) in any auth step. Book's Ghost **magic-link** bridge is the canonical way to *satisfy* this — there is no password to recall — so Book likely **already complies** by construction.

(Housekeeping: 2.2 also **obsoleted 4.1.1 Parsing** — it no longer applies, so the checklist should drop it. The enhanced "Accessible Authentication" and "Focus Appearance" criteria remain AAA and are out of scope at AA.)

The pattern is favorable: of the five A/AA additions, two are already met (2.5.8, 3.3.8), one is mostly free as help is built (3.2.6), and only 2.4.11 and 3.3.7 add genuine new verification — both squarely apt for an older-alum audience.

**Proposed disposition — (a) fix.** Raise the target to **WCAG 2.2 AA** and fold the additions into the `D67` three-layer checklist.

> **Provisional D79 — Accessibility target raised from WCAG 2.1 AA to 2.2 AA.** Amends `D32`/`D67`; enumerate 2.4.11, 2.5.8, 3.2.6, 3.3.7, 3.3.8 in the `D67` manual checklist (noting 2.5.8/3.3.8 are already met and 4.1.1 is dropped). Records to `PRD §5.5`, `ENGINEERING-DESIGN §6.6`.

> **Your call:** It's a policy change, so it's yours to ratify, but it's nearly automatic given your a11y-as-policy stance and that the verification machinery already exists. **Adopt WCAG 2.2 AA?** (Recommended.)

---

## 5 · R1 — Pre-decision: is the Book→Ghost push synchronous or asynchronous? *(axis only — disposed in Session 4)*

**Why this is a Session-0 item.** R1 (the non-atomic dual-write / email-change lockout) is the most-converged blocker in the review and its full fix — a transactional outbox — is Session 4's centerpiece. But the outbox's *shape* depends on one axis the current design left open: `ENGINEERING-DESIGN §5.1` pushes to Ghost "real time on save," with failures "retried a few times and otherwise left for this audit to catch (retry mechanics are a Session-6 operations detail)," and one reviewer's open question is simply **"is the push sync or async?"** Pinning that here lets Session 4 design the outbox instead of debating its premise. Session 0 sets the **direction**; the worksheet disposition for R1 stays in Session 4.

**The two options.**

- **Synchronous in-request.** Book calls the Ghost Admin API inside the Save request and only returns success when Ghost acknowledges. *Cost:* Book's write latency and availability are coupled to Ghost — a slow or down Ghost makes Saves slow or fail (the `A-4 #4` coupling facet). And it still doesn't solve durability: a push that fails *after* the Firestore commit needs durable retry regardless, so you end up needing a queue anyway. Synchronous buys nothing it doesn't also cost.
- **Asynchronous via a durable transactional outbox.** Commit Firestore (the system of record) and, in the same transaction, enqueue a durable **pending-push** record; a worker drains it immediately with idempotent, bounded-backoff retries and a dead-letter that **alerts** (not "the manual audit will catch it"). Freshness is near-real-time; availability is decoupled; failures are durable and observable.

**Why async wins — and why it honors the freshness requirement.** `D55`'s reason for "real time" is that **email is the auth join key**: Ghost must learn an email change *before the brother's next sign-in*. That is a *freshness* requirement (seconds of slack), not a *synchronicity* requirement — an outbox that fires on commit meets it comfortably while removing the coupling and the silent-drift failure mode. Crucially, the outbox must preserve the credited **read-only-into-Book invariant** (`D55`, TRIAGE-PLAN principle 6): it only ever re-pushes Book→Ghost; it never lets Ghost overwrite Book. Addressing by the stored `ghostMemberId` (already in the design) keeps each push idempotent and an email change unambiguous.

**The email-change special case to carry into Session 4.** Async opens a small window where Book holds the new email and Ghost still holds the old; if the brother requests a magic link during that window, Ghost mails the *old* address and the returning JWT carries an email Book no longer resolves — the lockout, now rare but not impossible. The direction should therefore tag email-change pushes as **expedited**, and flag (for Session 4 to design) a brief **sign-in grace path** — e.g. retain the previous email as a resolvable alias until the push confirms, then retire it — plus a user-visible "email change pending" status. These are Session-4 mechanics; Session 0 only commits to the axis that makes them necessary and possible.

**Proposed direction.** **Asynchronous, on a durable transactional outbox** (Firestore-backed pending-push or Cloud Tasks), committed atomically with the profile write, drained with idempotent retry + dead-letter alerting, email-change expedited with a grace path — preserving the read-only-into-Book invariant. Session 4 designs the outbox, the orphan/compensation sweeps (`R7`), and the alerting (`R10`) on top of this.

> **Your call:** **Confirm the async-outbox axis** — commit Firestore, then push via a durable near-real-time queue with retry + alert, rather than a synchronous in-request push — **and the "email-change is the special case" framing** Session 4 will build the grace path around. (Recommended.)

---

## 6 · R8 — Pre-decision: pull the denormalized all-profiles snapshot forward? *(direction only — disposed in Session 2)*

**Why this is a Session-0 item.** R8 (cold starts re-read all ~2,000 docs and run brotli on a cold instance, spiking first-load latency for the slow-connection cohort) recommends a mitigation that is **already a recorded deferral**: `PRD §3.2`'s "single denormalized 'all-profiles' snapshot (one Firestore doc or GCS object), regenerated on write, read on cold start in place of ~2,000 individual reads — collapsing cold-start reads from ~2,000 to one." Whether to pull it into MVP gates Session 2's read/cache cluster, so Session 0 sets the lean. R8's worksheet disposition belongs to Session 2.

**The case for pulling it forward.** It is cheap, already designed, and aimed at exactly the cohort the product bends over backwards for (`D73`–`D76`): collapsing cold-start reads to one read directly cuts cold-start first-byte latency, and it caps per-cold-start Firestore load at 10× scale. It is an infrastructure optimization with no user-facing surface — a clean pull-forward candidate.

**The one coupling that makes this a *lean*, not a commitment.** R8's payoff is contingent on **how Session 2 resolves R2** (the snapshot-listener freshness problem on scale-to-zero Cloud Run). R2's candidate fixes include setting **`min-instances ≥ 1` / "CPU always allocated"** — which would make cold starts *rare*, shrinking R8's benefit — versus keeping **scale-to-zero**, under which cold starts are frequent and both R2 (stale-but-304-confirmed reads) and R8 (cold read + brotli latency) bite hardest. The denormalized snapshot also interacts with R3/S1: a single snapshot doc could even carry a precompressed payload, but that is Session 2's knot to untie. So the snapshot is *independently sensible*, but committing to it before the scale-to-zero decision would be deciding in the wrong order.

**Proposed direction.** **Provisional yes — lean toward pulling the denormalized snapshot into MVP — with the final go/no-go made inside Session 2**, jointly with the R2 scale-to-zero-vs-min-instances call and the R3 brotli decision. If Session 2 keeps scale-to-zero, the snapshot becomes load-bearing and is pulled forward; if Session 2 chooses `min-instances ≥ 1`, the snapshot drops to a smaller, optional win and may stay deferred. Either way, Session 0's job is done by recording the lean and the dependency.

> **Your call:** **Confirm the provisional "yes, pull forward" lean**, understanding the firm decision is made in Session 2 because R8's value depends on the cold-start strategy chosen there. (Recommended.)

---

## Recording surfaces (per TRIAGE-PLAN principle 4)

| Item | Worksheet (§12) | Delivered docs | `DECISIONS.md` |
|---|---|---|---|
| P18 | (d) + note "build-to-stricter; legal read pending" | privacy notice scope flows into Session 3 / P2 | **D77** (policy) |
| P19 | (b) close | `USER-MANUAL §1`/`§11`, `DATABASE-SCHEMA §4` (one line: adults 18+) | — |
| S17 | (a) fix | `ENGINEERING-DESIGN §5.2`, `API-SPEC §8` (amend `D58`) | **D78** |
| U1 | (a) fix | `PRD §5.5`, `ENGINEERING-DESIGN §6.6` (amend `D32`/`D67`) | **D79** |
| R1 | *(Session 4)* | *(Session 4: §5.1 outbox)* | *(D## in Session 4)* |
| R8 | *(Session 2)* | *(Session 2: §1.5/§1.6; `PRD §3.2`)* | *(D## in Session 2, if pulled forward)* |

`D77`–`D79` are provisional drafts; the resolution pass (TRIAGE-PLAN §6) finalizes and renumbers. Per principle 5, the actual doc edits happen in the concentrated propagation phase, not now.

## The six questions, consolidated

1. **P18** — Commit to build-to-stricter privacy as policy (recommended) and seek a legal determination in parallel, or hold the P-cluster pending a lawyer's read? *(plus the one-line revenue/sale confirm)*
2. **P19** — Confirm no brother could be under 16; state the population as adults (18+)?
3. **S17** — Accept dropping the IAM front door and standardizing on the subject-pinned in-code Google-JWKS check?
4. **U1** — Adopt WCAG 2.2 AA?
5. **R1** — Confirm the async durable-outbox axis (Firestore-first, near-real-time push with retry + alert, email-change expedited) over a synchronous in-request push?
6. **R8** — Confirm the provisional "pull the snapshot forward" lean, final call deferred to Session 2?

*— Drafted 2026-06-08 for review before live Session 0. Next: you redline these proposals, then we run Session 0 (live · High) to ratify dispositions into the §12 worksheet and `D77+`.*
