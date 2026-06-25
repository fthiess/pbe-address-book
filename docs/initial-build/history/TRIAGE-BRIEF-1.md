# PBE Address Book — Triage Brief 1: Fast-track ratification

The pre-session brief for **Triage Session 1** per [`TRIAGE-PLAN.md`](TRIAGE-PLAN.md) §5. It proposes a disposition (a/b/c/d) and a fix sketch for the seventeen fast-track findings — **C1, C2, C3, C6, C8, C10, C11, C12, C13, C14, P6, P15, R16, R17, R19, R20, U6** — so the live session is you confirming or redirecting concrete proposals rather than deriving from scratch. Per the §10 workflow Forrest set on 2026-06-08, this brief is drafted **in-session**, immediately before the live triage that follows in the same session.

> **Status:** Drafted 2026-06-08 at Medium depth, before the live Session 1. Input: [`DESIGN-REVIEW-COMPOSITE.md`](DESIGN-REVIEW-COMPOSITE.md). Session-0 outcomes consumed: **D77** (no CCPA, but build-to-stricter/minimization is policy — bears on P6, P15), **D79** (WCAG 2.2 AA — reinforces U6).
>
> **✓ Ratified — Session 1 closed 2026-06-08.** All seventeen disposed **(a) fix** in the §12 worksheet. **Two new decisions:** **D80** (C14 — un-marking deceased restores the consent/verification snapshot taken at mark-time; rationale strengthened by the editor: the consent flag drives Ghost's live newsletter subscription, so a mistaken mark unsubscribes a *living* brother) and **D81** (P15 — `ghostMemberUuid` capture deferred until a concrete consumer exists, superseding D70). **Two editor changes to the proposals below:** **P6** — the proposed automated lint/test is **dropped**; the no-PII-in-properties rule stands but is enforced by code discipline (harm low vs. detection cost). **R19** — resolved by **widening the client tolerance to `currentYear + 7`** (server `+6` remains the sole hard gate), not by passing a server-authoritative boundary. **C6** confirmed (managers/admins editing others' headshots is intended); **C3** direction confirmed (which-sub-sections check deferred to resolution). The §1 proposals are preserved as drafted for the reasoning trail; the binding record is the §12 worksheet + D80/D81.

---

## What Session 1 is, and the two places it isn't purely mechanical

TRIAGE-PLAN §1 sorts the 81 findings into ~12 genuine judgment calls and ~69 ratify-a-proposal items; Session 1 is the cleanest slice of that second pile. Sixteen of these seventeen are stale references, traceability gaps, implementation pins behind a claimed property, or "make the existing intent testable" — lookup-and-confirm, no product values in tension. The plan bills the whole session as having **no bolded calls**, and that is *almost* right.

Two caveats I want to be straight about rather than wave through:

- **C14** (un-marking deceased) and **P15** (`ghostMemberUuid`) each hide a small but real fork — not a values-level blocker, but a choice with two defensible answers where I have to *recommend* rather than *look up*. I've bolded the call on each.
- **C3** and **C6** are (a)-fixes whose *direction* is clear but whose *exact current state* the composite compiler flagged as not separately re-verified. Each needs a one-line confirm against a specific doc sub-section during resolution. I note where.

Everything else is confirm-and-move-on. Net effort: ratify fifteen, decide two small forks, verify two references.

| # | Finding · sev | Proposed disposition | Note |
|---|---|---|---|
| C1 | "cookies" vs localStorage + dead ref · `should-fix` | **(a) fix** — repoint to localStorage per D30; kill the dangling `PRD §Cookies` ref | clean stale-ref |
| C2 | D45 "six/two" vs seven/three · `should-fix` | **(a) fix** — amend D45 with a "superseded in part by D56" note (seven booleans / three consent flags) | clean stale-ref |
| C3 | `allowCommentReplyEmail` in/out of manager projection · `should-fix` | **(a) fix** — make it *in* everywhere (column + filter), per D38 | **verify** §5.6.1/§5.6.4/§5.7.2 |
| C6 | Headshot authority absent from capability matrix · `should-fix` | **(a) fix** — add a headshot row (owner/manager/admin) to the PRD §4.1 matrix | one-line confirm: managers edit others' photos? |
| C8 | `verifiedBy` on screen but not exported · `should-fix` | **(a) fix** — include `verifiedBy` as a read-only manager/admin export column | symmetry with `lastVerifiedDate` |
| C10 | PRD §3.1 names singular `/profile`,`/headshot` · `minor` | **(a) fix** — align §3.1 wording to the real API surface | doc accuracy |
| C11 | Roster example uses `null` for optional names · `minor` | **(a) fix** — omit absent optionals in the §8 example | matters for the Linter (C9) |
| C12 | Add-Brother uncounted/undocumented · `minor` | **(a) fix** — name `/brother/new` (D31) as a page; document it; fix the "four pages" count | completeness |
| C13 | "Toggle Privileges" labels a 3-way selector · `minor` | **(a) fix** — rename to "Change role" | naming nit |
| C14 | Un-decease doesn't restore consent/verification · `minor` | **(a) fix** — **your call:** true-undo snapshot (recommended) vs. warn one-way | **small fork** · provisional **D80** |
| P6 | Mixpanel event-property PII risk · `should-fix` | **(a) fix** — forbid person-identifiers in properties + a lint/test | makes D62 intent testable |
| P15 | `ghostMemberUuid` retained with no purpose · `minor` | **(a) fix** — **your call:** defer capture (recommended) vs. document purpose+retention | **small fork** · amends D70 |
| R16 | `headshotVersion` sequential → race · `minor` | **(a) fix** — opaque token (UUID/timestamp) | also defeats P7's URL-enumeration facet |
| R17 | `stars` idempotency unverified · `minor` | **(a) fix** — specify `arrayUnion`/`arrayRemove` | implementation pin |
| R19 | `classYear` validated on two clocks · `minor` | **(a) fix** — server clock authoritative; client +1y tolerance | shared-validation edge (D50) |
| R20 | First sign-in check-then-create race · `minor` | **(a) fix** — create-if-absent semantics | standard hardening |
| U6 | Virtualized list breaks SR row indexing · `minor` | **(a) fix** — require + test `aria-rowcount`/`-rowindex`/`-setsize` | reinforced by D79 |

---

## A · Stale-reference & drift fixes — C1, C2, C3, C10, C11

These are the Session-5/6 back-propagation drift the composite §7 names as the dominant structural theme: decisions made late, never pushed back into the earlier docs a builder would read first. All **(a) fix**; none creates a `D##` (they correct or align existing decisions). The fix is "make the docs say what was already decided."

### 1 · C1 — Schema §6.1 says "cookies"; it's localStorage (D30) · `should-fix`
`DATABASE-SCHEMA §6.1` still says UI preferences "live only in client-side **cookies** (PRD §Cookies)," but **D30** moved them to `localStorage` (and explicitly supersedes the cookie assumption), and the cited `PRD §Cookies` section does not exist. Built as cookies, prefs would ride every request into the access logs — exactly the exposure D30 avoids, so this isn't only cosmetic.
**(a) fix:** update §6.1 to `localStorage` per D30; delete/repoint the dead `PRD §Cookies` reference. *Records:* worksheet + `DATABASE-SCHEMA §6.1`.

### 2 · C2 — D45 enumerates "six/two"; the schema is seven/three after D56 · `should-fix`
**D45** lists "six boolean fields … the two consent flags," but **D56** later added `allowCommentReplyEmail` as a third consent flag, so the schema (`§3.1`/`§9`) and PRD carry **seven booleans / three consent flags**. D45 was never retro-amended; a builder trusting it ships the wrong switch set. This is the canonical drift instance (C3 is its sibling).
**(a) fix:** amend D45 in `DECISIONS.md` to seven/three, or add an explicit "superseded in part by D56" note. *Records:* worksheet + `DECISIONS.md` (amend D45 — not a new D-number).

### 3 · C3 — `allowCommentReplyEmail` is in/out of the manager projection across docs · `should-fix`
Same D56 addition, now inconsistent across sections: `PRD §4.2` and `DATABASE-SCHEMA §9` **include** it in the manager-visible restricted set (and `§10` exports it), but the finding reports `§5.6.1`/`§5.7.2` omit it from the manager columns and `§5.6.4` omits it from the boolean filters — which would violate D38's "filterable ⟺ visible-as-column" rule.
**(a) fix:** make it consistently **in** — a manager-visible column *and* filter — across all sections, per D38. **Verify during resolution:** the compiler did not separately re-read `§5.6.1`/`§5.6.4`/`§5.7.2`, so confirm those three sub-sections are the ones to edit (the canonical answer is already "in," so the fix direction is not in doubt — only which sections move). *Records:* worksheet + the PRD sub-sections named.

### 4 · C10 — PRD §3.1 names singular `/profile`, `/headshot` · `minor`
The scope line predates the API spec and names singular endpoints; the real surface is `/api/profiles` plus `/me`, `/me/stars`, `/users/{id}/role`, `/auth/session`, `/roster`, `/admin/*`.
**(a) fix:** align the `PRD §3.1` wording to `API-SPEC`. *Records:* worksheet + `PRD §3.1`.

### 5 · C11 — Roster example sets optional names to `null` · `minor`
`API-SPEC §8`'s roster example uses `"middleName": null` etc., but `DATABASE-SCHEMA §2`'s convention is `?` = *may be absent* vs `| null` = *present-but-unknown* — so absent optionals should be omitted, not nulled. Real downstream bite: the cross-language Linter (C9) could mis-parse.
**(a) fix:** omit absent optionals in the example (or, if any field is genuinely present-but-unknown, type it nullable deliberately). *Records:* worksheet + `API-SPEC §8`.

---

## B · Traceability & completeness — C6, C8, C12, C13

Small gaps where the capability matrix, export, page inventory, or a label doesn't match the built behavior. All **(a) fix**.

### 6 · C6 — Headshot authority is in the API but not the capability matrix · `should-fix`
`API-SPEC §6` lets owner/manager/admin replace/remove **any** brother's headshot, but `PRD §4.1`'s matrix has no headshot row, so the authority is untraceable.
**(a) fix:** add an explicit headshot add/change/remove row to the matrix with roles owner/manager/admin. **One-line confirm:** the matrix should record what the API already grants — *is a manager editing another brother's photo intended?* I believe yes (it sits squarely inside the manager's existing edit-others authority), so this is documenting an intentional power, not granting a new one — but it's the one latent policy question in this item, so confirm it rather than let the matrix silently ratify it. *Records:* worksheet + `PRD §4.1`.

### 7 · C8 — `verifiedBy` is manager-visible on screen but not exported · `should-fix`
Managers see a "verified by" column on screen, and the CSV export *does* carry `lastVerifiedDate` — but `§10`'s "Not exported" list excludes `verifiedBy`, so the export shows *when* but not *who*. An odd screen-vs-export asymmetry with no rationale.
**(a) fix:** include `verifiedBy` as a read-only column in the manager/admin export, restoring symmetry with both the on-screen column and the exported date. *Records:* worksheet + `DATABASE-SCHEMA §10`.

### 8 · C12 — Add-Brother isn't counted among the "four pages" or documented · `minor`
`PRD §5` says "four pages," but **D31** defines `/brother/new` as a distinct admin-only route with a uniqueness-checked Constitution-ID entry, documented nowhere in the manual.
**(a) fix:** treat Add-Brother as an explicit page/mode; reconcile the "four pages" count in `PRD §5`; document the flow in `USER-MANUAL`. *Records:* worksheet + `PRD §5` + `USER-MANUAL`.

### 9 · C13 — "Toggle Privileges" labels a 3-way role selector · `minor`
**D51** replaced a cycling toggle with an explicit Brother/Manager/Administrator selector but kept the label "Toggle Privileges" — "toggle" reads as on/off and misleads for a 3-state control.
**(a) fix:** rename to "Change role" (or similar). *Records:* worksheet + `PRD §5.7.10`/`§4.1`.

---

## C · A lifecycle edge with a small fork — C14

### 10 · C14 — Un-marking deceased doesn't restore prior consent/verification · `minor`
Marking deceased forces both email-consent flags to `false` and freezes verification (D28/D48). **D49** makes the deceased flag *reversible* — but nothing specifies the reverse transition, so turning it back off leaves consent silently at `false` and verification frozen: the prior values are simply lost.

This is the one item in the batch with two genuinely defensible answers, because it turns on *why D49 exists*:

- **(i) True-undo (recommended).** D49's reversibility is there for **error-correction** — an admin mismarks a living brother. If the mark was a mistake, forcing consent off was *part of* the mistake, so the principled reversal restores the brother to exactly where they were. That requires snapshotting the pre-decease consent/verification state at mark-time and restoring it on un-mark. It treats un-decease as a real undo, which matches the error-correction intent.
- **(ii) Warn one-way.** Simpler: don't auto-restore anything; state plainly that consent and verification are *not* reinstated by un-marking, and warn the admin at the point of reversal. Privacy-conservative (no email is silently re-enabled), but it punishes the common case — a fat-finger correction — by making the admin manually rebuild state, and it quietly drops data.

I lean **(i)**: snapshot-and-restore is the behavior that honors why the reverse path exists at all, and the snapshot is cheap (a small frozen copy of the consent booleans + verification fields, cleared once restored). The privacy worry that animates (ii) — re-enabling email a brother never re-consented to — is moot in the error-correction case, because the brother *did* consent before the erroneous mark; we're restoring their real prior choice, not inventing one.

> **Your call (C14):** **true-undo snapshot-and-restore (recommended), or warn-it's-one-way?** If (i), this is a real lifecycle rule worth a number — **provisional D80: un-marking deceased restores the consent/verification state captured at mark-time.** If (ii), it's a doc-only clarification (amend D49, no D-number).

*Records:* worksheet + `DATABASE-SCHEMA §8` + (if (i)) `DECISIONS.md` **D80**, else an amend to D49.

---

## D · Concurrency & implementation pins — R16, R17, R19, R20

Four minors that pin an implementation behind a property the docs already claim (idempotent, race-free). All **(a) fix**; none is foundational, so no `D##` — they tighten `API-SPEC`/schema text.

### 11 · R16 — `headshotVersion` sequential counter → read-increment-write race · `minor`
`API-SPEC §6`'s example shows `"7"`→`"8"` (sequential), implying read-then-increment, so two concurrent uploads both read 7 and clobber. `DATABASE-SCHEMA §3.1` already *types* it as an opaque string, so the docs disagree with themselves.
**(a) fix:** settle on an **opaque, collision-free token** (UUID or write timestamp) for `headshotVersion`; fix the §6 example to match the schema type. **Bonus:** a non-guessable token also defeats the **P7** old-photo-URL-enumeration facet (P7's *retention/deletion* facet stays in Session 3). *Records:* worksheet + `API-SPEC §6` + `DATABASE-SCHEMA §7`/`§3.1`.

### 12 · R17 — `stars` PUT/DELETE called "idempotent" but unspecified · `minor`
`API-SPEC §4` asserts idempotency but names no mechanism; a naïve read-array-modify-write loses concurrent toggles across tabs, and there's no `If-Match` on the stars list.
**(a) fix:** specify `arrayUnion`/`arrayRemove` (atomic, genuinely idempotent, concurrency-safe) as the implementation. *Records:* worksheet + `API-SPEC §4`.

### 13 · R19 — `classYear` validation runs on two clocks · `minor`
`classYear ≤ currentYear + 6` runs in the shared client+server validation module (D50); around the year boundary the browser and server `currentYear` can disagree, so a value passes the fast client check and fails the authoritative server check.
**(a) fix:** make the **server clock authoritative** — compute the boundary server-side and pass it to the client, *or* widen the client tolerance by one year so the server is the only hard gate. (Either removes the disagreement; I lean server-provides-boundary, as it keeps a single source of truth.) *Records:* worksheet + `DATABASE-SCHEMA §8` (note D50).

### 14 · R20 — First-ever sign-in does a check-then-create of the `users` doc · `minor`
`§2.1`/`API-SPEC §2`: a first successful match creates the `users` doc "if none exists" — two concurrent first logins can double-create or error. First-login-only, so rare, but unspecified.
**(a) fix:** use **create-if-absent** semantics (a transaction, or `create()` treating "already exists" as success) so concurrent first logins converge. *Records:* worksheet + `API-SPEC §2` + `ENGINEERING-DESIGN §2.1`.

---

## E · Privacy minimization — P6, P15

Both flow from **D77** (Session 0): even though CCPA doesn't bind PBE, Book builds to the stricter standard, so minimization is policy, not optional. P6 makes an existing intent testable; P15 is the one minimization call with a real fork.

### 15 · P6 — Mixpanel event properties risk carrying person-to-person PII · `should-fix`
**D62** already says event properties carry "no PII," but nothing *enforces* it: if `search performed` carries the query (a name), the profile view carries `/brother/:id`, or `star toggled` carries the starred ID, Mixpanel silently learns **who searched for / viewed / starred whom** — leaking the explicitly-private `stars` list and a peer-interest graph. This is a "make the intent testable" finding, not a new policy.
**(a) fix:** explicitly forbid sending the search term, viewed-brother ID, starred-brother ID, and any record values as event properties; add a **lint/test that fails if a person identifier appears in an event payload.** Companion to **P1** (the Mixpanel identity-properties blocker, Session 3) — this closes the *properties* half. *Records:* worksheet + `ENGINEERING-DESIGN §6.2` + the `§6.6` test plan. No `D##` (enforces D62).

### 16 · P15 — `ghostMemberUuid` is retained with no current purpose · `minor`
`ghostMemberUuid` is captured and stored now but "reserved for future use (e.g. cross-app analytics identity)" — no MVP consumer exists (only `ghostMemberId` is actually used, for Ghost-update addressing). **D70** chose to capture it now on a "free to grab" rationale; the finding asks whether it earns its MVP place, and **D77**'s build-to-stricter/minimization stance sharpens the question.

The fork:
- **(a) defer capture (recommended).** Drop `ghostMemberUuid` from the MVP schema/projection/backup until a concrete consumer exists; revisit when the Mixpanel-uuid-identity idea (D62/D70) is actually decided. Purest minimization, and it shrinks the projection/backup/migration surface for a field nothing reads. Cost: a tiny re-capture later (it's one field, re-derivable from Ghost).
- **(b) keep, but document.** Retain it, but replace the vague "future use" note with a specific stated purpose + retention. Defensible only if you expect the Mixpanel-identity work soon enough that re-capturing is busywork.

I lean **(a)**: under D77, "collected with no current consumer" is exactly what minimization says to drop, and the re-capture cost is trivial.

> **Your call (P15):** **defer capture (recommended), or keep-and-document?** Either way it amends **D70**; deferring could carry a provisional `D##`, keeping is a doc edit to D70's rationale.

*Records:* worksheet + `DATABASE-SCHEMA §3.1` + amend `DECISIONS.md` D70.

---

## F · Accessibility — U6

### 17 · U6 — Virtualized list breaks screen-reader row indexing · `minor`
TanStack Virtual (D29) removes off-screen DOM nodes, so a screen reader announces "row 1 of 50" instead of the true ~2,000; `§6.6`'s manual checklist covers the grid's *keyboard* access but not these ARIA attributes. **D79** just raised the bar to WCAG 2.2 AA, so this is squarely on-policy.
**(a) fix:** require — and add to the `§6.6` manual a11y checklist — implementing and testing `aria-rowcount`, `aria-rowindex`, and `aria-setsize` on the virtualized grid so assistive tech reports the full dataset size. *Records:* worksheet + `ENGINEERING-DESIGN §6.6` (folds into the D67/D79 checklist). No `D##`.

---

## Recording surfaces (per TRIAGE-PLAN principle 4)

Per principle 5, the actual doc edits happen in the concentrated propagation phase (TRIAGE-PLAN §6), not now; the worksheet + any inline `D##` are recorded as each is ratified.

| Item | Worksheet (§12) | Delivered docs | `DECISIONS.md` |
|---|---|---|---|
| C1 | (a) fix | `DATABASE-SCHEMA §6.1` | — |
| C2 | (a) fix | — | amend **D45** (note D56) |
| C3 | (a) fix | PRD §5.6.1/§5.6.4/§5.7.2 *(verify)* | — (D38 governs) |
| C6 | (a) fix | `PRD §4.1` | — |
| C8 | (a) fix | `DATABASE-SCHEMA §10` | — |
| C10 | (a) fix | `PRD §3.1` | — |
| C11 | (a) fix | `API-SPEC §8` | — |
| C12 | (a) fix | `PRD §5`, `USER-MANUAL` | — |
| C13 | (a) fix | `PRD §5.7.10`/`§4.1` | — |
| C14 | (a) fix | `DATABASE-SCHEMA §8` | **D80** if true-undo; else amend D49 |
| P6 | (a) fix | `ENGINEERING-DESIGN §6.2`, `§6.6` | — (enforces D62) |
| P15 | (a) fix | `DATABASE-SCHEMA §3.1` | amend **D70** |
| R16 | (a) fix | `API-SPEC §6`, `DATABASE-SCHEMA §7`/`§3.1` | — |
| R17 | (a) fix | `API-SPEC §4` | — |
| R19 | (a) fix | `DATABASE-SCHEMA §8` | — |
| R20 | (a) fix | `API-SPEC §2`, `ENGINEERING-DESIGN §2.1` | — |
| U6 | (a) fix | `ENGINEERING-DESIGN §6.6` | — (folds into D67/D79) |

---

## The four questions, consolidated

Fifteen items are ratify-and-move-on. These four are all I actually need from you:

1. **C14** — un-decease: **true-undo snapshot-and-restore (recommended, → D80), or warn-it's-one-way?**
2. **P15** — `ghostMemberUuid`: **defer capture (recommended), or keep-and-document?**
3. **C6** — confirm a manager editing *another* brother's headshot is intended (so the matrix documents it rather than silently ratifies it).
4. **C3** — confirm `§5.6.1`/`§5.6.4`/`§5.7.2` are the sub-sections to edit so `allowCommentReplyEmail` is consistently a manager column + filter (direction is settled; this is a where-not-whether check).

*— Drafted 2026-06-08 in-session for review before live Session 1. Next: you redline these proposals, then we run the live Session 1 triage in this same session to record dispositions into the §12 worksheet and any `D77+`.*
