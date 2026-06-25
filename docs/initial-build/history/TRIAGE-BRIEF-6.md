# PBE Address Book — Triage Brief 6: UI / a11y + leftovers

The pre-session brief for **Triage Session 6** per [`TRIAGE-PLAN.md`](TRIAGE-PLAN.md) §5 — the **UI / accessibility + leftovers** cluster, and the last triage sitting before the resolution/propagation pass. It proposes a disposition (a/b/c/d) and a fix sketch for the eight findings assigned here — **U2, U3, U4, U5, U7, C9, C15, R18**. Per the §10 workflow you set on 2026-06-08, this brief is drafted **in-session**, immediately before the live triage that follows it.

> **Status:** Drafted 2026-06-11 at **High** depth (TRIAGE-PLAN §7), before the live Session 6 (live · **Medium**). **Every disposition here is a proposal, not a decision.** The recording surfaces (the composite §12 worksheet; the eight delivered docs; `DECISIONS.md` `D109+`) stay untouched until you ratify live. Provisional `D##` numbers (**D109–D113**) are drafts to be finalized/renumbered in the resolution pass (TRIAGE-PLAN §6). Input: [`DESIGN-REVIEW-COMPOSITE.md`](DESIGN-REVIEW-COMPOSITE.md) findings **U2, U3, U4, U5, U7, C9, C15, R18**, plus `DECISIONS.md` **D20, D22, D23, D24, D25, D31, D32, D35, D44, D45, D50, D51, D52, D53, D58, D63, D67, D68, D73, D74, D76** and the triage decisions **D95** (the sign-out control that already resolves U4) and **D107** (the CSP/`frame-ancestors` from Session 5, which constrains U3's re-auth mechanism) read in full. The `CODING-PROJECT-PLAN.md` phase map was re-read to confirm U2's sequencing claim.
>
> **This is the small, high-ratify tail TRIAGE-PLAN §5 predicted — with one genuine values fork (U7) and one real design gap that needs a UX contract decided, not just ratified (U3).** Five of the eight are clean (a)-fixes or documentation statements; one (U4) was already resolved early in Session 3 and only needs confirming here. But §5 also warns the a11y items "carry weight beyond their severity" because **accessibility is hard project policy (D32/D67)** — so U2, U5, and U7 get the deliberate treatment a `should-fix` would not otherwise earn. Two of the eight turn out to be **two views of the same event**: U3 (a save XHR returns `401`) and R18 (an image GET returns `403`) are both the **4-hour session cap lapsing while the tab is open** — so they get one decision, not two.
>
> **Strengths this session must not dismantle (composite §9 / TRIAGE-PLAN principle 6):** the **412 reconcile that preserves unsaved edits** (D25 — U3 must extend that "never lose the user's work" instinct to the `401` path, not contradict it); the **no-store, in-memory-only PII posture** (D95 — both U3's recovery stash *and* U5's IndexedDB memo must respect it, or they quietly re-introduce the on-disk PII residue D95 just removed); the **deliberate state-both-consequences consent nudge** (D45 — U7's whole tension is whether a calmer mobile UI is worth softening it); the **concrete, testable a11y standard** (D67's axe-core + contrast gate + manual checklist — U2/U5 extend its coverage, they don't relax it).

---

## What Session 6 settles

The composite filed these under three headers (`U` UI/a11y, `C` cross-cutting, one `R` minor), but the actual work sorts cleanly by *how much of your judgment each needs*:

1. **The one genuine values fork (1).** **U7** — the privacy switches state *both* consequences of a toggle in plain text; seven of them stacked on a phone is the scrolling-fatigue clutter Reviewer B flagged against the design's own "calm resting interface" goal. The fix Reviewer B proposes (concise label at rest, verbose copy into the already-built `?` toggle-tip) is *component-compatible* — D53 already provides exactly that popover. So this is **not** "is the design wrong," it is **"does moving the consequence-copy into a tap weaken D45's informed-consent nudge?"** — a presentation trade-off between two stated goals, and the §10 decision-tension for this session. Yours to weigh.

2. **The one real design gap needing a UX contract (1).** **U3** — a `401` during an in-progress Save (the 4-hour cap lapsing mid-edit) is unspecified, and a naïve hard redirect would discard the user's unsaved form. This isn't a stale-ref or a missing ARIA attribute; it's a **missing behavior** for an app that explicitly courts long, abandonable edit sessions. The disposition is **(a) fix**, but the *fix* is a UX-contract + mechanism decision, lightly yours: what the user sees, and how re-auth happens without destroying the form (or D95's no-disk-PII posture). **R18 is the same expiry event** on the image path and folds in.

3. **Already resolved — confirm only (1).** **U4** — "there is no logout control." Session 3's **D95** already added a Sign-out control (reversing D24's "no logout") as a side-decision while solving P11. Session 6 just **confirms** it; nothing new to decide.

4. **Clean (a) fixes / documentation statements — ratify (4).** **U5** move the phonetic + Fuse index build off the main thread into a **Web Worker** (and drop the IndexedDB memo, per D95). **U2** split in-page help into the **AA-baseline layer that ships with each page** vs. the enriched toggle-tips + manual that stay in Phase 6 — closing the hidden inter-phase dependency along the WCAG line. **C9** add a **contract-version** mechanism on `/api/roster` + a **stale-SPA refresh prompt**. **C15** simply **state the known limitation** that no-email brothers are staff-maintained and cannot self-serve.

**Net effort:** make the **U7** call (soften the nudge for mobile calm, or keep D45 intact), decide **U3**'s recovery contract, **confirm U4/D95**, and ratify four near-obvious items. No `(c)`/`(d)` escapes; U7 is the only candidate for `(b)`.

| # | Finding · sev | Proposed disposition | The call that is yours |
|---|---|---|---|
| **U7** | Seven verbose two-consequence toggles clutter mobile vs the "calm" goal · `should-fix` | **The fork** — (a) soften: active-side consequence inline + full both-sides copy in the D53 `?` toggle-tip, *or* (b) keep D45 as-is · **D113 if (a)** | **The session's main fork:** does moving the counterfactual into a tap weaken D45's informed-consent nudge enough to refuse it? (Recommended: the inline-active-side compromise.) |
| **U3** | `401` mid-save discards unsaved form data; recovery path unspecified · `should-fix` | **(a) fix** — non-destructive: detect the `401`, **preserve the in-progress form**, re-auth **without destroying the editor tab**, resume the Save; never a blind `window.location` redirect mid-edit · **D109** (with R18) | The UX contract + re-auth mechanism: popup/child-window handoff (preserves the in-memory form, no stash) vs. a `sessionStorage` draft stash — and whether the stash is acceptable under D95's no-disk-PII posture |
| **R18** | CDN signed-cookie expiry mid-session breaks images (`403`) until re-auth · `minor` | **(a) fix** — same expiry event as U3; on image `403`, trigger the same silent re-auth + retry the load rather than show broken images · folded into **D109** | Ratify; confirm it's the same cap-lapse handler, not a second mechanism |
| **U4** | There is no logout control · `should-fix` | **(a) fix — already resolved (D95)** — Sign-out control added Session 3 (Ghost-style avatar menu, top-right; clears the Book session, may emit `Clear-Site-Data`); reverses D24 · **D95 (existing)** | Confirm only |
| **U5** | Phonetic + Fuse index built synchronously on the main thread → jank on older hardware · `should-fix` | **(a) fix** — build the Fuse index + talisman phonetic codes in a **Web Worker**; render the grid immediately, enable fuzzy/phonetic search when the worker signals ready (exact/substring works meanwhile); **drop D35's IndexedDB memo** (on-disk PII residue, contra D95) · **D110** | Ratify; confirm dropping the IndexedDB memo in favor of recompute-in-worker |
| **U2** | In-page help wired Phase 6, but a11y-gated pages ship Phases 3–5 (hidden dependency) · `should-fix` | **(a) fix** — split help: **AA-baseline labels/instructions (WCAG 3.3.2) ship *with* each page** in its phase; the enriched `?` toggle-tips (≈3.3.5) + manual assembly stay Phase 6 · **D111** | Ratify the split-along-the-WCAG-line; confirm the per-phase a11y gate wording |
| **C9** | No API versioning / stale-SPA / Linter contract · `should-fix` | **(a) fix** — a lightweight **contract-version** on `/api/roster` (header or field) + a minimal deprecation note for the Linter (D58); a **client-version check** that prompts a stale SPA to refresh (non-blocking overlay) · **D112** | Ratify; confirm "version `/api/roster` + stale-SPA refresh prompt" is the right MVP scope (no full versioning scheme) |
| **C15** | No-email brothers can't self-serve; never stated · `question` | **(a) fix (documentation)** — state explicitly that no-email/unidentified brothers are **staff-maintained and cannot access Book themselves** (the corollary of D20's deny-and-contact-admin) · no `D##` | Ratify the wording lands in PRD limitations + USER-MANUAL |

---

## §1 · The session-expiry seam — U3, R18, and the U4 confirm

These three are one story about *what happens when the 4-hour cap (D22) lapses while the tab is open*. The cap is **absolute, not a sliding idle timeout** — D22 issues the session "with a 4-hour server-side expiry" precisely so "an always-open browser never re-auths" can't happen and a brother removed from Ghost loses access promptly. **That matters for U3:** because the cap is absolute, you *cannot* prevent the mid-edit lapse by silently renewing while the user types — a genuinely long edit will hit the 4-hour wall no matter what — so a **non-destructive recovery path is mandatory, not optional.** U4 (the sign-out control) is the deliberate counterpart — the user-initiated end of a session — and it's already built.

### U3 — A `401` during an in-progress save discards unsaved form data · `should-fix`

**What it is.** D25/§2.6 carefully preserve the user's unsaved edits on a **412** (a concurrency conflict — someone else changed the record underneath you: repull, keep edits, show a "these fields changed" notice, no auto-merge). But the **401** case sits in the gap right next to it and is unspecified: the 4-hour cookie lapses, the user clicks Save, the XHR returns `401`, and D22's "re-bounce through the bridge" — a full-page `window.location` redirect — would **destroy the unsaved form** on the way to re-auth. For an app whose whole Profile-edit model (D43) assumes long, interruptible sessions, silently losing a half-finished edit is exactly the failure the 412 design went out of its way to avoid. Reviewer B filed this as its headline reconstruction gap, flagged "critical."

**Why it's a real gap and not a ratify.** The other expiry behaviors are specified (D22 redirect on lapse; D25 412 preserve-and-reconcile); this specific intersection — *session lapse **during** an in-flight state-changing request* — falls between them and was never written down. The fix has to satisfy two constraints at once that pull against each other: **(1)** preserve the in-memory form (the D25 instinct), and **(2)** not write that form's PII to disk on a shared machine (the D95 instinct). The naïve "stash the draft in `localStorage` and redirect" violates (2); the naïve "redirect to re-auth" violates (1).

**The fix — (a), and the mechanism is the part that's yours.** The UX contract is the easy half and I'd propose it firmly: **detect the `401` on the Save (don't follow a redirect mid-XHR); keep the form exactly as the user left it; surface a non-destructive "Your session expired — sign in again to save" affordance; on successful re-auth, resume/re-submit the same Save** (carrying the original `If-Match` so a real 412 still reconciles via D25). The interesting half is *how re-auth happens without a full-page nav that nukes the form*:

- **Primary (recommended) — re-auth in a child window, editor tab untouched.** The `401` happens inside the user's Save click (a live user gesture), so opening a popup/child window to the Ghost bridge is permitted; the child completes the silent re-bounce and hands the new session back (`postMessage` / shared cookie on `book.pbe400.org`), then closes. The editor tab **never navigates**, so the in-memory form survives with **zero PII written to disk** — the cleanest reconciliation of constraints (1) and (2). *(Note: a hidden-iframe variant is foreclosed by D107's `frame-ancestors` — the Ghost portal won't frame — so it's a child *window*, not an iframe.)*
- **Fallback — `sessionStorage` draft stash.** If the popup is blocked and a full-page redirect is the only path, stash the draft in **`sessionStorage`** (tab-scoped, cleared on tab close — a much closer analog to D95's "in memory while the tab is open" than `localStorage`), redirect, and rehydrate + offer to resume on return. **This is the one place to check against D95:** `sessionStorage` is still PII briefly on the machine; it dies with the tab rather than persisting across browser-close, so it's defensible, but it's a conscious softening of "nothing on disk" and I'm flagging it rather than burying it.

**My lean:** ratify the non-destructive contract; adopt the **child-window handoff as primary** (no stash, no D95 tension), with the `sessionStorage` fallback documented as the explicit, bounded exception for popup-blocked browsers. This makes U3 a faithful extension of D25 rather than a contradiction of it.

### R18 — CDN signed-cookie expiry mid-session breaks images until re-auth · `minor`

**What it is.** D23 gives the CDN signed cookie a TTL **equal to the session** (4 hours), reissued with it. So at the very same 4-hour wall that triggers U3's `401`, image requests start returning `403` and headshots/thumbnails silently break until the next re-auth reissues the cookie. The SPA's behavior on an image `403` is unspecified, so the user just sees broken images. The reviewer also floated "reissue the CDN cookie slightly ahead of expiry while the session is active" — but since the CDN cookie's life is pinned to the absolute-capped session, there's nothing to reissue *into* past the 4-hour wall; the renew-ahead idea doesn't apply.

**The fix — (a), folded into U3.** This is **the same expiry event** seen on a different request type, so it gets the same handler: on an image `403`, the SPA triggers the same silent re-auth (child-window/re-bounce) and **retries the image load** once the session (and thus the reissued CDN cookie) is back — rather than rendering a broken `<img>`. One cap-lapse → one re-auth → both the pending Save and the failed image fetches resume. No separate mechanism.

### U4 — There is no logout control · `should-fix` — **already resolved (D95)**

**What it is / status.** Reviewer A flagged that the manual sells the 4-hour cap as shared-machine protection, yet a brother who walks away leaves the account open for up to 4 hours with no way to sign out. **This was already resolved in Session 3:** D95 (while solving P11's cache-residue problem) added a **Sign-out control** — a Ghost-style avatar menu, top-right — that clears the Book session and may emit `Clear-Site-Data`, explicitly **reversing D24's "no logout endpoint"** and noting it "resolves U4 ahead of Session 6." Nothing to redecide; this brief lists it only to **confirm** the disposition and keep the worksheet complete. The §12 worksheet already marks U4 `(a)` → D95.

> **Provisional D109 — Session-expiry recovery (U3 + R18): a session-cap lapse that surfaces mid-flight is handled non-destructively — a `401` on a Save preserves the in-progress form, re-auths *without* navigating the editor tab away (child-window bridge handoff; `sessionStorage` draft only as a popup-blocked fallback), then resumes the Save carrying its original `If-Match`; an image `403` triggers the same re-auth and retries the load rather than showing a broken image. Extends D25's preserve-unsaved-edits instinct to the `401` path and respects D95's no-disk-PII posture.** Records to `ENGINEERING-DESIGN §2.3`/`§2.5`/`§2.6`, `API-SPEC §1.2`; cites D22, D23, D25, D95, D107.
>
> **Your call (U3/R18):** ratify the non-destructive contract; pick the re-auth mechanism (child-window handoff recommended) and confirm whether the `sessionStorage` fallback is acceptable given D95. *(U4 = confirm D95, no new decision.)*

---

## §2 · Accessibility-weighted UI — U5, U2, and the U7 fork

Accessibility is hard project policy here (D32/D67), so these three get more than their `should-fix` severities would otherwise buy. U5 and U2 are clean (a)-fixes that *extend* the a11y posture; U7 is the one place a UI-calmness goal pulls against a deliberate consent design, and it's your fork.

### U5 — Phonetic + Fuse index built synchronously on the main thread → jank · `should-fix`

**What it is.** D35 computes Double-Metaphone (or Beider-Morse) codes for ~2,000 profiles × multiple name fields and builds the Fuse.js index **at load, on the browser's main thread**. D74 code-*splits* the talisman libraries (deferring their *download*) but nothing moves the *computation* off the main thread — so SPA init will block and jank the UI, worst exactly for the older-hardware/slow-connection cohort the rest of the design (D73–D76) bends over backwards to serve. Reviewer B caught this; it pairs directly with the audience constraint.

**The fix — clean (a), with one cross-link to D95.** Move the Fuse index build + talisman phonetic-code generation into a **Web Worker**: render the directory grid immediately, run **exact/substring matching on the main thread meanwhile** (instant, no index needed), and **enable fuzzy + phonetic search when the worker posts back "index ready"** — progressive enhancement, the grid is never blocked. The dataset reaches the worker by `postMessage` (structured clone of the already-in-memory profiles — fine). **The one decision beyond "yes, use a worker":** D35's noted escape hatch is an **IndexedDB memo** of the computed codes — but that **writes name-derived PII to disk**, re-introducing exactly the shared-machine residue **D95** just eliminated for `/api/profiles`. So I'd **drop the IndexedDB memo** and recompute in the worker each load; off the main thread the recompute is cheap and the no-disk-PII posture stays consistent end-to-end. (If load-time cost ever proves a real problem on the slowest hardware, a memo of *non-PII* derived artifacts could be revisited — but not name-keyed phonetic codes.)

> **Provisional D110 — Search indexing off the main thread (U5): the Fuse.js index and talisman phonetic codes are built in a Web Worker; the grid renders immediately with exact/substring search available, and fuzzy/phonetic search switches on when the worker signals ready. D35's IndexedDB memo is dropped (recompute-in-worker) to avoid writing name-derived PII to disk, consistent with D95.** Records to `ENGINEERING-DESIGN §6.x` (client architecture), `PRD §5.6.3`; amends D35 (computation moves to a worker; memo removed).
>
> **Your call (U5):** ratify the Web Worker; confirm dropping the IndexedDB memo in favor of recompute-in-worker.

### U2 — In-page help is Phase 6, but a11y-gated pages ship Phases 3–5 · `should-fix`

**What it is — and I confirmed it against the plan.** `CODING-PROJECT-PLAN` Phases 3, 4, 5 each ship a page (Directory / Profile / Admin) behind a gate that includes **"a11y checks pass on the page,"** while **all** help wiring — `aria-describedby` helper text, persistent labels, the Radix-Popover `?` toggle-tips, and the manual assembly — is parked in **Phase 6** (§7/§10 of the plan; D53). So either the Phase 3–5 a11y gates can't honestly pass (they're missing baseline labels/instructions), or help is really being built earlier than the plan says. A hidden inter-phase dependency, as Reviewer A flagged.

**The fix — clean (a), and it splits neatly along the WCAG line.** Help isn't one monolith; it straddles two conformance levels:
- **AA-baseline (WCAG 3.3.2 Labels or Instructions, and label-in-name / programmatic association):** persistent labels and any *instructions a control needs to be usable* are **AA** and load-bearing — these must **ship with each page in its own phase**, so the Phase 3–5 a11y gates are truthful.
- **Above-baseline enrichment (≈ WCAG 3.3.5 Help, which is AAA):** the richer `?` toggle-tip explanations and the assembled USER-MANUAL are a progressive-disclosure nicety — **legitimately Phase 6**, since the project targets AA (D67/U1→D79's 2.2 AA), not AAA.

So the resolution is to **split D53's help model by layer**: bind the AA-baseline labels/instructions into each page's phase (Phase 3/4/5), keep the toggle-tip enrichment + manual assembly in Phase 6, and **reword the per-phase a11y gate** to say it covers baseline labels/instructions (not the Phase-6 enrichment). This dissolves the dependency *precisely* rather than by hand-waving, and it keeps D53's "single help-content source, can't drift" intact — the source is authored once; the *baseline subset* is simply wired earlier. Mostly a `CODING-PROJECT-PLAN` edit plus a clarifying note on D53/D67.

> **Provisional D111 — Help phasing split along the WCAG line (U2): in-page help is delivered in two layers — AA-baseline labels/instructions (WCAG 3.3.2) ship *with* each page in Phases 3–5 so the per-phase a11y gates are honest; the enriched `?` toggle-tips (≈3.3.5) and the manual assembly stay in Phase 6. The single help-content source (D53) is unchanged; only the wiring schedule and the gate wording are refined.** Records to `CODING-PROJECT-PLAN §7`/`§10` and the phase gates; clarifies D53/D67.
>
> **Your call (U2):** ratify the split and the reworded per-phase gate (baseline-with-page, enrichment Phase 6).

### U7 — Seven verbose two-consequence toggles clutter mobile vs the "calm" goal · `should-fix` — **the fork**

**What it is.** D45 renders every privacy/consent switch as a two-position control that **states the concrete consequence of *each* side in plain language** ("Brothers can reach you by email" ↔ "Brothers cannot reach you by email"). With the toggle set now at **seven** (four share toggles + three consent flags, after D56's `allowCommentReplyEmail` and D93's `shareSpousePartner`), stacking seven *both-sentences-shown* switches on a phone is real scrolling-fatigue and cognitive load — working against the design's own "calm resting interface" goal, and against an elderly audience. Reviewer B proposes: concise standard label at rest ("Share email"), move the verbose both-consequences copy into the **already-designed `?` toggle-tip** (D53).

**Why this is a fork and not a ratify.** D45 is a *deliberate* choice you made for a specific reason that recurs in your own experience: it's an ethical, anti-dark-pattern nudge (Thaler & Sunstein), where **stating both consequences in plain text makes any opt-out "an informed, considered act rather than an inattentive click"** — and it was chosen explicitly to cure the **MITAA failure mode** you've cited repeatedly (a single ambiguous "no emails" opt-out that silently swept PBE in, misread by a third of brothers). So the reviewer's fix isn't free: collapsing to "Share email" + tooltip is the *exact pattern* D45 set out to avoid (a terse label whose consequence is hidden behind a tap most people won't take). That said — the components don't fight the fix: D53 *already* provides the toggle-tip popover, so the question is purely **how much consequence-copy stays visible at rest**, and that's a values call between two of your own stated goals (informed-consent clarity vs. calm, low-fatigue UI). It's the §10 decision-tension for this session.

**The three honest options:**
- **(b) Keep D45 fully** — both consequences inline on all seven. Maximum informed-consent fidelity; accept the mobile scroll. Defensible given how strongly the MITAA lesson cuts for you.
- **(a) Adopt B fully** — concise labels, all consequence-copy into the `?` tip. Calmest UI; weakest nudge (closest to the pattern D45 rejected).
- **(a, recommended) The middle path — show the *active-side* consequence inline, put the *counterfactual* in the tip.** A two-position switch already shows which side is active; render **only the currently-true consequence in plain language** ("Brothers can reach you by email") and move the *opposite-state* sentence into the `?` toggle-tip. This **roughly halves the at-rest text per toggle** (one sentence, not two) and cuts the seven-in-a-row scroll, while **preserving D45's core**: the label still *names exactly what this controls* in plain language (not a terse "Share email"), and flipping it still shows a plain consequence — so an opt-out stays an informed act, just not a double-sentence one. Pair with light grouping/disclosure of the seven so they don't read as an undifferentiated wall. This honors the MITAA lesson (no ambiguous terse label) while answering the calm-UI concern.

**My lean:** the **middle path (a)** — it's the smallest move that resolves the real mobile-clutter complaint without reverting to the hidden-consequence pattern D45 was built to prevent. But this is genuinely yours: if you judge that *both* sentences visible is load-bearing for informed consent given the MITAA history, **(b) keep D45** is a perfectly principled answer and I'll record it as as-designed with that reason.

> **Provisional D113 (only if (a)) — Privacy-toggle copy for mobile calm (U7): each switch shows the *currently-true* consequence inline in plain language and houses the opposite-state consequence in the D53 `?` toggle-tip, halving at-rest text while keeping each control's effect named in plain language (preserving D45's informed-consent nudge and its MITAA-failure cure); the seven toggles get light grouping to reduce the mobile wall. Amends D45 (presentation only; stored booleans and open defaults unchanged).** Records to `PRD §5.7.3`, `ENGINEERING-DESIGN` (Profile UI), and amends D45. *If you choose **(b)**, no `D##` — recorded in the worksheet as as-designed: both consequences stay inline as a deliberate informed-consent measure.*
>
> **Your call (U7 — the session's fork):** keep D45 intact (b), adopt the concise-label-+-tooltip fully (a), or take the active-side-inline middle path (a, recommended)?

---

## §3 · Contract & limitation leftovers — C9, C15

The two non-UI leftovers: one missing capability (contract versioning) and one unstated-but-true limitation.

### C9 — No API versioning / stale-SPA / Linter contract · `should-fix`

**What it is.** Two facets of one missing capability (contract evolution), caught by both reviewers:
- **The Linter contract (A).** The **Linter** (D58) is an independently-deployed, *different-language* consumer of `/api/roster`. Any shape change to that response breaks it silently — there's no version namespace and no deprecation policy. D58 deliberately made the Linter runtime-independent but assumed a stable roster contract.
- **The stale-SPA tab (B).** D73's content-hashed assets + no-cache HTML guarantee a *fresh* load is current, but a brother with the SPA open in a **background tab across a deploy/migration** can send now-malformed data or crash, with no mechanism to force a refresh.

**The fix — clean (a), scoped to MVP-appropriate.** Two light mechanisms, not a full versioning regime (this is a 1–2-admin internal tool):
- **Version the roster contract:** carry a **contract version** on `/api/roster` (a `contractVersion` field in the payload, or a response header, or a `/api/v1/roster` prefix — pick one) and add a one-paragraph **deprecation note** ("we bump on breaking change; the Linter pins a version"). Closes the silent-Linter-break.
- **Stale-SPA refresh prompt:** the server advertises the current client build/contract version (a header on `/api/*` or a tiny `/api/version`); the SPA compares it to its own build hash and, if stale, shows a **non-blocking "A new version is available — refresh" overlay** (and refuses to submit writes it knows are stale, failing gracefully). D73 makes the *next* load current; this handles the *already-open* tab.

Neither needs a heavyweight scheme; both are standard and cheap. Records to `API-SPEC` (the roster contract + version) and `ENGINEERING-DESIGN §5.2`/`§6.5`.

> **Provisional D112 — API contract evolution (C9): `/api/roster` carries an explicit contract version (field or header) with a minimal deprecation policy so the runtime-independent Linter (D58) can't break silently; the SPA checks a server-advertised client version and prompts a stale background tab to refresh (non-blocking overlay), failing writes it knows are stale gracefully. Lightweight by design — no full versioning regime for a 1–2-admin tool.** Records to `API-SPEC`, `ENGINEERING-DESIGN §5.2`/`§6.5`; builds on D58/D73.
>
> **Your call (C9):** ratify; confirm the MVP scope (version `/api/roster` + stale-SPA refresh prompt) is right and you don't want a broader versioning scheme.

### C15 — No-email brothers can't self-serve; never stated · `question`

**What it is.** Book assumes every user has a working email for the magic-link/Ghost sign-in; D20 denies an unknown email and funnels it to an admin. The corollary — the oldest cohort and the ~70 unidentified/stale (AOL-era) addresses **can never self-serve and are manager-maintained only** — is correct but **never written down** as a known limitation. Reviewer A simply asks that the implicit assumption be made explicit.

**The fix — clean (a), documentation only.** State it plainly where limitations live: **no-email / unidentified brothers are staff-maintained and cannot access Book themselves** (their records are created and updated by managers/admins; D20's deny-and-contact-admin is the front door). No mechanism change — D20 already *behaves* this way; this just names the consequence so it isn't mistaken for a gap later. Records to `PRD §1`/limitations and `USER-MANUAL`. No `D##` (a stated limitation, not a foundational decision).

> **No new `D##` for C15** — worksheet `(a)`; the limitation is stated in `PRD` (audience/limitations) and `USER-MANUAL`. Cites D20.
>
> **Your call (C15):** ratify the wording goes into the PRD limitations + USER-MANUAL.

---

## Recording surfaces (per TRIAGE-PLAN principle 4)

Per principle 5, doc edits happen in the concentrated propagation phase (TRIAGE-PLAN §6); the worksheet + any inline `D##` are recorded as each is ratified.

| Item | Worksheet (§12) | Delivered docs | `DECISIONS.md` |
|---|---|---|---|
| U3 | (a) fix | `ENGINEERING-DESIGN §2.3`/`§2.6`, `API-SPEC §1.2` | **D109** |
| R18 | (a) fix | `ENGINEERING-DESIGN §2.5`, `DATABASE-SCHEMA §7` | folded into **D109** |
| U4 | (a) fix — **already done** | `API-SPEC §2`, `USER-MANUAL §2` (Sign-out) | **D95 (existing)** |
| U5 | (a) fix | `ENGINEERING-DESIGN` (client arch), `PRD §5.6.3` | **D110** (amends D35) |
| U2 | (a) fix | `CODING-PROJECT-PLAN §7`/`§10` + phase gates | **D111** (clarifies D53/D67) |
| U7 | (a) middle-path **or** (b) as-designed | `PRD §5.7.3`, `ENGINEERING-DESIGN` (Profile UI) | **D113** *(only if (a); amends D45)* |
| C9 | (a) fix | `API-SPEC`, `ENGINEERING-DESIGN §5.2`/`§6.5` | **D112** |
| C15 | (a) fix (doc) | `PRD §1`/limitations, `USER-MANUAL` | — (no `D##`) |

`D109`–`D113` are provisional drafts; the resolution pass (TRIAGE-PLAN §6) finalizes and renumbers. **Cross-session ties to flag in resolution:** D109 extends D25 and respects D95, and is constrained by D107's `frame-ancestors` (child-window, not iframe); D110 amends D35 and aligns with D95's no-disk-PII posture; D111 refines D53/D67's help layering and the `CODING-PROJECT-PLAN` phase gates; D112 builds on D58 (Linter) and D73 (asset immutability); D113 (if taken) amends D45 and reuses D53's toggle-tip. **U4 is already closed by D95** — confirm only. **This is the last triage sitting; next is the resolution/propagation pass** (TRIAGE-PLAN §6): finalize `D77+`, propagate into the eight delivered docs once each, close **C4**'s remaining TBD mechanics (the CSV escaping/edge-cases with S9, the Ghost-sync discrepancy-report JSON shape, the MITAA column format), and fill the composite §13 triage summary (disposition counts + new-decision list).

---

## The questions, consolidated

Most of this session is ratify-or-confirm. What I actually need from you, grouped:

**The one real fork — U7 (privacy-toggle copy):**
1. Keep D45 intact with both consequences inline on all seven toggles **(b)**, collapse fully to concise label + `?` tooltip **(a)**, or take the **middle path** — active-side consequence inline + counterfactual in the tooltip **(a, recommended)**? *(The tension: does softening "state both consequences" weaken the informed-consent nudge that cures your MITAA failure mode?)*

**The one design gap to specify — U3/R18 (session-expiry recovery):**
2. Ratify the **non-destructive** contract (preserve the form, re-auth without losing it, resume the Save; same handler retries broken images). Pick the re-auth mechanism — **child-window handoff** (recommended; no PII stash) vs. a `sessionStorage` draft — and confirm whether the `sessionStorage` fallback is acceptable under D95's no-disk-PII posture.

**Confirm only — U4:**
3. Confirm the Sign-out control already added by **D95** closes U4 (nothing new to decide).

**Three clean ratifications:**
4. **U5** — Web Worker for the Fuse + phonetic index; **drop D35's IndexedDB memo** (recompute-in-worker) for D95 consistency.
5. **U2** — split help into **AA-baseline-with-each-page** (Phases 3–5) vs. **enrichment + manual in Phase 6**, and reword the per-phase a11y gate accordingly.
6. **C9** — version `/api/roster` + a stale-SPA refresh prompt, MVP-scoped (no full versioning regime). **C15** — state the no-email-brothers limitation in the PRD + USER-MANUAL.

*— Drafted 2026-06-11 in-session at High depth, for review before live Session 6 (Medium). Next: you redline these proposals, then we run the live Session 6 triage in this same session to record dispositions into the §12 worksheet and any `D109+`. After Session 6: the resolution / propagation pass — the final stretch before implementation per `CODING-PROJECT-PLAN.md`.*
