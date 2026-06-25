# PBE Address Book — Triage Brief 4: Write-integrity / Ghost seam (+ restore)

The pre-session brief for **Triage Session 4** per [`TRIAGE-PLAN.md`](TRIAGE-PLAN.md) §5 — the **non-atomic-multi-store spine**. It proposes a disposition (a/b/c/d) and a fix sketch for the fourteen write-integrity and operations findings — **R1, R4, R5, R7, R9, R10, R11, R12, R13, R14, R15, R21, S2, S13** — nearly all of which are facets of one shape the §6 preamble named exactly: *every write of consequence touches two or more of {Firestore, GCS, Ghost}, the failure path is "the manual audit will catch it eventually," and the only specified alert is on sign-in denials — not on the push failures that actually drive divergence.* Per the §10 workflow you set on 2026-06-08, this brief is drafted **in-session**, immediately before the live triage that follows it.

> **Status:** Drafted 2026-06-09 at **Max** depth (the deepest brief in the plan, alongside Gating and Read/cache — TRIAGE-PLAN §7), before the live Session 4 (live · **Extra**). **Every disposition here is a proposal, not a decision.** The recording surfaces (the composite §12 worksheet; the eight delivered docs; `DECISIONS.md` `D96+`) stay untouched until you ratify live. Provisional `D##` numbers (**D96–D102**) are drafts to be finalized/renumbered in the resolution pass (TRIAGE-PLAN §6). Input: [`DESIGN-REVIEW-COMPOSITE.md`](DESIGN-REVIEW-COMPOSITE.md) findings **R1, R4, R5, R7, R9–R15, R21, S2, S13**, plus `DECISIONS.md` D7/D8/D11/D25/D26/D52/D55/D56/D63/D68/D71/D72 and the Session-2/3 decisions **D77, D83, D84, D85, D86, D87** read in full.
>
> **This session is structurally different from Session 3.** Session 3 had D77 turning legal "blockers" into values calls, so it produced many **(b) as-designed** dispositions. Session 4 has the opposite shape: these are **real reliability gaps the design itself already concedes** — §5.1 says retry mechanics are "a Session-6 operations detail" and §6 never delivers them; D52 specified the admin operations as "surfaces, confirmations, and result reporting **with the mechanics deferred**." So almost everything here is **(a) fix**, and the judgment is not *whether* to fix but *which mechanism* and *how deep*. The work is: **finalize the outbox (R1), pin a handful of architectural mechanisms, and decide how hard restore validates.** The bolded calls below are the few genuine forks.
>
> **Three Session-2 decisions reshape this whole session — read them before the findings:**
> - **D83 (`max-instances = 1`, scale-to-zero)** explicitly *hands this session a problem*: the snapshot listener is retired as the correctness mechanism and kept only as "a convergence safety net for the brief two-instance deploy window **and for out-of-band writers (restore/migration, handled in Session 4)**." Every async job in this session writes Firestore from *outside* the single authoritative instance, so **how the instance's cache + the D85 snapshot reconverge after an out-of-band bulk write is a Session-4 design obligation, not a free property.** This is the connective tissue across R4/R5/R11/R15.
> - **D84 (compression off the event loop)** reserved an **explicit "regenerate once after the batch" hook** that "known-batch operations (bulk-CSV apply, bulk delete) invoke after all rows are written — *coordinated with the Session-4 bulk-ops design*." Session 4 is where that hook gets wired to restore, bulk-import, bulk-delete, regenerate-all, and migration.
> - **D85 (the GCS snapshot regenerated on every write)** is the object an out-of-band job must refresh; reconciling its version against Firestore on cold start is already the stale-snapshot guard.
>
> **Session-0/3 outcomes consumed:** **Session 0** directionally pre-decided R1's open "is the push sync or async?" question (composite A-4 #24) toward an **async outbox** — this brief *finalizes* that direction, it does not reopen it. **D77** removed the **tombstone/deny-list**: whole-record deletion is admin error-correction only, there is no privacy-deletion, so **restore resurrects no deleted brother** (the P3 facet that once bound R5/R1 is gone — restore consumes *no* tombstone), and R1's create path is made safe by **idempotent create** (address by `ghostMemberId`, treat "already exists" as success — D77's own words). **D55**'s read-only-into-Book invariant is the one strength every fix here must preserve (composite §9): the outbox re-pushes **Book→Ghost** and must never let Ghost write Book. **D86** (rate limits) is the throttle the bulk-import Ghost-push must respect. **D80** (un-decease restores the consent snapshot) is the deceased-lifecycle behavior R1's deceased-unsubscribe push must durably deliver.

---

## What Session 4 settles

The composite's executive summary named two "blocker spines"; Session 3 cut the legal tendon out of the privacy one. **This is the other spine, and it is entirely intact** — it is the most-converged technical cluster in the whole review (R1 alone was raised by both reviewers across three of four lenses). The honest framing:

**Book is correct on the happy path and underspecified on every failure path.** The reliability *bones* are sound and were credited (write-through Firestore, optimistic concurrency on a server `updateTime`, versioned object storage, the read-only Ghost audit, managed TLS). What's missing is everything that happens when one of two-or-three coupled stores fails mid-write: no durable retry, no compensation, no idempotency, no trace to reconstruct the failure, no alert on the one failure mode that silently diverges Book from Ghost, and — at the destructive end — a restore that writes verbatim with no validation and no path back to Ghost-alignment. None of this is a values question; it is engineering the design deferred and the reviewers correctly refused to let it stay deferred.

Sorted by the judgment they actually need:

1. **The genuine architectural forks (≈4).** **R1** — the outbox's *email-change special case* (the one place async decoupling and the auth join key collide). **R4** — the *out-of-band-writer cache-coherence* mechanism D83 handed forward (how the single instance reconverges after an async job). **R5** — *how hard restore validates and how it re-aligns Ghost* (the multi-lens hotspot). **S2** — the *normalization rules + how far uniqueness extends* (does `alternateEmail` join the namespace?).
2. **Mechanism pins — (a) fix, ratify-the-pattern (≈8).** The outbox's companions (R13 idempotency keys, R9 trace IDs, R10 alerting, R14 contract-drift detection), the non-Ghost multi-store compensation + orphan-sweep (R7, R12), and the async-job instances (R11 bulk import, R15 migration). Each has a near-obvious best-practice answer; you confirm or redirect.
3. **Posture statements — (a) fix, pin-the-numbers (2).** **S13** backup integrity/ACL/encryption and **R21** DR (RPO/RTO/single-region/test-restore) — standard, with a couple of numbers to pin (some already pinned: backup retention is 3 months per D94/P16).

**Net effort:** make ~4 architectural calls (R1 email, R4 coherence, R5 restore depth, S2 scope), ratify ~8 mechanism pins, pin 2 posture statements. No `(b) as-designed` escapes — the design concedes these are gaps.

| # | Finding · sev | Proposed disposition | The call that is yours |
|---|---|---|---|
| **R1** | Book→Ghost dual-write non-atomic, no outbox · `blocker` | **(a) fix** — durable async outbox (finalizes the Session-0 direction): commit Firestore → enqueue idempotent, bounded-backoff push → dead-letter drives an **alert**; preserves D55 read-only-into-Book · **D96** | **Email-change fork:** how to keep a brother sign-in-able while his email-change push is still pending (old-email-resolves vs. sync-push-this-one-field) |
| **R13** | No idempotency keys → unclean retries · `should-fix` | **(a) fix** — idempotency key on mutating writes; PATCH treats "the conflicting `updateTime` is my own" as success · folded into **D96** | Ratify (it's the outbox's precondition) |
| **R9** | No trace correlation across the save path · `should-fix` | **(a) fix** — propagate `X-Cloud-Trace-Context` through every log line + external call + audit entry · **D97** | Ratify |
| **R10** | Ghost-push failure has no alert · `should-fix` | **(a) fix** — alert on push-failure rate / queue depth-age / listener health; scheduled sign-in + Ghost canary · **D97** | Ratify |
| **R14** | Ghost-contract drift undetectable (silent two-master revert) · `should-fix` | **(a) fix** — document + version the depended-on Ghost surfaces; canary the account-redirect & JWT/JWKS; run the seam contract test on a schedule · **D97** | Ratify; the account-redirect canary is the load-bearing piece |
| **R7** | Multi-store writes (headshot/delete/create) non-atomic, ordering unspecified · `should-fix` | **(a) fix** — pointer-last ordering, re-runnable delete, idempotent steps, periodic orphan-sweep · **D98** | Ratify the ordering rules |
| **R12** | Delete leaves dangling `bigBrotherId`/`stars` · `should-fix` | **(a) fix** — scrub inbound refs in the delete op + the orphan-sweep backstop · folded into **D98** | Block-delete-while-referenced vs. scrub-and-proceed? |
| **S2** | Email is the auth key but has no uniqueness/normalization · `blocker` | **(a) fix** — transactional `emails/{email}` reservation; canonical normalization at write **and** resolution; **fail closed** on ambiguity · **D99** | **Scope fork:** does `alternateEmail` share the uniqueness namespace? Confirm fail-closed even when it locks out a dup'd brother |
| **R4** | Long-running ops run as sync requests, will time out · `should-fix` | **(a) fix** — async jobs (Cloud Run Jobs/Tasks) with progress/resume/idempotency; big bytes via signed URLs; server-side bulk-delete · **D100** | **Coherence fork:** how the single instance (D83) reconverges after an out-of-band job — maintenance-flag + explicit snapshot-regen (rec) vs. lean on the listener |
| **R11** | Bulk import: no batch atomicity, Ghost-push consequence unspecified · `blocker`(B) | **(a) fix** — chunked/resumable/idempotent Apply with per-row reporting; async worker respecting Ghost rate limits (D86); define the import→push policy · **D100** | Push-per-changed-row through the outbox (rec) vs. import-without-push + audit reconcile |
| **R15** | Eager migration over public net, 500-op limit, mid-deploy old-code race · `should-fix` | **(a) fix** — run migrations as an in-network Job with cursor-resume; backward-compatible-read-then-migrate or drain first · **D100** | Ratify |
| **R5** | Restore non-atomic, no read-freeze, bypasses validation, diverges from Ghost · `should-fix` | **(a) fix** — read-only maintenance mode; async + verify; **structural** validation (cycles/uniqueness/refs); post-restore Ghost reconcile via the audit + a reviewed bulk re-push · **D101** | **Restore-depth fork:** structural-validation floor + role-delta audit + reviewed Ghost re-push — and whether to **gate `role` on restore** |
| **S13** | Restore sets roles unaudited; backups are unguarded crown-jewels · `should-fix` | **(a) fix** — audit the full role delta; bucket ACL/encryption/retention; optional signed manifest · folded into **D101** | Signed-manifest backup (heavier) vs. structural-validation + role-gate (lighter, rec) |
| **R21** | DR posture (RPO/RTO/single-region/integrity) unstated · `minor` | **(a) fix** — state ~24h RPO, single-region RTO; periodic test-restore + checksums · **D102** | Accept single-region + ~24h RPO (rec)? |

---

## §1 · The transactional outbox — R1 (the spine), R13

### R1 — The Book→Ghost dual-write is non-atomic with no outbox · `blocker`

**What it is.** Every create/update/delete/deceased writes Firestore *and* calls the Ghost Admin API with no transaction binding them, and §6 never delivers the "retried a few times" mechanics §5.1 promised. Three concrete failure modes: **(a) email-change lockout** — a brother edits his own email, the Ghost push fails, Book holds the new email while Ghost holds the old; his next sign-in JWT carries Ghost's (old) email, which Book can no longer resolve → denied until a human reconciles; **(b) deceased-still-emailed** — a failed unsubscribe-push leaves Ghost mailing PBE News toward a deceased brother (family-facing harm); **(c) create-orphans** — Firestore profile written but Ghost-create fails (brother can never sign in), or Ghost member created but `ghostMemberId` fails to persist (next update can't address him; a retried POST 409s). And if the push is synchronous, Book's save latency/availability is coupled to Ghost's.

**Why it's the spine, and what's already half-built.** This was the single most-converged finding in the review, and both reviewers independently prescribed the same answer: a **transactional outbox**. The design is already most of the way there — D55 deliberately addresses Ghost updates **by `ghostMemberId`, not by email**, so an email *change* is unambiguous on the Ghost side, and D77 already named **idempotent create** (treat "already exists" as success) as the create-orphan fix. The only true gap is the **failure/retry path**: there is no durable queue, no retry policy, no dead-letter, no alert. Session 0 already pre-decided the **async** direction (the A-4 #24 sync-vs-async question), so this is not reopened — it is finalized.

**The fix — the outbox, finalized.** On any mutation: **commit Firestore first, then enqueue a durable pending-push record** (a Firestore `outbox` collection or Cloud Tasks); a worker drains it with **idempotent, bounded-backoff retry**, addressing Ghost by `ghostMemberId`, treating "already exists"/"already in that state" as success; exhausted retries land in a **dead-letter that fires an alert** (R10), not a manual audit. This decouples save latency from Ghost (fixing the sync-coupling facet) and makes (b) and (c) self-healing. **The D55 invariant is preserved by construction** — the outbox only ever pushes Book→Ghost; the read-only reconciliation audit still never writes Book.

**The one genuine fork — the email-change lockout (a).** Async decoupling and "email is the auth join key" collide exactly here: while an email-change push sits in the outbox, Ghost still issues sign-in JWTs carrying the *old* email, but Book has already moved to the *new* one. Two honest resolutions:

- **(i) Keep the old email sign-in-resolvable until the push confirms (recommended).** When an email change is enqueued, Book retains the *previous* email as a still-valid resolution target (a pending-email entry in the `emails/{email}` reservation map of S2) and shows the brother a visible "email change pending" status; once the outbox confirms Ghost has the new email, the old entry is retired. This keeps the push fully async (no Ghost coupling), never locks the brother out, and rides on the S2 reservation mechanism you're building anyway. Cost: a little extra state and a short window where *both* emails resolve to him (harmless — same person).
- **(ii) Push the email field synchronously, async everything else.** The email-change save blocks until Ghost confirms; all other fields go async. Simplest to reason about (no divergence window at all), but it re-introduces exactly the Ghost latency/availability coupling the outbox exists to remove — for the one operation where a Ghost outage would then block the brother's own save.

I lean **(i)**: it preserves the outbox's whole point and degrades gracefully under a Ghost outage (the change just stays pending, the brother keeps signing in with his old email), whereas (ii) makes the rarest write the most fragile. But (i) is more moving parts, so it's your call.

**Proposed disposition — (a) fix, foundational.**

> **Provisional D96 — Book→Ghost writes go through a durable transactional outbox: commit Firestore, enqueue an idempotent push (address by `ghostMemberId`; "already exists/already in state" = success), retry with bounded backoff, dead-letter → alert (R10). Email-change is handled by [old-email-resolves-until-confirmed / synchronous email push] so a pending push never causes a sign-in lockout. Preserves D55's read-only-into-Book invariant.** Amends D55 ("real time on save" → "commit then enqueue async push"); records to `ENGINEERING-DESIGN §5.1`, `PRD §6.1`.

> **Your call (R1):** ratify the async outbox (Session 0 set the direction); choose the **email-change** handling — **(i) old-email-resolves (recommended)** vs. **(ii) sync-push the email field**.

### R13 — No idempotency keys, so lost-response retries aren't clean · `should-fix`

**What it is.** If a write succeeds server-side but the response is lost, the client's retry produces a spurious **412** on PATCH (its own prior write moved `updateTime`), a **409** on `POST /profiles`, or an orphaned extra headshot version. The prompt's "safely retryable" property fails for the lost-response case — and clean retry is the **precondition** for both the outbox (R1) and the multi-store fixes (R7).

**The fix — clean (a), folded into the outbox.** Accept an **idempotency key** on mutating requests and de-duplicate retries server-side (return the original result); for PATCH specifically, detect "the conflicting `updateTime` is my own just-applied write" and treat the retry as success rather than a conflict. This is the same idempotency discipline the outbox worker needs internally, so it belongs with D96.

> **Provisional — folded into D96** (the outbox and the client both need idempotent writes). Records to `API-SPEC §1.4`/`§3`/`§6`.

> **Your call (R13):** ratify.

---

## §2 · Seeing the seam fail — R9, R10, R14

These three are why the outbox can be *trusted*: a non-atomic seam you can't observe is one you can't operate. They cohere into one observability decision.

### R9 — No request/trace correlation across the multi-service save path · `should-fix`

**What it is.** A single "Save" spans PATCH → verification side-effect → Ghost push → photo PUT/DELETE across Cloud Run + Firestore + Ghost + GCS, with no trace/correlation ID tying them, so reconstructing *which step failed in which user action* is guesswork.

**The fix — clean (a).** Propagate a correlation/trace ID (Cloud Run injects `X-Cloud-Trace-Context`) through every log line and external call; carry it into the **outbox record** and the **audit entry**; adopt Cloud Trace for the save path. With the outbox now async, the correlation ID is what stitches the deferred push back to the originating action.

### R10 — The one failure mode that drives silent divergence has no alert · `should-fix`

**What it is.** Only "a burst of sign-in denials" drives alerting. Ghost-push failures — the *root* of R1/R5 — are merely logged, and the reconciliation audit that catches them is manual/admin-triggered, so drift accumulates silently until someone runs it.

**The fix — clean (a).** Add log-based metrics + alerts on **Ghost-push failure rate**, **outbox queue depth/age** (R1), and **cache-age / listener health** (the D83 watchdog already exists — wire its alert here). Add a **scheduled synthetic canary** exercising sign-in and a non-mutating Ghost call. This is what makes the outbox's dead-letter (D96) operationally real rather than a place failures go to be forgotten.

### R14 — Brittleness to Ghost contract change, with nothing to detect it · `should-fix`

**What it is.** The bridge depends on Ghost Pro specifics (the member-session JWT, JWKS, Portal redirect, `routes.yaml`/Handlebars, the Admin-API shapes, the account-link JS-injection redirect). Ghost Pro auto-updates; any change can cause a silent auth outage — or, in the account-redirect case, **silently revert to "members edit in Ghost"** (two-master, the exact thing D55 removes) with no detection.

**Why the account-redirect canary is the sharp one.** Most of R14 is "pin and document what's pinnable." But the account-redirect facet is special: if a Ghost update breaks the injection that redirects Ghost's account UI to Book, Book doesn't error — it *silently* lets members edit in Ghost again, quietly undoing D55's single-master guarantee. That can't be caught by a sign-in canary; it needs a periodic check that the redirect is *still in place*.

**The fix — clean (a).** Document + version the exact Ghost surfaces depended on; add a **canary that verifies the account-redirect still fires** (detects the silent two-master revert) plus the sign-in canary (R10) for the read path; keep the `IdentityProvider` seam's contract test (D72) running against real Ghost **on a schedule, not only at build time**; cite the stability of the member-session JWT/JWKS contract.

**Proposed disposition for the section — (a) fix, foundational (one observability decision).**

> **Provisional D97 — Observability for the multi-store write path: a correlation/trace ID through every log line, external call, outbox record, and audit entry (R9); alerts on Ghost-push failure rate, outbox depth/age, and cache/listener health (R10); scheduled canaries for sign-in, a non-mutating Ghost call, and the account-redirect's continued presence (R10/R14); the `IdentityProvider` contract test runs on a schedule (R14).** Amends D61; records to `ENGINEERING-DESIGN §6.1`, `§5.1`, `§2.1`.

> **Your call (R9/R10/R14):** ratify the bundle; confirm the **account-redirect canary** is wanted (it's the one that protects D55 from a silent Ghost auto-update).

---

## §3 · The non-Ghost multi-store writes — R7, R12

R1 is the *Ghost* seam; R7 is its non-Ghost twin (Firestore + GCS), and R12 is the referential-integrity hole the same orphan-sweep closes.

### R7 — Multi-store mutations are non-atomic with no compensation; ordering unspecified · `should-fix`

**What it is.** Headshot `PUT` = two GCS writes (512² + 96²) + one Firestore write — a partial failure leaves an orphaned object or a profile pointing at a version whose objects don't exist (broken image). `DELETE` cascades profiles + `users` + N GCS objects + the Ghost member; any mid-cascade failure half-deletes the brother. `POST` create + Ghost-id capture has the same shape (it's R1c).

**The fix — clean (a), an ordering + sweep discipline.** State ordering and compensation per operation: **write objects first, advance the version pointer last** (so the pointer only ever names existing objects); **order delete steps to be re-runnable** (and, since the Ghost member-delete is now an outbox push per D96, the cascade's Ghost step inherits the outbox's retry); make each step **idempotent** (R13) so the whole op is safely retryable; add a **periodic orphan-sweep** for GCS objects / `users` docs / Ghost members with no live profile. Versioned object storage (D8) and write-through Firestore (D7) are the credited strengths this builds on, not replaces.

### R12 — Delete leaves dangling `bigBrotherId` (and `stars`) references · `should-fix`

**What it is.** `bigBrotherId` integrity is checked only at *write* time, so deleting the *referent* leaves the brothers who point at him with a big-brother chip that 404s and a Little-Brothers scan that silently drops the edge; the delete also doesn't scrub other users' `stars` arrays containing the deleted ID.

**The fix — clean (a), covered by the sweep.** On delete, **scrub inbound `bigBrotherId` and `stars` references** in the same operation, and let the R7 **orphan-sweep** be the backstop that catches any missed by a partial failure; at minimum render a dangling reference gracefully and report it in the audit. **One small sub-call:** block-delete-while-referenced (forces the admin to reassign first — safer, more friction) vs. scrub-and-proceed (smoother, relies on the sweep). I lean **scrub-and-proceed** — delete is an admin error-correction action and shouldn't be blocked by an incoming pointer — but block-while-referenced is the more conservative choice if you'd rather never auto-mutate a third brother's record during a delete.

**Proposed disposition for the section — (a) fix, foundational.**

> **Provisional D98 — Multi-store mutations get explicit ordering + compensation: write GCS objects before advancing the version pointer; order the delete cascade to be re-runnable; idempotent steps (R13); a periodic orphan-sweep over GCS/`users`/Ghost-members with no live profile, which also scrubs inbound `bigBrotherId`/`stars` on delete (R12).** Records to `API-SPEC §3`/`§6`, `ENGINEERING-DESIGN §5.1`, `DATABASE-SCHEMA §7`/`§8`.

> **Your call (R7/R12):** ratify the ordering/sweep; choose **scrub-and-proceed (recommended)** vs. **block-delete-while-referenced** for inbound `bigBrotherId`.

---

## §4 · Email, the authentication join key — S2

### S2 — Email is the auth join key but has no uniqueness or normalization constraint · `blocker`

**What it is.** Sign-in "resolves the verified email to a `profiles` record," and Mixpanel/Ghost matching key on email too — but validation enforces uniqueness only on `id`; email has *format* validation only, no canonicalization. Two profiles sharing an email (incomplete dedup, data-entry error, or a malicious `PATCH`) make resolution ambiguous — and if one is a manager/admin, a brother can authenticate onto the **wrong, higher-privilege profile**. Reviewer B's active attack: a brother edits his email to match an admin's; once Ghost carries it, his next JWT maps him to the admin profile — full takeover. Case/Unicode drift between Ghost and Book can also break *legitimate* logins.

**Why it's the other path to R1's symptom, and genuinely a blocker.** R1's lockout is the *failed-push* path; S2's is the *duplicate-email* path — distinct mechanism, distinct fix, same auth seam. Reviewer A rated it should-fix but said explicitly it "becomes a blocker precisely because email gates auth" — which is the situation here, so both reviewers effectively agree. Firestore can't unique-constrain a non-key field, so this needs a deliberate mechanism, not a validation rule.

**The fix — clean (a) on the mechanism.** A **transactional `emails/{normalizedEmail}` reservation document** created/updated atomically with the profile write at create/edit/import (the same map R1's pending-email entry lives in); a **canonical normalization** (lowercase, trim, Unicode-normalize) applied **identically at write and at resolution**; and resolution that **fails closed** — deny on any ambiguity rather than pick a record. Fail-closed is the right default *because* the failure mode is privilege escalation: a denied sign-in is a support ticket, a wrong-profile sign-in is a takeover.

**The two sub-calls that are yours.**
- **Does `alternateEmail` share the uniqueness namespace?** D55 says `alternateEmail` is *never* matched for sign-in and never pushed — so it can't itself cause a wrong-profile auth. But if a brother's `alternateEmail` collides with another brother's *primary*, you get confusing data and a latent problem if alternates ever become matchable. I lean **reserve primary and alternate in one shared namespace** (cheap, and it forecloses the confusion), but **fail-closed only on the primary-resolution path** (the auth-critical one). The minimal alternative is primary-only uniqueness; alternates stay format-checked.
- **Confirm fail-closed even when it locks out a legitimately-duplicated brother.** If genesis data or an import produced two profiles with one email, fail-closed denies *both* until an admin de-dups. That's the correct trade (deny beats escalate), and the reconciliation/dup-merge is exactly the admin error-correction path Book already has — but it's worth your explicit nod, because it means a data-quality problem surfaces as a sign-in denial.

**Proposed disposition — (a) fix, foundational.**

> **Provisional D99 — Email uniqueness is enforced via a transactional `emails/{email}` reservation doc at create/edit/import; a single canonical normalization (lowercase/trim/Unicode) is applied identically at write and at sign-in resolution; resolution fails closed (deny) on any ambiguity. [Primary+alternate share the namespace / primary only.]** Records to `ENGINEERING-DESIGN §2.1`/`§5.1`, `DATABASE-SCHEMA §8`, `API-SPEC §2`. Couples to D96 (the reservation map carries the pending-email entry for the email-change window).

> **Your call (S2):** ratify the reservation mechanism + normalization + fail-closed; decide **alternateEmail scope** (shared namespace, recommended, vs. primary-only).

---

## §5 · Long-running work leaves the request path — R4, R11, R15

One pattern, three instances — and the place D83's out-of-band-writer hand-off gets resolved.

### R4 — Whole-database / bulk ops run as synchronous requests and will time out · `should-fix`

**What it is.** Backup (zip ~50–150 MB of images through Cloud Run's ~32 MiB request limit), restore, bulk-CSV apply, and Regenerate-all-thumbnails are plain request/response endpoints; bulk-delete is a client loop over per-record DELETE; "Regenerate all" has *no batch endpoint* at all (so "all" = ~2,000 sequential HTTP calls). These exceed the request timeout well before 10× load, leaving operations half-done with no progress, resumability, or rollback. D52 specified these as *surfaces with mechanics deferred* — the deferred mechanics are exactly what's asked for.

**The fix — clean (a) on the pattern.** Move long-running ops to **async jobs** (Cloud Run Jobs / Cloud Tasks) with **progress, chunking, idempotent resumability, and a result the Admin page polls**; move large byte transfers via **GCS signed URLs** (backup/restore stream to/from GCS, never through the request); add a **dedicated server-side bulk-delete** (batch write/transaction, not a client loop). The automated backup already uses Cloud Scheduler→function — apply the same shape to the manual/admin operations.

**The fork D83 handed us — out-of-band-writer cache coherence.** Here's the connective tissue. Under D83 (`max-instances = 1`), the *single* Cloud Run instance is authoritative because it's the only writer and updates its own cache synchronously. But an async **Job** writes Firestore from *outside* that instance — so after a restore or a 2,000-row import, the running instance's in-memory cache and the D85 GCS snapshot are **stale**, and D83 explicitly deferred this case ("out-of-band writers… handled in Session 4"). Two ways to reconverge:
- **(i) Maintenance-flag + explicit snapshot-regen (recommended).** The job sets a **read-only maintenance flag** (R5 already wants this for restore), writes Firestore, **regenerates the D85 GCS snapshot directly** (the batch-regen hook D84 reserved), then clears the flag; the instance reloads its cache from the refreshed snapshot (its normal cold-start/hydration path, D85). Deterministic, no reliance on listener timing, and it reuses machinery D83/D84/D85 already built.
- **(ii) Lean on the retained snapshot listener.** Let the job just write Firestore and trust D83's "convergence safety net" listener to propagate. Simpler, but it's precisely the listener whose timing D83 stopped trusting as a *correctness* mechanism — fine as a backstop, wrong as the primary path for a 2,000-doc bulk write.

I lean **(i)** strongly: it's the same explicit-regen hook D84 already wired for bulk-CSV/bulk-delete, just extended to restore and migration, and it makes coherence a *property of the job* rather than a hope about background listener delivery.

### R11 — Bulk import lacks batch atomicity, and its Ghost-push consequence is unspecified · `blocker` (B)

**What it is.** The dry-run validates (D68), but Apply writes many rows with no transaction boundary — a mid-batch failure leaves some rows applied, some not. And a bulk import that changes emails/names is a set of **pushable** changes: pushing per row may hit Ghost Admin-API **rate limits** at hundreds of rows; *not* pushing silently diverges Book from Ghost for every changed email (R1 at scale). Reviewer B rates it a blocker (timeouts + rate-limits crash the op).

**The fix — clean (a), as an async-job instance.** Specify Apply as **chunked, idempotent, resumable** with **per-row success/failure reporting** and a re-runnable failure set; run it as the async worker of R4/D100 (upload CSV to GCS → Cloud Task). **The import→Ghost-push policy** is the one spec gap to close: I lean **enqueue each changed row's push through the outbox (D96)**, which inherits the outbox's rate-limit-respecting backoff (D86) and dead-letter — so a 500-row import produces 500 *durable* pushes drained at Ghost's pace, not 500 synchronous calls that trip the rate limit. The alternative — import without pushing, then run the reconciliation audit to re-align — is simpler but reintroduces deliberate divergence the outbox exists to prevent. The import's snapshot-regen fires **once after the batch** (D84's hook), not per row.

### R15 — Eager migration: public-internet run, 500-op limit, mid-deploy old-code race · `should-fix`

**What it is.** A breaking eager migration of ~2,000 docs: triggered from a laptop/CI over the public internet, a network drop leaves it partial; Firestore caps batch writes at 500 ops (must chunk) with no atomic rollback; and it mutates Firestore while an **old-code** instance may still be subscribed mid-deploy (D26/D83 allow a brief two-instance overlap), pushing new-shaped docs into that instance's cache.

**The fix — clean (a), the same job pattern + D72/D71.** Execute migrations only via a **Cloud Run Job / Cloud Task inside the Google network** with **cursor tracking for safe resume** (never from a laptop); specify **backward-compatible-read-then-migrate** or **drain old instances before migrating** to close the mid-deploy race. D71 already mandates numbered, idempotent, emulator-tested, backup-first migration scripts; this pins their *execution environment* and *rollout ordering*. The migration is itself an out-of-band writer, so it uses the §5(i) maintenance-flag + snapshot-regen path.

**Proposed disposition for the section — (a) fix, foundational.**

> **Provisional D100 — Long-running operations (backup, restore, bulk-CSV apply, bulk-delete, regenerate-all, migration) run as async jobs (Cloud Run Jobs / Cloud Tasks) with progress, chunking, idempotent resume, and a polled result; large bytes move via GCS signed URLs; a dedicated server-side bulk-delete replaces the client loop. Each job sets a read-only maintenance flag, writes Firestore, and explicitly regenerates the D85 snapshot (D84's batch hook) so the single authoritative instance (D83) reconverges — resolving D83's out-of-band-writer hand-off. Bulk-import Apply is chunked/resumable/idempotent with per-row reporting and enqueues per-changed-row Ghost pushes through the outbox (D96), respecting Ghost rate limits (D86); migrations run in-network with cursor-resume and deploy-ordering (D71/D72).** Records to `API-SPEC §6`/`§7`, `PRD §5.8`/`§5.8.2`, `ENGINEERING-DESIGN §6.3`/`§6.5`.

> **Your call (R4/R11/R15):** ratify the async-job pattern; choose the **coherence mechanism** — **(i) maintenance-flag + explicit snapshot-regen (recommended)** vs. **(ii) lean on the listener**; confirm **import pushes per-changed-row through the outbox (recommended)** vs. import-without-push + reconcile.

---

## §6 · Restore, the suite's biggest hotspot — R5, S13, R21

Restore is where four lenses converge (R5 atomicity/validation/divergence, S13 role-grant/backup-security, R21 continuity) on Book's single most destructive operation. D77 already removed one facet (no tombstone → **restore resurrects no deleted brother**), and D83 already defused another (single instance → **no multi-instance listener storm / OOM**). What remains is real.

### R5 — Restore is non-atomic, has no read-freeze, bypasses validation, diverges from Ghost · `should-fix`

**What it is.** Firestore has no atomic "replace collection," so restore rewrites ~2,000 docs while the live instance serves cached data and users see half-restored states; a mid-restore failure leaves a mixed database with no rollback. Restore writes **verbatim** and is **exempt from import rules** (D63), so a corrupted/edited backup can reintroduce big-brother cycles, duplicate IDs, or dangling references at the most destructive moment. And restore rewrites Book but **never reconciles Ghost** (sync is read-only by design), so rolling back to an older snapshot strands **Ghost ahead of Book** — the email-change lockout (R1) *en masse*.

**What's already handled, so we scope tightly.** The **listener-storm/OOM** facet is dissolved by D83 (one instance, no cross-instance cache churn). The **resurrect-deleted** facet is gone by D77 (no privacy-deletion). The **atomicity** facet is handled by D100 (restore is an async job under a maintenance flag with a verify step and snapshot-regen). So the two facets that need a *decision* here are **validation depth** and **Ghost reconciliation**.

**The fix — and the restore-depth fork.**
- **Maintenance mode + async + verify:** Book enters read-only maintenance during restore (reject/queue writes, signal the SPA), restores transactionally-or-resumably with a verify step, regenerates the snapshot, then resumes — all per D100. Ratify.
- **Structural validation (the fork's floor).** Even though field-level *edit* rules stay intentionally bypassed (D63 — restore means "be exactly this snapshot," not "merge corrections"), restore should run **structural** validation: **cycle detection** (big-brother), **ID uniqueness**, **reference integrity**, and **email-reservation consistency** (S2). This is the middle tier the reviewers asked for: *structure* must hold (or you've restored a broken database), but *content* is taken verbatim (that's restore's job). I lean strongly for this floor — it's the difference between "restore a snapshot" and "restore a snapshot *and any corruption an attacker put in it*."
- **Role handling — the sharp sub-call (this is S13's core).** Restore writes `role` verbatim, so a tampered backup grants `role: admin` with **no per-record role-change audit**. Two defenses, not exclusive: **(1) audit the full role delta** a restore applies (compare each restored `role` to the pre-restore value, write audit entries — restore should never be a silent role-change channel); and optionally **(2) gate `role` on restore** — restore everything *except* role, requiring role to be set through the audited Toggle-Privileges path (D51). I lean **(1) audit the delta always + (2) gate role** — together they mean a malicious backup can corrupt data (caught by structural validation + the verify step) but **cannot silently escalate privilege**, which is the whole point of S13.
- **Post-restore Ghost reconciliation.** D77 pre-framed this toward "caught by the existing read-only reconciliation audit (D55)." Concretely: after restore, run the **read-only reconciliation audit** to *detect* Book↔Ghost drift (Book rolled back, Ghost ahead), surface it to the admin, then perform a **reviewed bulk re-push Book→Ghost through the outbox (D96)** to re-align — preserving the read-only-into-Book invariant. I lean **admin-reviewed, not automatic**: a blind mass re-push after a rollback could itself do harm (mass re-subscribe/unsubscribe), and restore is rare and high-stakes enough to warrant a human looking at the discrepancy report before the re-push fires. So restore *detects and proposes*; the admin *approves* the re-push.

### S13 — Restore sets roles unaudited; backups are unguarded crown-jewels · `should-fix`

**What it is.** Backups are a JSON export of all three collections (incl. `users` = `role`); restore writes verbatim, exempt from rules — so a tampered backup grants admin (handled above). Separately, the manual backup is a **complete off-platform PII archive** whose integrity, encryption, and storage ACLs are unspecified.

**The fix — clean (a), plus the one heavier option.** The role-escalation half is handled by R5's role-delta audit + role-gate above. For the backup-as-crown-jewels half: specify the **backup bucket ACL** (service-account/admin only — never public), rely on **GCS default encryption at rest** (CMEK is overkill for a volunteer nonprofit unless you want it), and pin **retention** (already **3 months** per D94/P16). The downloadable manual archive leaves Book's controls entirely — note in the USER-MANUAL that the admin is its custodian. **The optional heavier defense:** a **signed manifest** on backups that restore verifies, so a tampered backup is *rejected* rather than merely *validated-and-audited*. I lean **skip the signed manifest for MVP** — structural validation + role-delta audit + role-gate already foreclose the privilege-escalation harm, and signing adds key-management overhead — but it's the natural upgrade if you want restore to *authenticate* its input, not just sanity-check it.

### R21 — DR / continuity posture is unstated · `minor`

**What it is.** Single-region is assumed (Cloud Run is regional); the daily backup implies a ~24h RPO that's never stated; region-failure RTO and ongoing backup-integrity verification (checksums / periodic test-restore) are unaddressed — a silently-corrupt backup would only be discovered at restore time, under duress.

**The fix — clean (a), pin the posture.** State **RPO ≈ 24h** (daily backup) and a **single-region RTO** (redeploy + restore time); **accept single-region** (I lean yes — a bi-annual-traffic volunteer directory doesn't warrant multi-region cost/complexity); add **periodic automated test-restore to staging** (D72's staging Book is the natural target) plus **backup checksums**, so integrity is verified continuously rather than discovered at restore. The test-restore also exercises the whole D100 restore-job path on a schedule.

**Proposed disposition for the section — (a) fix, foundational.**

> **Provisional D101 — Restore hardening: runs as an async job under read-only maintenance mode with a verify step (D100); runs structural validation (cycle/uniqueness/reference/email-reservation integrity) while keeping field-edit rules bypassed (D63); audits the full role delta and [gates `role` on restore / restores role verbatim but audited]; post-restore runs the read-only reconciliation audit (D55) and an admin-reviewed bulk Book→Ghost re-push through the outbox (D96) to re-align Ghost; backup bucket is ACL-restricted + encrypted-at-rest, retention 3 months (D94/P16), [signed manifest optional].** Records to `ENGINEERING-DESIGN §6.3`/`§5.1`, `API-SPEC §7`; amends D63.
>
> **Provisional D102 — DR/continuity posture: RPO ≈ 24h (daily backup), single-region RTO accepted; periodic automated test-restore to staging (D72) + backup checksums verify integrity continuously.** Records to `ENGINEERING-DESIGN §6.3`, `CODING-PROJECT-PLAN §4`. (May merge into D101 in resolution.)

> **Your call (R5/S13/R21):** ratify maintenance-mode + structural-validation; choose role handling — **audit-delta + gate `role` on restore (recommended)** vs. audit-delta only; confirm **admin-reviewed (not automatic)** post-restore Ghost re-push; **skip the signed manifest (recommended)** vs. add it; **accept single-region + ~24h RPO (recommended)**.

---

## Recording surfaces (per TRIAGE-PLAN principle 4)

Per principle 5, doc edits happen in the concentrated propagation phase (TRIAGE-PLAN §6); the worksheet + any inline `D##` are recorded as each is ratified.

| Item | Worksheet (§12) | Delivered docs | `DECISIONS.md` |
|---|---|---|---|
| R1 | (a) fix | `ENGINEERING-DESIGN §5.1`, `PRD §6.1` (amends D55) | **D96** |
| R13 | (a) fix | `API-SPEC §1.4`/`§3`/`§6` | folded into **D96** |
| R9 | (a) fix | `ENGINEERING-DESIGN §6.1` | **D97** (amends D61) |
| R10 | (a) fix | `ENGINEERING-DESIGN §6.1`/`§5.1` | **D97** |
| R14 | (a) fix | `ENGINEERING-DESIGN §2.1`/`§5.1` | **D97** |
| R7 | (a) fix | `API-SPEC §3`/`§6`, `ENGINEERING-DESIGN §5.1`, `DATABASE-SCHEMA §7` | **D98** |
| R12 | (a) fix | `API-SPEC §3`, `DATABASE-SCHEMA §8`/`§5.2` | folded into **D98** |
| S2 | (a) fix | `ENGINEERING-DESIGN §2.1`/`§5.1`, `DATABASE-SCHEMA §8`, `API-SPEC §2` | **D99** |
| R4 | (a) fix | `API-SPEC §6`/`§7`, `PRD §5.8`, `ENGINEERING-DESIGN §6.3` | **D100** |
| R11 | (a) fix | `PRD §5.8.2`, `ENGINEERING-DESIGN §6.5`, `API-SPEC §7` | **D100** |
| R15 | (a) fix | `ENGINEERING-DESIGN §6.5` (amends D71 execution) | **D100** |
| R5 | (a) fix | `ENGINEERING-DESIGN §6.3`/`§5.1` (amends D63) | **D101** |
| S13 | (a) fix | `ENGINEERING-DESIGN §6.3`, `API-SPEC §7` | folded into **D101** |
| R21 | (a) fix | `ENGINEERING-DESIGN §6.3`, `CODING-PROJECT-PLAN §4` | **D102** |

`D96`–`D102` are provisional drafts; the resolution pass (TRIAGE-PLAN §6) finalizes and renumbers (D102 may merge into D101). **Cross-session ties to flag in resolution:** D96 amends D55 ("real time on save" → outbox); D99's reservation map carries D96's pending-email entry; D100 resolves D83's out-of-band-writer hand-off and uses D84's batch-regen hook + D85's snapshot; D101's Ghost re-push rides D96's outbox; D101 backup retention already pinned by D94/P16.

---

## The questions, consolidated

Most of this session is ratify-the-mechanism (R13, R9, R10, R14, R7, R15 — and the backup-security half of S13). These are what I actually need from you, grouped:

**The outbox (R1) — the one design fork in the Ghost seam:**
1. Ratify the **async transactional outbox** (Session 0 set the direction). Choose the **email-change** handling: **(i) old-email-stays-resolvable until the push confirms (recommended)** vs. **(ii) push the email field synchronously**.

**Email uniqueness (S2):**
2. Ratify the **`emails/{email}` reservation + canonical normalization + fail-closed** resolution. Decide **alternateEmail scope**: shared uniqueness namespace **(recommended)** vs. primary-only. Confirm fail-closed even when it denies a legitimately-duplicated brother until de-dup.

**Multi-store writes (R7/R12):**
3. Ratify pointer-last ordering + orphan-sweep. For inbound `bigBrotherId` on delete: **scrub-and-proceed (recommended)** vs. **block-delete-while-referenced**.

**Async jobs + the D83 coherence hand-off (R4/R11/R15):**
4. Ratify the **async-job pattern**. Choose the out-of-band-writer **coherence mechanism**: **(i) maintenance-flag + explicit snapshot-regen (recommended)** vs. **(ii) lean on the retained listener**.
5. **R11 import→Ghost policy:** push **per-changed-row through the outbox (recommended)** vs. import-without-push + reconcile-audit.

**Restore — the hotspot (R5/S13/R21):**
6. Ratify maintenance-mode + **structural validation** (cycles/uniqueness/refs) with field-edit rules staying bypassed (D63).
7. **Role on restore:** **audit-the-delta + gate `role` (must set roles through the audited toggle path) (recommended)** vs. audit-delta only.
8. Confirm the post-restore Ghost re-push is **admin-reviewed, not automatic (recommended)**.
9. **Backup integrity:** **structural-validation + role-gate, skip the signed manifest (recommended)** vs. add a signed manifest.
10. **R21:** accept **single-region + ~24h RPO (recommended)** with periodic test-restore + checksums?

**Observability (R9/R10/R14) — one quick confirm:**
11. Ratify the trace-ID + alerting + canary bundle; confirm the **account-redirect canary** (the one that protects D55 from a silent Ghost auto-update).

*— Drafted 2026-06-09 in-session at Max depth, for review before live Session 4 (Extra). Next: you redline these proposals, then we run the live Session 4 triage in this same session to record dispositions into the §12 worksheet and any `D96+`. Next session after: Session 5 — Auth & input hardening.*
