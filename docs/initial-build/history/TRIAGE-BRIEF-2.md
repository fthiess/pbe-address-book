# PBE Address Book — Triage Brief 2: Read / cache / compute

The pre-session brief for **Triage Session 2** per [`TRIAGE-PLAN.md`](TRIAGE-PLAN.md) §5 — the hardest interdependency cluster in the suite. It proposes a disposition (a/b/c/d) and a fix sketch for the seven read-path findings — **S1, R3, S6, R2, R8, R6, S10** — all anchored on the in-memory-cache + brotli-memoization model (`ENGINEERING-DESIGN §1.5`/`§1.6`, D26/D75/D76) and Cloud Run's scale-to-zero behavior. Per the §10 workflow Forrest set on 2026-06-08, this brief is drafted **in-session**, immediately before the live triage that follows it.

> **Status:** Drafted 2026-06-09 at Max depth, before the live Session 2 (live · Extra). **Every disposition here is a proposal, not a decision.** The recording surfaces (the composite §12 worksheet; the eight delivered docs; `DECISIONS.md` `D82+`) stay untouched until you ratify live. Provisional `D##` numbers (D82–D87) are drafts to be finalized/renumbered in the resolution pass (TRIAGE-PLAN §6). Input: [`DESIGN-REVIEW-COMPOSITE.md`](DESIGN-REVIEW-COMPOSITE.md) findings **S1, S6, S10, R2, R3, R6, R8**, plus `ENGINEERING-DESIGN §1.5`/`§1.6` and `PRD §3.2` read in full.
>
> **✓ Ratified — Session 2 closed 2026-06-09.** All seven disposed **(a) fix** in the §12 worksheet, recording new decisions **D82–D87** (S6 amends D76, no new number). **One material change from the draft's recommendation:** on **R2** the editor chose a better option than the brief's "buy a warm instance" — **cap Cloud Run at `max-instances = 1` while keeping scale-to-zero** (**D83**): with at most one instance there is no second writer, so the single instance's self-updated cache is authoritative, the listener is demoted to a deploy-window safety net, and the fix costs **$0** rather than ≈$180/year. Because scale-to-zero is retained, cold starts stay common, which (a) makes **R8**'s snapshot pull-forward worthwhile (**D85** — a backend-internal **GCS** object holding the raw dataset + precomputed brother buffer, read once on cold start; **clients never read GCS directly**, profile data is always served through `/api/profiles`), (b) keeps **R3**'s brotli-11 by moving it off the event loop and **precomputing it on write into that snapshot** (**D84**; + debounce **and** an explicit batch-regenerate hook for bulk ops), and (c) **elevates R6** (persist/seed JWKS) from optional to load-bearing (**D87**). **S1** adopted the editor's refinement: only the **brother-role** buffer is cached; **managers/admins get a fresh per-request projection** (**D82**). The §1 proposals are preserved as drafted for the reasoning trail; the binding record is the §12 worksheet + D82–D87.
>
> **Session-0/1 outcomes consumed:** **R8's** Session-0 direction was "provisional pull-forward, final call in Session 2" — **this session makes that call.** **R2's** scale-to-zero-vs-`min-instances` decision was explicitly routed here by Session 0, and it is the *linchpin*: R8 and R6 both key off it. **D77** (no CCPA, but build-to-stricter minimization is policy) gives the S1 fix a privacy *bonus* worth noting. **D78** pinned the *Linter's Google* JWKS (issuer+audience+subject); R6/S10 below concern the *Ghost* JWKS on the sign-in path — a different endpoint, same hardening instincts.

---

## What Session 2 settles

This is where reasoning-chain truncation would hurt most, so the brief works the knot in full. Four moving parts, in dependency order:

1. **The projection–compression knot (S1 · R3 · S6).** The headline blocker `S1` — a single memoized compressed buffer serves the first post-write caller's privacy projection to *everyone* — cannot be fixed without simultaneously deciding `R3` (the brotli-11 cost model that the leak's fix would otherwise collapse) and `S6` (the role-blind ETag, same root cause). The composite says three times to triage these as one. They resolve together and cleanly.
2. **The linchpin (R2).** Whether the background snapshot listener actually stays alive on scale-to-zero Cloud Run. This is a genuine **money-vs-architecture** judgment call, and it **scopes R8 and R6** — so it is the second thing to settle, right after the knot.
3. **Cold-start resilience under R2's choice (R8 · R6).** The denormalized-snapshot pull-forward and the JWKS cold-start outage are both worth more if scale-to-zero is kept, and worth less if a warm instance is bought.
4. **Abuse controls (S10).** Mostly ratify; its two sharp facets (the brotli amplifier, the unknown-`kid` JWKS lever) are already neutralized by the R3 and R6 fixes, leaving standard throttling.

**Net effort:** one big judgment call (R2), two engineering forks (R3's compression strategy, R8's contingent pull-forward), and four ratify-a-proposal items (S1 — important but technically determined — plus S6, R6, S10).

| # | Finding · sev | Proposed disposition | The call that is yours |
|---|---|---|---|
| S1 | `blocker` | **(a) fix** — split the read: a uniform **per-role** "all records" payload (memoized, ≈6 buffers) **+** the caller's own full record via a separate self-fetch; add a cross-caller isolation test · **D82** | Ratify the read-split, incl. the small API-shape change (a self-record endpoint) |
| R3 | `blocker` | **(a) fix** — move brotli **off the event loop** (async/threadpool compress on invalidation, single-flight, debounce); level 11 stays affordable once non-blocking · **D84** (amends D75) | **Fork:** background-compress at level 11 *(rec)* vs. drop to brotli ~5–6 inline |
| S6 | `should-fix` | **(a) fix** — key the ETag by **role + a `users`/role-version**, so a demotion invalidates immediately; falls out of S1 · amends **D76** | Ratify (mechanical once S1 lands) |
| R2 | `blocker` | **(a) fix** — **`min-instances ≥ 1` + CPU-always-allocated** (warm listener) **and** a listener-health watchdog + staleness alert regardless · **D83** (amends D26) | **The big call:** buy a warm instance *(rec)* vs. keep scale-to-zero and re-architect freshness off the request path |
| R8 | `should-fix` | **(a) pull-forward** the denormalized snapshot · **D85** (promotes `PRD §3.2`) — *lean, contingent on R2* | **Contingent call (routed here from S0):** pull forward *(rec — helps burst cold-starts right after a newsletter send)* vs. keep deferred |
| R6 | `should-fix` | **(a) fix** — persist/seed JWKS across cold starts; single-flight + cap unknown-`kid` refetch | Ratify; note it's the *Ghost* JWKS (distinct from D78's *Google* one) |
| S10 | `should-fix` | **(a) fix** — rate-limit auth/writes/bulk read; single-flight JWKS (shared w/ R6); debounce compression (shared w/ R3) · **D86** (policy) | Ratify; most of it folds into R3 + R6 |

---

## §1 · The projection–compression knot — S1 · R3 · S6

### S1 — One memoized buffer serves every caller the first caller's projection · `blocker`

**What it is.** `D75` memoizes *one* brotli/gzip buffer of the projected `/api/profiles` payload, keyed only by encoding (`br`/`gzip`), "invalidated on write … amortized over every download until the next write." But the projection is **owner-aware** (`D5`/`D19`/`D44`, `§1.4`/`§2.4`): each caller sees **their own record in full** (values behind their own off-toggles, but never their own `adminNote`) **plus every other record projected to the caller's role and that record's flags**. So the correct payload genuinely differs **per user**, not merely per role. A buffer distinguished only by encoding therefore serves *the first post-write GET's projection to everyone after it*: if an admin or manager is the first request after any write, every brother who downloads next receives admin/manager data — hidden contact values, restricted flags, `adminNote`. This is the most serious security finding in the entire review, and it is consistent with the literal text of D75 (which says "*the* cached compressed buffer," with no caller/role key).

**Why the obvious fix is a trap.** The tempting fix — key the cache by full projection identity (role **and** caller id) — produces ~700 distinct buffers, each compressed once with slow brotli-11 and downloaded perhaps once or twice. That **collapses D75's entire economic rationale** (one slow compression amortized over many downloads) and turns brotli-11 into pure cost — which is exactly the thread that ties S1 to R3. We must not fix the leak by detonating the compression model.

**The fix that resolves all three findings.** The per-*user*-ness comes entirely from one component: "your own record in full." Factor it out:

- **Bulk payload → uniform per-role.** Serve *every* record projected to the caller's **role** (including a plain role-projection of the caller themselves — which leaks nothing, since it's just the role view). This buffer is now **identical for all callers of the same role**, so memoization is correct and the amortization survives: **3 roles × 2 encodings = ≈6 buffers** (Brother / Manager / Administrator × br/gzip), each downloaded by many same-role callers.
- **Own record → a separate self-fetch.** Deliver the caller's own full record (off-toggle values included, `adminNote` excluded) via `GET /api/me` (or a small self-record endpoint); the SPA overlays it on the role-projected row. One tiny record, projected per request, no bulk buffer needed.
- **Test.** Add the cross-caller buffer-isolation assertion the `§6.6` plan is currently missing ("no two callers receive each other's projection"), alongside the existing exhaustive per-role projection tests.

This **preserves every credited strength** (composite §9, TRIAGE-PLAN principle 6): server-side projection stays the single enforcement point — it gets *cleaner*; `private, no-cache` (D76) is untouched; the three-collection split is untouched. It even earns a **privacy bonus under D77**: the bulk payload no longer carries anyone's own-private values at all, so the largest response in the app is strictly a role projection of others — easier to reason about, easier to test, less to leak.

**Proposed disposition — (a) fix, foundational.**

> **Provisional D82 — The bulk read is split: `GET /api/profiles` returns a uniform per-role projection of *all* records (memoized per role × encoding, ≈6 buffers); the caller's own full record is delivered by a separate self-fetch and overlaid client-side.** Records to `ENGINEERING-DESIGN §1.4`/`§1.6`/`§2.4`, `API-SPEC §1`, `DATABASE-SCHEMA §9`, and the `§6.6` test plan (add cross-caller isolation).

> **Your call (S1):** ratify the read-split. The only non-mechanical part is accepting the **API-shape change** — a self-record fetch (`/api/me`) the SPA overlays. (Recommended; it's the fix that makes the leak *and* R3 *and* S6 resolve coherently.)

### R3 — Synchronous brotli-11 on the request thread · `blocker`

**What it is.** The first `GET /api/profiles` after any write (or cold start) pays a full-dataset **brotli level 11** compression *synchronously on the single-threaded Node event loop*. D75 chose level 11 deliberately "because the one compression is amortized over every subsequent download." The cost: the unlucky cache-miss caller eats a latency spike (possibly tripping a gateway timeout), and a brother editing repeatedly drives constant invalidate→recompress cycles that block the event loop for **all** users — a low-privilege CPU DoS. Reviewer B rated it a blocker; A a perf question; the composite takes the max.

**Why it's independent of the instance-count decision.** Even with a permanently warm instance (R2 below), *every write* still invalidates the buffer and the next request recompresses. So R3 must be fixed on its own merits regardless of R2.

**The fix — take compression off the event loop.** Node's `zlib.brotliCompress` has an **async variant that runs on the libuv threadpool**, not the event loop. So: on cache invalidation, kick off async (threadpool) compression of each role buffer and **swap it in atomically when ready**; a request arriving in the gap **awaits the in-flight compression promise** (single-flight) rather than launching its own — which also *is* the debounce S10 wants. The event loop never blocks; concurrent requests stay responsive; a burst of writes coalesces into one recompression. With compression off the request path, **level 11 stays affordable** — the amortization argument (now per role buffer, per D82) holds, and the only objection to level 11 (the latency spike) is gone.

**The one fork I can't just look up.** Two defensible strategies:

- **(i) Background-compress at level 11 (recommended).** Async threadpool + single-flight + debounce, level 11 kept. Best bytes-on-the-wire for the slow cohort (the product's north star), at the cost of a little machinery (the "serve the awaited in-flight buffer" window). Idiomatic Node; not over-engineering at this scale.
- **(ii) Drop to brotli ~5–6, inline.** Simpler — no background-swap machinery — and a mid-level brotli at ~2,000 records of repeated keys is fast enough to not meaningfully block. Costs some compression ratio (a few percent more bytes to slow links), which slightly cuts against D73–D76's whole reason for being.

I lean **(i)**: the audience is the reason brotli-11 exists, and moving it to the threadpool removes its only real downside. But (ii) is a legitimate "less code" choice if you'd rather not manage the in-flight-buffer window. Either way: **debounce rebuilds during edit bursts, and bound + measure compression time at 2,000 records as a Phase-7 performance gate** (CODING-PROJECT-PLAN).

**Proposed disposition — (a) fix.**

> **Provisional D84 — `/api/profiles` compression moves off the request path: async (threadpool) brotli on cache invalidation, single-flight + debounced, buffer swapped in atomically; the chosen level [11 background / ~5–6 inline] is bounded by a Phase-7 perf gate.** Amends `D75`/`§1.6`.

> **Your call (R3):** **background-compress at level 11 (recommended), or drop to brotli ~5–6 inline?**

### S6 — The bulk ETag ignores role, so a demotion keeps serving cached privilege · `should-fix`

**What it is.** The `/api/profiles` ETag is derived solely from the dataset's Firestore `updateTime` (`D76`), so it's identical for every caller and role. Two consequences: **(a)** a role change is a write to the `users` collection, **not** `profiles`, so it does **not** move `updateTime` — a just-demoted manager/admin who reloads gets `304 Not Modified` and keeps serving the browser-cached *higher-privilege* payload until some unrelated `profiles` write happens to occur; **(b)** with identical ETags across roles, only `Cache-Control: private` separates the projections — a thin margin for the app's most sensitive response.

**Why it falls out of S1.** Same root cause: the cache key omits the projection identity. Once D82 makes buffers per-role, finish the job on the freshness token: derive the ETag from **(role / a role-version or the caller's `users` updateTime) + the dataset updateTime**, so the token changes the instant authorization changes and a downgrade immediately invalidates the cached payload.

**Proposed disposition — (a) fix.** Mechanical once S1 is accepted; no separate `D##` — it amends **D76** alongside D82.

> **Your call (S6):** ratify (it's the same keying fix as S1, applied to the ETag).

---

## §2 · The linchpin — R2 · `blocker`

**What it is.** `D26` claims each instance's cache is kept fresh by a background **Firestore snapshot listener** and is therefore "self-healing and correct at any instance count." But Cloud Run **throttles instance CPU to ~zero between requests** unless "CPU always allocated" is set — so a purely-background listener may not process change events (or may silently drop on a network reset and never resume) while no request is in flight. And because `GET /api/profiles` is served **only from cache** (zero Firestore reads) **and** its ETag is derived from that same cache, a stalled listener serves stale data **and 304-confirms it as current** — the read path can never self-correct, and nothing alerts. Both reviewers flagged it a blocker; the "stale-but-304-confirmed" framing is the sharpest version: the cache and its own freshness token share a single point of failure. This is the suite's most important *un-addressed operational assumption*, and Session 0 deliberately routed the decision here.

**This is genuinely your call — money vs. architecture.** Two coherent target architectures:

- **Option A — buy a warm instance (recommended).** Set **`min-instances ≥ 1` with CPU-always-allocated.** The listener now runs continuously on the warm instance, restoring D26's coherence model for the common case. Cost: a **small, bounded, continuous** charge for one always-on small instance — it ends *free-tier-only* economics, but at Book's scale (≈700 living brothers, ~2,000 docs, bursty bi-annual traffic) it's a modest monthly figure. What it *buys*: it directly **mitigates R2, R6 (warm JWKS), and the R8 cold-start spike** at once, and it hands the slow-connection cohort a **warm instance on the common path** — the highest-leverage "spend a little to delete a class of distributed-coherence bugs" move available, and a good fit for a solo-maintained, correctness-critical directory.
- **Option B — keep scale-to-zero, re-architect freshness.** Stay at `$0` but stop trusting a purely-background listener: drive cache revalidation **from the request path** (or a scheduled ping), with the ETag derived from an authority the cache is *checked against* (e.g. the denormalized snapshot's version, R8) rather than from the possibly-stale cache itself — which is what breaks the "304-confirms-stale" trap. More moving parts, and it makes R6 (cold-start JWKS) and R8 (cold-start reads) load-bearing rather than optional.

**A warm instance does not fully escape the listener model** — a traffic burst still spins additional cold instances whose listeners could stall — so **both options need the same safety net**, which we add regardless: a **listener-health watchdog** (last-event timestamp / resume-token; fail the readiness probe and shed a stale instance), a **metric + alert on listener disconnects and cache age** (feeds R10), and **hydrate from the listener's initial snapshot** to close the read-then-subscribe gap. The warm instance reduces the *frequency* of the hazard; the watchdog handles the residual.

**Proposed disposition — (a) fix, foundational.**

> **Provisional D83 — Book runs `min-instances ≥ 1` with CPU-always-allocated so the snapshot listener stays live on the common path; a listener-health watchdog (resume-token / last-event age) fails readiness and sheds stale instances, with an alert on listener disconnect and cache age.** Amends `D26`'s "correct at any instance count" claim. Records to `ENGINEERING-DESIGN §1.5`, `§6.1` (alerting).

> **Your call (R2):** **buy a warm instance (`min-instances ≥ 1` + CPU-always-allocated; recommended), or keep scale-to-zero and revalidate off the request path?** This choice scopes R8 and R6 below — settle it before them. The watchdog + alert are proposed *either way*.

---

## §3 · Cold-start resilience, scoped by R2 — R8 · R6

### R8 — Cold starts re-read ~2,000 docs and run brotli cold · `should-fix`

**What it is.** Under scale-to-zero, bursty alumni traffic cold-starts often; each cold start reads all ~2,000 profile docs and the first `GET /profiles` pays a full brotli-11 on a possibly CPU-throttled instance — adding seconds precisely for the slow-connection cohort the product bends over backwards for, and multiplying per-instance memory at 10×. The recommended mitigation is **already a recorded deferral**: `PRD §3.2`'s "single denormalized 'all-profiles' snapshot (one Firestore doc or GCS object), regenerated on write, read on cold start in place of ~2,000 individual reads — collapsing cold-start reads from ~2,000 to one." Session 0 set a provisional "pull forward" lean and routed the firm call here.

**The honest contingent read.** With **R2 = Option A (warm instance)**, the *common* path never cold-starts, so the snapshot's value drops — *but it does not vanish*. A traffic **burst right after a newsletter send** — the product's single worst-case-latency moment, and exactly when slow-cohort brothers click through — spins **additional** cold instances, each of which would otherwise read 2,000 docs + hydrate + compress before serving its first visitor. The snapshot makes each of those cold starts **one read**, cutting burst-time first-byte latency for the slow cohort and giving 10× headroom. It's already designed, cheap, and has no user-facing surface.

So I **lean (a) pull-forward** even under Option A — it's cheap insurance aimed squarely at the cohort, at the moment that matters most. It's fully defensible to **keep it deferred (c)** instead, on the grounds that a warm instance makes cold starts rare and the snapshot is trivially pull-forward-able later if Firestore read cost or cold-start frequency ever bites. Under **R2 = Option B (scale-to-zero)** the snapshot becomes **load-bearing** and pull-forward is the clear answer.

**Proposed disposition — (a) pull-forward (lean), contingent on R2.**

> **Provisional D85 — The denormalized all-profiles snapshot (one Firestore doc or GCS object, regenerated on write) is pulled into MVP as the cold-start read source, collapsing cold-start reads from ~2,000 to one.** Promotes the `PRD §3.2` deferral; records to `ENGINEERING-DESIGN §1.5`. *(If R2 = Option A and you prefer minimal MVP scope, this stays (c) deferred.)*

> **Your call (R8):** **pull the snapshot forward (recommended), or keep it deferred?** — keyed to your R2 choice.

### R6 — Sign-in availability is coupled to JWKS with no fallback · `should-fix`

**What it is.** JWT verification needs Ghost's JWKS, cached **in-memory only**; a freshly cold-started instance with an empty cache can't verify *any* login until it fetches JWKS — so if Ghost/JWKS is unreachable at that moment, **all sign-ins fail**. Separately, "refresh on an unknown `kid`" lets an attacker force repeated outbound JWKS refetches (the lever S10 also names).

**Fix (standard hardening; priority scales with R2).** **Persist/seed the JWKS** (or pin keys) so verification survives a cold start during a Ghost blip, with a short grace window on last-known-good keys; **single-flight and cap** unknown-`kid` refetches. Under **R2 = Option A** the warm instance keeps JWKS hot, so this is belt-and-suspenders for the rare cold start/deploy; under **Option B** it's load-bearing (cold starts are frequent). Note this is the **Ghost** JWKS on the sign-in path — distinct endpoint from **D78**'s *Google* JWKS for the Linter, but the same single-flight/cap discipline should cover both.

**Proposed disposition — (a) fix.** Hardens `ENGINEERING-DESIGN §2.7`; no new `D##` unless you want the persistence recorded as a decision (likely yes if R2 = Option B). 

> **Your call (R6):** ratify the persist-JWKS + single-flight fix.

---

## §4 · Abuse controls — S10 · `should-fix`

**What it is.** No endpoint defines throttling anywhere in the suite. Three concrete amplifiers: **(a)** a brother loops `PATCH`-own-profile (invalidates the buffer) → `GET /api/profiles` (forces a full brotli-11 recompression) to burn CPU — a low-privilege DoS; **(b)** unknown-`kid` tokens force repeated JWKS refetches; **(c)** `POST /api/auth/session` does unauthenticated crypto work. Alerting on denial bursts (§6.1) detects but doesn't prevent.

**Why most of it is already handled.** Amplifier **(a)** is **neutralized by D84** — once compression is off the event loop, single-flighted, and debounced, a write-loop coalesces into one background recompression instead of melting the request thread. Amplifier **(b)** is **handled by the R6 fix** (single-flight + cap unknown-`kid`). That leaves the standard, un-controversial work: **rate limits / concurrency caps on auth, writes, and the bulk read**, and the unauthenticated-crypto cap on `/api/auth/session`.

**Proposed disposition — (a) fix.** Records the rate-limiting *policy* (new — nothing exists today).

> **Provisional D86 — Rate limits / concurrency caps are applied to auth, writes, and the bulk read; unknown-`kid` JWKS refetch is single-flighted and capped; compression rebuilds are debounced.** Records to `ENGINEERING-DESIGN §2.7`, `§6.1`; the brotli-amplifier and JWKS facets cross-reference D84 and R6.

> **Your call (S10):** ratify; confirm you're happy treating the compression and JWKS amplifiers as resolved by D84 + R6 (so S10 adds only the throttling policy).

---

## Recording surfaces (per TRIAGE-PLAN principle 4)

Per principle 5, the actual doc edits happen in the concentrated propagation phase (TRIAGE-PLAN §6), not now; the worksheet + any inline `D##` are recorded as each is ratified.

| Item | Worksheet (§12) | Delivered docs | `DECISIONS.md` |
|---|---|---|---|
| S1 | (a) fix | `ENGINEERING-DESIGN §1.4`/`§1.6`/`§2.4`, `API-SPEC §1`, `DATABASE-SCHEMA §9`, `§6.6` | **D82** |
| R3 | (a) fix | `ENGINEERING-DESIGN §1.6` | **D84** (amends D75) |
| S6 | (a) fix | `ENGINEERING-DESIGN §1.6`, `API-SPEC §1.4` | amend **D76** (no new #) |
| R2 | (a) fix | `ENGINEERING-DESIGN §1.5`, `§6.1` | **D83** (amends D26) |
| R8 | (a) pull-forward *(or (c) defer)* | `ENGINEERING-DESIGN §1.5`, `PRD §3.2` | **D85** (if pulled forward) |
| R6 | (a) fix | `ENGINEERING-DESIGN §2.7` | new # only if R2 = Option B |
| S10 | (a) fix | `ENGINEERING-DESIGN §2.7`, `§6.1` | **D86** (policy) |

`D82`–`D86` are provisional drafts; the resolution pass (TRIAGE-PLAN §6) finalizes and renumbers.

---

## The questions, consolidated

Four items are ratify-and-move-on (S1 — important but technically determined; S6; R6; S10). These are what I actually need from you, in decision order:

1. **R2 (the linchpin — settle first):** buy a warm instance (`min-instances ≥ 1` + CPU-always-allocated; **recommended**) or keep scale-to-zero and revalidate off the request path? (Watchdog + staleness alert proposed either way.)
2. **R8 (keyed to #1):** pull the denormalized snapshot forward (**recommended** — it's the burst-cold-start fix for the slow cohort right after a newsletter send), or keep it deferred?
3. **R3:** background-compress at brotli level 11 (**recommended**), or drop to brotli ~5–6 inline?
4. **S1:** ratify the read-split — uniform per-role bulk payload + a separate self-record fetch the SPA overlays — including the small API-shape change.

*— Drafted 2026-06-09 in-session for review before live Session 2; ratified the same day. Dispositions recorded in the §12 worksheet; D82–D87 in `DECISIONS.md`. Next: Session 3 — Privacy / consent / egress.*
