# PBE Address Book — Triage Brief 3: Privacy / consent / egress

The pre-session brief for **Triage Session 3** per [`TRIAGE-PLAN.md`](TRIAGE-PLAN.md) §5 — the "data leaving Book" register. It proposes a disposition (a/b/c/d) and a fix sketch for the nineteen privacy-and-egress findings — **P1, P2, P3, P4, P5, P7, P8, P9, P10, P11, P12, P13, P14, P16, P17, S9, S12, C5, C7** — every one of which is a *boundary-crossing* issue: the projection/consent model rigorously governs reads of the live record, but not the copies and exports that leave it. Per the §10 workflow you set on 2026-06-08, this brief is drafted **in-session**, immediately before the live triage that follows it.

> **Status:** Drafted 2026-06-09 at Extra depth, before the live Session 3 (live · High). **Every disposition here is a proposal, not a decision.** The recording surfaces (the composite §12 worksheet; the eight delivered docs; `DECISIONS.md` `D88+`) stay untouched until you ratify live. Provisional `D##` numbers (D88–D94) are drafts to be finalized/renumbered in the resolution pass (TRIAGE-PLAN §6). Input: [`DESIGN-REVIEW-COMPOSITE.md`](DESIGN-REVIEW-COMPOSITE.md) findings **P1–P17 (less the already-disposed P6/P15/P18/P19), S9, S12, C5, C7**, plus `DECISIONS.md` D5/D16/D19/D23/D41/D44/D45/D55/D56/D59/D61/D62/D63/D76 and the **ratified D77** read in full.
>
> **✓ Ratified — Session 3 closed 2026-06-09.** Recorded in the §12 worksheet and `DECISIONS.md` **D88–D95** (eight numbers — one more than the brief's D88–D94, because **P11** moved from (b) to (a), see below). **Five editor changes from the brief's leans:** **(P1)** `ignore_dnt: true` is **kept**, not dropped — the editor's stronger rationale is that DNT is a *global* "don't track me in general" signal, a poor proxy for site-specific intent, made concrete by the MITAA "do not email me" precedent (≈⅓ check it; 100% asked meant "no MITAA *fundraising*," not "don't share with PBE"); `role` is also kept (the segmentation the analytics exists for). **(P11)** the brief leaned *keep `private, no-cache`*; the editor's correct catch — the cached payload is **real PII** (names + shared emails/phones), not just role flags — flipped it to **`no-store`** (the only reliable way to leave nothing on a shared-machine disk, since no browser hook purges the HTTP cache on tab-close), plus a **Sign-out control** (reversing D24, **resolving U4** early) → **D95**. **(P4 copy)** the editor's on/off wording — "PBE may occasionally share your contact information…" / "PBE will not share your contact information…" — speaks only to "contact information" (accurate, since identity/death aren't contact info), so the always-flow disclosure rests on the notice/`USER-MANUAL §8`, not the switch. **(C7)** confirmed proposal (i): a dedicated second MITAA-specific export. **(P14)** `shareSpousePartner` defaults **false**; **(P8)** no user-facing note. **P16** retention pinned at **3 months** (audit + backups), **P7** purge window **3 months**. The §1 proposals are preserved as drafted for the reasoning trail; the binding record is the §12 worksheet + D88–D95.
>
> **The single most important input is D77 — and it changes the shape of this entire session.** The clean-context reviewers were *told to assume CCPA applies*, so they framed P1/P2/P3/P5/P8 as legal **blockers**. Session 0 determined the opposite: **PBE meets none of CCPA's "business" thresholds, CCPA does not bind it, and Book builds no compliance machinery** — no DSAR/access workflow, no deletion-request lifecycle, no purge-from-backups, no retention schedule, no tombstone, no first-login interstitial. D77 *also* already delivered the one thing worth doing on its own merit: the existing PBE privacy notice (which names **Mixpanel, MITAA, and Ghost**) was **made public without login** (`https://pbe400.org/privacy/`, done 2026-06-08) and is to be **linked from Book's login/landing surface** (a build-time item). So the four blockers don't disappear — they **downgrade**: the legal "must" is gone, and what remains is a set of *values, honesty, and hygiene* calls about each egress path. D77 explicitly pre-frames **P3 and P8 toward (b) as-designed**, and explicitly reserves **P1's Mixpanel minimization + `ignore_dnt`** as a *values* decision for this session.
>
> **Session-0/1/2 outcomes consumed:** **D77** (no CCPA; minimization-as-policy; notice public+linked; no tombstone) reframes P1/P2/P3/P5/P8/P16/P17. **D81** (`ghostMemberUuid` capture deferred) bears on P1's distinct_id question — a uuid-keyed Mixpanel identity is *not* available today, so any "hash/replace the email key" path is coupled to reviving D81. **P6** (Session 1) already closed the Mixpanel *event-properties* leak (who-searched/viewed/starred-whom); **P1 here is the companion *identity-properties* half**. **R16** (Session 1) already gave headshots opaque version tokens, which **closes P7's URL-enumeration facet** — P7 here is only the *retention* facet. **D82** (Session 2) means the cached bulk payload is now a uniform per-role projection carrying *no one's own-private values* — a small privacy bonus that bears on P11. **D78** (Linter Google-JWKS) and **D86** (rate limits) are adjacent but already settled.

---

## What Session 3 settles, after D77

The composite's executive summary called consent-and-privacy-at-the-boundary one of two "blocker spines." D77 cut the legal tendon in that spine. So the honest framing for this session is:

**The compliance project is gone; the stewardship project remains.** Nothing here is a legal must. But Book still holds ~700 living brothers' real contact data, the repo is public, and the product's stated ethos is "the data never leaves the brotherhood" and "trust." Several findings show places where data *does* leave — to Mixpanel, to MITAA, into logs, possibly to an LLM, onto a shared machine's disk — or where a **third party** (a spouse, an emergency contact) has their data published with no consent at all. Those are worth deciding *on their merits*, which is exactly what triage is for.

Sorted by the judgment they actually need:

1. **The genuine values calls (≈6).** **P1** (what to send Mixpanel; keep `ignore_dnt`?), **P4** (default external-sharing opt-in?), **P5** (ratify MITAA always-flow + fix the misleading copy), **P11** (shared-machine cache residue vs. the slow-cohort performance posture), **P12** (does the log-reader agent egress audit data to an LLM?), **S12** (re-introduce a server touchpoint just to audit bulk exports?). **C7** (the MITAA export *mechanism*) is a real engineering decision coupled to P4/P5.
2. **Third-party-data defaults (2).** **P13** (emergency contacts) and **P14** (spouse/partner) — non-members whose data is published by default with no opt-out. A small but principled consent-surface change that D45's "data never leaves the brotherhood" nudge does **not** justify, because the data subject isn't a brother.
3. **Clean hardening (a)-fixes (4).** **P7** (purge superseded headshots), **P9** (`Referrer-Policy`), **P10** (extend names-not-values to all log streams), **S9** (CSV formula injection). Standard, uncontroversial, independent of CCPA.
4. **Ratify-(b)-with-disclosure, pre-framed by D77 (5).** **P2** (notice/DSAR — largely closed by D77), **P3** (deletion/tombstone — (b)), **P8** (`adminNote` access — (b)), **P16** (retention schedule — (b), with a couple of operational numbers pinned), **P17** (photo visibility — (b)+disclose).
5. **Documentation/consistency (1).** **C5** (manager-set-deceased side-effect) — name the deliberate exception; one live security sub-question, much softened by D80.

**Net effort:** make ~6 values calls + 1 mechanism call, decide 2 third-party defaults, ratify 4 clean fixes and 5 D77-governed (b)s, fix 1 doc inconsistency.

| # | Finding · sev | Proposed disposition | The call that is yours |
|---|---|---|---|
| **P1** | Mixpanel PII + `ignore_dnt` · `blocker` | **(a) fix** — disclosure already done (D77); **drop `name`**; keep Constitution ID + role as properties; resolve the distinct_id + DNT forks · **D88** | **Values fork:** hash/uuid the `distinct_id` or keep raw email? keep or drop `role`? keep or drop `ignore_dnt: true`? |
| **P2** | No CCPA/DSAR machinery; notice · `blocker` | **(b)/(d)** — **closed by D77** (no machinery built; notice public+linked) | Confirm the Book→notice login-link is on the build checklist |
| **P3** | Can't delete; restore resurrects · `blocker` | **(b) as-designed** — **per D77** (no tombstone; deletion is admin error-correction only) | Ratify (pre-decided in D77) |
| **P4** | `allowShareWithMITAA` defaults opt-**in** · `blocker` | **(a) fix** — default it **false** (affirmative opt-in for *external* sharing); decouple from peer toggles · **D89** | **The call:** opt-in (rec) vs. keep open vs. seed from a prior consent |
| **P5** | MITAA forces identity/death on opt-out; misleading copy · `blocker` | **(b) as-designed** on the always-flow (CCPA moot) **+ (a) fix the copy** so "off" doesn't claim "shares none" · amends **D59** | Ratify always-flow; **fix the toggle copy**; formal vs. informal use-limitation with MITAA? |
| **P7** | Superseded headshots stay retrievable · `should-fix` | **(a) fix** — purge prior object versions on replace/remove + a short GCS lifecycle window · **D94** | Confirm the purge window (enumeration facet already closed by R16) |
| **P8** | `adminNote` hidden from subject · `should-fix` | **(b) as-designed** — **per D77** (deliberate staff-internal, D56; no right-to-access mandate) | Ratify; optional: a "no special-category content" usage note |
| **P9** | `Referer`/history leaks names · `should-fix` | **(a) fix** — strict `Referrer-Policy`; keep search terms out of loggable surfaces | Ratify (header lands with S14, Session 5) |
| **P10** | names-not-values only on audit stream · `should-fix` | **(a) fix** — extend the discipline to **all** log streams; document the stars/big-brother edge exception · amends **D61** | Ratify |
| **P11** | Full dataset in browser HTTP disk cache · `should-fix` | **(b) as-designed** — keep `private, no-cache`; document shared-machine guidance | **Privacy-vs-perf fork:** keep the 304 benefit (rec) vs. `no-store` for `/api/profiles` |
| **P12** | Log-reader agent may egress audit to an LLM · `should-fix` | **(a) fix** — constrain the agent to **first-party/local**; no external-LLM audit egress without a separate disclosed decision · **D91** | **The call:** first-party/local (rec) vs. cloud-LLM-with-disclosure vs. defer the agent |
| **P13** | Emergency contacts (third-party) default shared · `should-fix` | **(a) fix** — default `shareEmergency` **off**; consider manager-only visibility · **D93** | Confirm default-off; visibility scope? |
| **P14** | Spouse/employer/links public, no toggle · `should-fix` | **(a) fix** `spousePartnerName` (add a toggle); **(b)** employer/jobTitle/links (brother's own data) · **D93** | Add a spouse toggle (rec); its default; leave the professional fields public? |
| **P16** | No retention schedule per category · `minor` | **(b)** — **per D77** (no schedule required); pin audit/backup numbers operationally | Ratify; OK to pin concrete audit/backup retention numbers? |
| **P17** | No per-photo visibility control · `minor` | **(b) as-designed** — deliberate coarse grant (D23); disclose the asymmetry | Ratify + one notice line |
| **S9** | CSV/formula injection in exports · `should-fix` | **(a) fix** — neutralize leading `= + - @` in both exports + a test | Ratify (closes C4's CSV-escaping gap) |
| **S12** | Bulk export unauditable · `should-fix` | **(a) fix** — a thin fire-and-forget audit ping; generation stays client-side (D41) · **D92** | **The call:** add the audit touchpoint (rec) vs. accept no trail |
| **C5** | Manager-deceased forces consent + Ghost write · `should-fix` | **(a) fix** — name the deliberate exception in §4 | Ratify; keep manager-allowed (rec, given D80) vs. admin-only/step-up? |
| **C7** | MITAA export mechanism undefined · `should-fix` | **(a) fix** — specify a consent-aware export (two-tier file) · **D90** | **The call:** a small dedicated export (rec) vs. a precisely-specified manual two-pass |

---

## §1 · The Mixpanel egress — P1

### P1 — Identifying PII shipped to Mixpanel, with DNT overridden · `blocker`

**What it is.** On `identify()`, Book sends every brother's **email** (as `distinct_id`), **full name**, **Constitution ID**, and **role** to Mixpanel as user properties, with **`ignore_dnt: true`** overriding Do-Not-Track / GPC, and Identity Merge linking it to PBE-News (Ghost) browsing (D62/§6.2). The composite raised three sub-issues: it's undisclosed; it's unminimized; and `ignore_dnt` overrides a browser privacy signal.

**What D77 has already settled.** Two of the three are off the table. **Disclosure** is done — the public notice names Mixpanel (D77). The **CCPA "sharing/sale"** framing and the DPA/service-provider-term ask are **moot** (PBE isn't a business). D77 explicitly leaves **payload minimization and `ignore_dnt`** as a *values* call for this session — that's all that's live.

**Why this is genuinely yours.** It's a values trade between analytics usefulness and the product's "data never leaves the brotherhood" ethos, on a tool that is *internal, members-only, and consensual* but still ships identity to a third-party SaaS. Four independent dials:

- **`name` → drop it (recommended, and I'm confident here).** Name adds nothing to analytics that Constitution ID + role don't already give you for segmentation, and it's the most identifying field in the payload. Dropping it is pure minimization under D77's policy posture, with zero analytics loss. I propose folding this into the (a)-fix rather than the fork.
- **`distinct_id` (email) — keep raw, or hash/replace?** This is the load-bearing fork, and it's *coupled to D81*. Email is the auth join key and the native key Ghost's own Mixpanel integration uses, so Identity Merge across Book↔Ghost works **only if both halves resolve the same key**. Hashing the email would have to be done *identically on both sides* to preserve the merge, and a change-immune `ghostMemberUuid` key — the clean long-term answer (D62/D70) — was **deferred in D81** (no consumer yet). So today the realistic options are: **(i) keep raw email** as `distinct_id` (pragmatic; it's internal and already in Ghost's Mixpanel too) or **(ii) revive D81** and move both apps to a uuid/opaque `distinct_id` (cleaner, but it re-opens a decision you just deferred and adds cross-app coordination). I lean **(i) keep raw email for MVP**, noting (ii) as the principled upgrade if/when D81 is revived — but flagging it as your call because it's the one piece of identity you might most want to minimize.
- **`role` — keep or drop?** Shipping `role` exposes the admin/manager roster to Mixpanel. It's genuinely useful for product segmentation ("how do admins use Book vs. brothers"), and the set is small and not independently sensitive inside a members-only tool. I lean **keep**, but it's a clean drop if you'd rather not have the privilege map in a third party.
- **`ignore_dnt: true` — keep, or honor DNT/GPC?** With CCPA moot, there's no legal exposure; the question is whether overriding a brother's *explicit* privacy signal sits right for *this* audience. The case to keep: it's an internal tool measuring its own usage, fully disclosed, and DNT would zero out data from exactly the privacy-conscious cohort. The case to drop: the product's whole posture is trust and "data stays in the brotherhood," and the analytics is *nice-to-have, not load-bearing* — honoring DNT costs you little and is a visible act of respect for an older, trust-sensitive membership. I lean **slightly toward honoring DNT** (drop `ignore_dnt`) precisely because the analytics isn't load-bearing and the gesture aligns with the ethos — but this is a real values call and I'd defer to your read of the membership.

**Proposed disposition — (a) fix, foundational.**

> **Provisional D88 — Mixpanel identity payload is minimized: `name` is dropped; Constitution ID + role are retained as user properties [pending your role call]; the `distinct_id` and `ignore_dnt` choices are resolved per the live session.** Records to `ENGINEERING-DESIGN §6.2` (amends D62). Companion to **P6** (event-properties, already closed Session 1) — together they bound what reaches Mixpanel.

> **Your call (P1):** ratify **drop `name`**; then decide **(a)** raw email vs. hashed/uuid `distinct_id` (the latter reopens D81), **(b)** keep vs. drop `role`, **(c)** keep vs. drop `ignore_dnt: true` (I lean keep-email / keep-role / **drop `ignore_dnt`**, but all three are yours).

---

## §2 · The MITAA cluster — P4 · P5 · C7

The three MITAA findings are one knot: **P4** is the default, **P5** is the always-flow carve-out and its copy, **C7** is the mechanism that has to produce the resulting file. They resolve cleanly together, and C7's answer *depends* on what P4/P5 decide flows.

### P4 — `allowShareWithMITAA` defaults to opt-in for *external* sharing · `blocker`

**What it is.** The MITAA master switch defaults `true` (D45/D59), and migration seeds only the newsletter/comment prefs from Ghost, not this flag (D57). So at launch every passive brother is **silently opted into sharing their contact set with an external party** on the next admin MITAA export. The finding's sharpest point is internal to your own design: D45's ethical defense of open defaults rests *explicitly* on "**the data never leaves the brotherhood**" — which is true for every toggle **except this one**, the one flag whose entire purpose is to send data *outside* it.

**Why CCPA being moot doesn't save the default.** This was never really a legal finding — it's an ethics/consistency one, and it stands on its own. The nudge logic (D45) is sound *inside* a closed, consensual directory; it does not transfer to data crossing the boundary to MITAA, by D45's own stated rationale.

**The fix.** Default `allowShareWithMITAA` to **false** — affirmative opt-in for external sharing — and **decouple it from the peer share-toggles** (which keep their open defaults, since they stay inside the brotherhood). Note there is no clean "prior consent" to seed from: much of the data *originated* at MITAA, but that's not a record of the brother consenting to *Book→MITAA* sharing, so seeding-from-prior-consent isn't really available; opt-in-default is the honest floor.

**The cost, stated plainly.** At launch, the MITAA export carries *no brother's contact info* until brothers opt in — so the first exchange shares only the always-flow identity/death data (P5) plus whoever has affirmatively opted in. If you value MITAA having current contact info for the *whole* membership (e.g., reunion mailings) more than the opt-in principle, that's the reason you might keep it open. I lean **opt-in/false** — it's the choice that makes D45 internally consistent and matches the product's reason for existing (it was built to fix exactly the "silently swept into a sharing default" harm) — but the launch-behavior change is real, so it's your call.

**Proposed disposition — (a) fix, foundational.**

> **Provisional D89 — `allowShareWithMITAA` defaults to `false` (affirmative opt-in for external sharing), decoupled from the peer share-toggles, which keep their open defaults.** Amends D45 (open-default rationale is scoped to intra-brotherhood data) and D59; records to `DATABASE-SCHEMA §3.1`/`§9`, `PRD §5.7.3`.

> **Your call (P4):** default **opt-in/false (recommended)**, keep the open default, or seed from a defensible prior-consent record (I don't think a clean one exists)?

### P5 — Always-flow of identity/death on opt-out; "off shares none" is misleading · `blocker`

**What it is.** When `allowShareWithMITAA` is **off**, the export *still* sends name + class year + public deceased status/obituary (D59). That always-flow is **deliberate** — it's MIT's own data and the join key, and the death info is the reciprocal of the import's mortality-catching value (PBE sometimes learns of a death before MITAA). But the one-line helper text tells the brother "off shares none of it," with the carve-out only in the fuller `USER-MANUAL §8` fine print. The reviewers' two asks: honor the opt-out for identity too, *or* fix the copy; and put a use-limitation agreement in place with MITAA.

**Why (b)-on-substance, (a)-on-copy.** The legal objection ("can't force-transfer after opt-out") is **moot under D77**. The always-flow is a sound, deliberate design choice that survives. But the *misleading copy* is a real honesty bug regardless of law — a two-position switch (D45) that states "off shares none of it" while name/class/death always flow is, by D45's own no-dark-pattern standard, dishonest. So: **ratify the always-flow (b)**, and **fix the copy (a)** so the switch states its true consequence (e.g., "Off: MITAA still receives your name, class year, and any public In-Memoriam info, but **not** your contact details").

**The use-limitation agreement.** A written term governing what MITAA may do with the shared contacts is good practice, but PBE↔MITAA is an *informal, occasional, low-trust* exchange (D59), not a data-processor relationship. I'd treat a heavyweight legal agreement as overkill for a non-business; a **lightweight stated understanding** (retention/secondary-use expectation, recorded in the exchange procedure) is proportionate. But you know the MITAA relationship — your call on the formality.

**Proposed disposition — (b) as-designed on the always-flow + (a) fix the copy.** No new number; amends **D59** and the helper/`USER-MANUAL §8` copy.

> **Your call (P5):** ratify the always-flow as-designed (CCPA moot); approve **fixing the toggle copy** to disclose it honestly; and choose **formal vs. informal** use-limitation with MITAA.

### C7 — The MITAA export *mechanism* is undefined for its consent-aware field rules · `should-fix`

**What it is.** The requirement is a **two-tier file**: identity + public-death for **all** brothers (P5 always-flow), contact details for **consenting** brothers only (P4 flag), emergency data for **none** (D59). D59 deliberately makes MITAA export a *manual admin operation reusing the role-projected CSV + an external mapping script* (automated exchange deferred, D11). The finding's correct catch: a **single consent-filtered CSV export cannot produce that mixed per-field selection** — filtering rows by consent drops the identity-for-all requirement; not filtering leaks contacts for non-consenters. So the mechanism is genuinely undefined, and it gets *more* load-bearing once P4 makes consent the default-off gate.

**The fix — two honest options.**

- **(i) A small dedicated consent-aware MITAA export (recommended).** A purpose-built admin export that emits the two-tier file directly: every brother's identity/death, plus contacts *only* for `allowShareWithMITAA === true`, never emergency. It's the only path that *reliably* produces the documented field rules, it's admin-only and occasional (low surface), and it removes the fragile external-merge step. Cost: it's a Book feature D59 tried to avoid building.
- **(ii) A precisely-specified manual two-pass.** Keep D59's "reuse existing tools," but *specify the exact procedure*: export pass A (identity/death, all brothers) + export pass B (contacts, consenting brothers only) + a defined external script that merges them into MITAA's format. Cost: fragile, manual, and the script becomes load-bearing for a consent guarantee.

I lean **(i)** — when a manual path provably *cannot* meet a consent invariant, the robust answer is the small feature, and "consenting-contacts-only" is exactly the kind of guarantee you don't want riding on a hand-run merge script. But (ii) honors D59's minimal-feature stance if you'd rather not add an export surface. This is also where **S9** (formula injection) must be applied — whichever path, the output is a CSV to an external party.

**Proposed disposition — (a) fix, foundational.**

> **Provisional D90 — The MITAA export is specified as a consent-aware two-tier extraction (identity/public-death for all; contact details only where `allowShareWithMITAA` is true; emergency never), implemented as [a dedicated admin export / a specified manual two-pass + merge].** Amends D59; records to `ENGINEERING-DESIGN §5.3`, `PRD §4.1`/`§5.8`. Formula-injection neutralization (S9) applies to its output.

> **Your call (C7):** a **small dedicated consent-aware export (recommended)** or a **precisely-specified manual two-pass**? (Keyed to P4/P5, since they define what the two tiers contain.)

---

## §3 · Third-party data published without consent — P13 · P14

These two are about people who **aren't brothers** and never consented: an emergency contact and a spouse/partner. D45's open-default nudge is ethical *because the subject is a consenting member sharing their own reachability* — that justification simply doesn't reach a non-member's data. The design already half-recognizes this (it excludes emergency data from MITAA *as* third-party data) but then broadcasts it inside Book by default.

### P13 — Emergency contacts default to shared and broadcast to all peers · `should-fix`

**What it is.** An emergency contact is a non-member's name/phone/email, yet `shareEmergency` defaults `true` (D16/D45), so by default every brother's emergency contact is pushed into all ~700 brothers' bulk downloads and backups. The third party never consented and has no control.

**The fix.** Default `shareEmergency` to **off** (opt-in) — the minimal change that makes Book's treatment of emergency data internally consistent with its own third-party classification. Optionally also **restrict emergency-contact visibility to managers/admins** even when shared (it's contact-of-last-resort data, not directory-browsing data). I lean **default-off**; manager-only-visibility is a reasonable add but a separate sub-call.

### P14 — `spousePartnerName`, `employerName`, `jobTitle`, `links` are public-class with no toggle · `should-fix`

**What it is.** A brother can't hide any of these. The pointed one is **`spousePartnerName`** — a third party's name published to the whole brotherhood with no opt-out or knowledge. The others (`employerName`, `jobTitle`, `links`) are the **brother's own** professional info, voluntarily entered.

**The fix — split it.** Add a **`shareSpousePartner` toggle** so the brother controls the third party's name (the same pattern every other contact field already has). Leave `employerName`/`jobTitle`/`links` **public as-designed (b)** — they're the brother's own data, voluntarily populated, and a directory's professional fields being visible is the point; a toggle there is optional gold-plating. The spouse toggle's **default** is a small sub-call: I lean **on** (it's mild, commonly-shared social info, and the real gap is the *absence of any control*, not the default) — but if you treat it strictly as third-party data like P13, **off** is the consistent choice.

**Proposed disposition — (a) fix for the two third-party fields, (b) for the brother's-own professional fields.** One foundational decision covers both findings (each adds/changes a toggle in the consent surface).

> **Provisional D93 — Third-party-data consent surface: `shareEmergency` defaults to `false` (opt-in); a new `shareSpousePartner` toggle is added [default per the live call]; `employerName`/`jobTitle`/`links` stay public as the brother's own voluntary data.** Amends D16/D45; records to `DATABASE-SCHEMA §3.1`/`§3.2`/`§3.3`/`§9`, `PRD §5.7.3`. Note: a new boolean grows the toggle set (C2's "seven/three" count moves again — fold into the resolution-pass count reconcile).

> **Your call (P13/P14):** confirm `shareEmergency` **default-off** (+ manager-only visibility?); confirm **adding** a `shareSpousePartner` toggle and its **default**; confirm leaving the professional fields public.

---

## §4 · Logs and on-device residue — P9 · P10 · P11 · P12

### P9 — `Referer`/history leak names; no `Referrer-Policy` · `should-fix`

**What it is.** The Name Search term, filters, and `/brother/:id` live in the URL (D31). With no `Referrer-Policy`, those URLs ride along as `Referer` into access logs and onto external sites (clicked `obituaryUrl`/`links`), and sit in browser history on shared machines. The auth flow protects the *token* via the fragment (D20) but ongoing view-state is unprotected.

**The fix — clean (a).** Set a strict **`Referrer-Policy`** (`same-origin`, or `strict-origin-when-cross-origin` if any legitimate cross-origin referer is wanted); keep the search term out of access-loggable surfaces; confirm Firebase/LB logs don't retain query strings with PII. The header itself lands with the **S14 CSP/security-headers** work in **Session 5** — note the coordination so it's specified once. The browser-history-on-shared-machines facet overlaps **P11**.

> **Your call (P9):** ratify; the header is implemented alongside S14 (Session 5).

### P10 — names-not-values discipline covers only the audit stream · `should-fix`

**What it is.** D61's "log identifiers and field names, never values" rule is scoped to the **audit** stream only. The **diagnostic** stream (Ghost-push failures, "unexpected states") has no such constraint, so an error path can capture contact **values** into logs with looser access controls. Separately, for a `stars`/big-brother action the audit "target ID" *is* the value (who was starred) — a documented exception.

**The fix — clean (a).** Extend names-not-values to **all** log streams; forbid logging request/response bodies or Ghost payloads; scrub PII from error/diagnostic logs and **test** it; document the relationship-edge exception (stars, big-brother) where the target ID is inherently part of the action metadata.

> **Provisional — amends D61** (no new number; extends an existing discipline). Records to `ENGINEERING-DESIGN §6.1`, `§6.6` test plan.

> **Your call (P10):** ratify.

### P11 — Full projected dataset persists in the browser's HTTP disk cache · `should-fix`

**What it is.** D76's conditional-GET design relies on the browser persisting the full projected dataset in its HTTP disk cache (`private, no-cache` = store-but-revalidate) so a repeat/reload load can be served as `304` — the byte-saving the *whole* D73–D76 effort exists to give the slow-connection cohort. The cost: on a **shared/public machine** (a use the manual anticipates), the entire role-projected directory stays on disk after the 4-hour session lapses, until evicted.

**Why this is a genuine values fork.** It's privacy-vs-performance in its purest form, and the two sides are both *your own stated priorities*: D73–D76 (slow-cohort byte reduction) vs. D73's own "on-device member data is a privacy cost" instinct. Switching `/api/profiles` to **`no-store`** would bound the residue but **kill the 304 benefit** — the slow-link repeat visitor re-downloads the whole compressed payload every reload, which is exactly the harm those decisions were built to prevent.

**My lean — keep `private, no-cache` + document.** The performance posture is a load-bearing, deliberately-chosen product value for the actual audience; the shared-machine residue is a narrower risk, already access-limited to the role's projection, and **D82 sharpened it favorably** — the cached bulk payload now carries *no one's own-private values*, only a role projection of others. Mitigate with **guidance** (advise sign-out/clear on shared machines in the public notice + `USER-MANUAL §2`) rather than detonating the performance win. **Note the U4 interaction:** there's currently *no logout control* (D24; U4 reopens it in Session 6), so "sign out to clear" has nothing to click — if you keep `no-cache`, U4 gains weight. This is your call if you weigh shared-machine privacy above the slow-cohort posture.

**Proposed disposition — (b) as-designed (keep D76) + documented guidance.** No new number; ratifies D76, adds a notice/manual line, cross-refs U4.

> **Your call (P11):** keep `private, no-cache` + shared-machine guidance **(recommended)**, or switch `/api/profiles` to `no-store` and accept the slow-cohort re-download cost?

### P12 — The log-reader "agent" may egress audit data to a third-party LLM · `should-fix`

**What it is.** §6.1 grants a "planned log-reader agent" `roles/logging.viewer` over the **audit** stream — which records *who did what to whom* across the membership, i.e. a behavioral profile of the brotherhood. If that agent is LLM-backed and **cloud-hosted** (as "agent" implies), audit contents egress to an external model provider — an unexamined third-party flow covered by no disclosure. The data flow is genuinely *unspecified* today.

**Why it's a real call, even with CCPA moot.** This is the most *sensitive* egress in the whole register — not contact fields but the relationship-and-action graph of the membership — and it's the one egress the public notice does **not** currently name. Under D77 disclosure isn't mandated, but shipping the brotherhood's behavioral log to an external LLM is squarely against the "data stays in the brotherhood" ethos, and you have the means to avoid it: the agent is only *planned*, and your environment (local LLM tooling — the same posture D58 assumes for the Linter; a capable local GPU) makes a **first-party/local** agent entirely feasible.

**The fix.** Pin the constraint now even though the build is deferred: the log-reader agent processes audit data **first-party / on-premise (local model), with no external-LLM egress** — and *if* a cloud LLM is ever wanted, that becomes a separate, explicitly-disclosed decision (notice addendum + field minimization + a processor constraint). I lean **constrain-to-first-party**; the alternatives are cloud-LLM-with-disclosure (re-opens an egress you can cheaply avoid) or **(c) defer** the whole agent with the constraint recorded.

**Proposed disposition — (a) fix, foundational.**

> **Provisional D91 — The planned log-reader agent is constrained to first-party / local processing of the audit stream; no audit content egresses to an external LLM/SaaS. Any future cloud-LLM agent requires a separate disclosed decision (notice addendum + field minimization + processor constraint).** Amends D61; records to `ENGINEERING-DESIGN §6.1`. (Build remains deferred; the *constraint* is decided now.)

> **Your call (P12):** constrain to first-party/local **(recommended)**, allow a cloud LLM with disclosure, or defer the agent entirely (constraint still recorded)?

---

## §5 · Exports — S9 · S12

### S9 — CSV / formula injection in exports (incl. the MITAA file) · `should-fix`

**What it is.** Both the client-side Directory export and the MITAA file emit user-controlled free-text (`firstName`, `employerName`, `adminNote`, links) to CSV. A cell beginning `=`, `+`, `-`, or `@` executes as a formula when opened in Excel/Sheets — and the MITAA file goes to an external party. RFC-4180 quoting does **not** neutralize this; it's a separate defense.

**The fix — clean (a).** Neutralize leading formula characters on every text cell (prefix `'` or wrap per OWASP) in **both** the Directory export and the MITAA mapping (C7); add a test for malicious leading characters. This **closes the open CSV-escaping facet of C4** (`DATABASE-SCHEMA §10` still defers escaping to "Session 6"), so it folds into the C4 umbrella in the resolution pass.

> **Provisional — no new number** (closes a deferred spec gap). Records to `DATABASE-SCHEMA §10`, `ENGINEERING-DESIGN §5.3`/`§6.6`.

> **Your call (S9):** ratify.

### S12 — Bulk PII export is unauditable · `should-fix`

**What it is.** Export is **pure client-side by design** (D41) — it falls out of the bulk-download architecture and inherits the per-role projection for free, so no endpoint exists; and the §6.1 audit event list doesn't include export. So the **single highest-volume egress path** — a manager/admin downloading the whole visible directory, or an admin exporting consenting brothers' contacts to MITAA — leaves **no security audit trail** (the Mixpanel "export" event is client-controlled analytics, not an audit record).

**Why it's a real tradeoff.** D41 is a *credited* simplicity (TRIAGE-PLAN principle 6 — don't dismantle it). S12 asks to add a server touchpoint *purely for auditability*. Under D77 there's no mandate. But "who exported the entire membership, and when" is exactly the event you'd most want a record of for a public-repo directory of real PII, and it's the one egress with no trail at all.

**The fix that preserves D41.** Keep client-side **generation** (D41 intact); add a **thin fire-and-forget audit ping** — the client notifies a lightweight backend endpoint (actor, scope/row-count, timestamp) as it generates, which writes one audit entry. Add **"export"** to the §6.1 audit event list. The only thing sacrificed is that export is no longer *purely* offline; generation, projection, and UX are unchanged. The alternative is **(b) accept no trail** — defensible, since the exporter is already a trusted manager/admin and can only export their own projection — but I lean **(a)**: an audit line on the biggest egress is cheap insurance that doesn't touch the architecture's strength.

**Proposed disposition — (a) fix, foundational.**

> **Provisional D92 — Bulk/MITAA export writes an audit entry (actor, scope, row-count, timestamp) via a thin backend notify endpoint; generation stays client-side (D41 preserved). "Export" is added to the §6.1 audit event list.** Amends D41/D61; records to `ENGINEERING-DESIGN §6.1`/§5.3`, `PRD §5.6.8`.

> **Your call (S12):** add the lightweight audit touchpoint **(recommended)**, or accept client-side export with no trail (D41 as-is)?

---

## §6 · Pre-framed by D77 — ratify-(b)-with-disclosure — P2 · P3 · P8 · P16 · P17

These four-plus were the legal "blockers." D77 governs them; the proposals are confirmations, with the reasoning kept so the worksheet stands on its own.

- **P2 — No CCPA/DSAR machinery; notice-at-collection.** **(b)/(d), closed by D77.** No DSAR/access/deletion/opt-out workflow is built (PBE isn't a business); notice-at-collection is satisfied by the now-public notice (`pbe400.org/privacy/`, names Mixpanel/MITAA/Ghost). *One open thread:* the **Book→notice login-link** is a build-time item (D77) so notice precedes first-sign-in auto-provisioning — **confirm it's on the build checklist.** *Your call:* ratify; confirm the link is tracked.

- **P3 — Can't fully delete; restore resurrects.** **(b) as-designed, per D77.** Membership is an immutable signed fact, not erasable on request; whole-record deletion is **admin error-correction only**, so there is no "deleted person" for a restore to resurrect, and **no tombstone is built**. The copies the finding lists (backups, GCS versions, Mixpanel, MITAA snapshots) need no purge lifecycle; an error-deleted record almost never generated Mixpanel events (no sign-in), so a Mixpanel deletion call isn't warranted. *Your call:* ratify (pre-decided in D77).

- **P8 — `adminNote` hidden from its subject.** **(b) as-designed, per D77.** The hidden-from-owner property is deliberate (D56) and its whole value depends on it; the right-to-access that animated the finding is moot. *Optional discipline (not required):* a usage note that `adminNote` is for staff coordination, **not** special-category data, and is export-controlled (already barred from MITAA, §10). *Your call:* ratify (b); want the usage note?

- **P16 — No retention schedule per category.** **(b), per D77** — no compliance schedule required. But two **operational** numbers are worth pinning *on their own merit* (not as compliance): the **audit-log retention** (today "months to a few years" — pick a number) and **backup retention** ("N dailies + a few monthlies" — pin N), plus the **P7 headshot-purge window** below. *Your call:* ratify (b); OK to pin concrete audit/backup numbers in resolution?

- **P17 — No per-photo visibility control.** **(b) as-designed + disclose.** The coarse photo grant is deliberate and *architecturally load-bearing* — D23's single signed cookie grants the whole `/img` prefix, which is what makes the lazy/prefetch grid work; a per-photo toggle would force per-image authorization and break that model. Keep it; add a one-line disclosure (notice/manual) that photos are visible to all brothers with no per-photo hiding. *Your call:* ratify (b) + the disclosure line.

---

## §7 · The two genuine fixes left — P7 · C5

### P7 — Superseded headshots remain retrievable · `should-fix`

**What it is.** Two facets. The **URL-enumeration** facet (guessable sequential `…/{version}.webp` + whole-prefix grant) is **already closed by R16** (Session 1 → opaque version token). The **retention** facet remains: object versioning is on (D8), so "Remove photo"/replace doesn't make earlier images unreachable — a brother who removes their photo reasonably expects it gone, and the old versions also complicate the "clean" feeling P3 otherwise waves off.

**The fix.** On replace/remove/delete, **delete the prior object versions** for that brother, and/or add a **GCS lifecycle rule** purging non-current headshot/thumbnail versions after a **short window**; confirm the CDN doesn't serve superseded objects. The one tension: object versioning is part of the image-backup story (D8) — so a *brief* retention window (rather than immediate hard-delete) balances "removed means gone" against accidental-deletion recovery. I lean a short window (e.g., 7–30 days) you choose.

**Proposed disposition — (a) fix, foundational (sets a retention behavior).**

> **Provisional D94 — On headshot replace/remove/delete, prior GCS object versions are purged after a short lifecycle window (default [N] days); the CDN is confirmed not to serve superseded objects.** Amends D8/D17/D23; records to `DATABASE-SCHEMA §7`, `API-SPEC §6`, `ENGINEERING-DESIGN §2.5`.

> **Your call (P7):** ratify; confirm the purge window length.

### C5 — Manager-set-deceased forces consent off + pushes Ghost unsubscribes · `should-fix`

**What it is.** Managers are barred from changing consent and from outward writes (PRD §4.1), yet marking deceased (manager-allowed) **forces** both email-consent flags false and **pushes unsubscribes to Ghost** (D55) — a consent change *and* an outward write by a role the matrix says can do neither. Two parts: a documentation/consistency gap, and a live security question (a rogue/compromised manager could silently cut a *living* brother's newsletter/comment email by mark-deceasing them).

**Why D80 mostly defuses the security part.** Since Session 1, **un-marking deceased restores the consent/verification snapshot** (D80) — so a mistaken or malicious mark is now **reversible and the consent is restorable**, the deceased-marking is **audited** (D61), and the residual harm is a *temporary* cutoff until caught, not a silent permanent one. That's a meaningful change from what the reviewer saw.

**The fix.** **(a)** Name the exception explicitly in PRD §4 — marking deceased is the one manager action with a consent + outward-write side-effect, *by design* (the deceased lifecycle, D55/D28/D48/D80). On the security sub-question, I lean **keep it manager-allowed**: directory maintenance is the manager's job, D80 makes it reversible, and it's audited — admin-only or step-up would tax the common, legitimate case. But it's a live call: if you'd rather, mark-deceased becomes **admin-only** or gains a **step-up confirmation** given the Ghost comms side-effect (this would also touch the S5 step-up discussion in Session 5).

**Proposed disposition — (a) fix (documentation); security facet ratified toward keep-manager-allowed.** No new number; amends PRD §4 text (behavior already governed by D55/D80).

> **Your call (C5):** ratify naming the exception; keep mark-deceased **manager-allowed (recommended, given D80 + audit)**, or make it admin-only / step-up?

---

## Recording surfaces (per TRIAGE-PLAN principle 4)

Per principle 5, the doc edits happen in the concentrated propagation phase (TRIAGE-PLAN §6); the worksheet + any inline `D##` are recorded as each is ratified. The public privacy **notice** (`pbe400.org/privacy/`) is *your* editorial artifact, not one of the eight delivered docs — notice addenda are flagged for your action.

| Item | Worksheet (§12) | Delivered docs | `DECISIONS.md` |
|---|---|---|---|
| P1 | (a) fix | `ENGINEERING-DESIGN §6.2` (amends D62) | **D88** |
| P2 | (b)/(d) | — (D77 governs; Book→notice link on build checklist) | — (D77) |
| P3 | (b) | — (D77 governs) | — (D77) |
| P4 | (a) fix | `DATABASE-SCHEMA §3.1`/`§9`, `PRD §5.7.3` | **D89** (amends D45/D59) |
| P5 | (b)+copy (a) | `ENGINEERING-DESIGN §5.3`, `DATABASE-SCHEMA §9`, `PRD §6.3`, `USER-MANUAL §8` + helper copy | amends **D59** |
| P7 | (a) fix | `DATABASE-SCHEMA §7`, `API-SPEC §6`, `ENGINEERING-DESIGN §2.5` | **D94** |
| P8 | (b) | — (D77 governs) | — (D77) |
| P9 | (a) fix | `ENGINEERING-DESIGN §2.7`/`§6.4` (with S14, Session 5), `§6.1` | — (folds into S14) |
| P10 | (a) fix | `ENGINEERING-DESIGN §6.1`, `§6.6` | amends **D61** |
| P11 | (b) + guidance | `ENGINEERING-DESIGN §1.6` (ratify D76), `USER-MANUAL §2`; notice line | — (cross-ref U4) |
| P12 | (a) fix | `ENGINEERING-DESIGN §6.1` | **D91** (amends D61) |
| P13 | (a) fix | `DATABASE-SCHEMA §3.2`/`§9`, `PRD §5.7.3` | **D93** |
| P14 | (a)/(b) | `DATABASE-SCHEMA §3.1`/`§3.3`/`§9` | **D93** |
| P16 | (b) | `ENGINEERING-DESIGN §6.1`/`§6.3` (pin audit/backup numbers) | — (D77) |
| P17 | (b) + disclose | `DATABASE-SCHEMA §7`; notice/manual line | — (D23 governs) |
| S9 | (a) fix | `DATABASE-SCHEMA §10`, `ENGINEERING-DESIGN §5.3`/`§6.6` | — (closes C4 facet) |
| S12 | (a) fix | `ENGINEERING-DESIGN §6.1`/`§5.3`, `PRD §5.6.8` | **D92** (amends D41/D61) |
| C5 | (a) fix | `PRD §4.1` | — (D55/D80 govern) |
| C7 | (a) fix | `ENGINEERING-DESIGN §5.3`, `PRD §4.1`/`§5.8` | **D90** (amends D59) |

`D88`–`D94` are provisional drafts; the resolution pass (TRIAGE-PLAN §6) finalizes and renumbers. **Notice addenda for your action:** P5 (MITAA always-flow honesty), P11 (shared-machine guidance), P17 (photo visibility), and — only if P12 ever goes cloud-LLM — the log-agent egress.

---

## The questions, consolidated

Most of the session is ratify-and-move-on (P2, P3, P8, P9, P10, P16, P17, S9 — and the documentation half of C5). These are what I actually need from you, grouped:

**The Mixpanel call (P1):**
1. Ratify **drop `name`**; then decide **raw email vs. hashed/uuid `distinct_id`** (the latter reopens D81), **keep vs. drop `role`**, and **keep vs. drop `ignore_dnt: true`**. *(I lean keep-email / keep-role / **drop `ignore_dnt`** — all three yours.)*

**The MITAA cluster (P4 · P5 · C7):**
2. **P4** — default `allowShareWithMITAA` **opt-in/false (recommended)**, keep open, or seed from prior consent?
3. **P5** — ratify the always-flow; approve **fixing the misleading toggle copy**; **formal vs. informal** use-limitation with MITAA?
4. **C7** — a **small dedicated consent-aware export (recommended)** or a specified manual two-pass?

**Third-party data (P13 · P14):**
5. **P13** — `shareEmergency` **default-off (recommended)**; manager-only visibility too?
6. **P14** — add a **`shareSpousePartner` toggle (recommended)**, its default, and leave the professional fields public?

**The remaining values calls:**
7. **P11** — keep `private, no-cache` + shared-machine guidance **(recommended)** vs. `no-store`? *(Note: sharpens U4, Session 6.)*
8. **P12** — log-reader agent **first-party/local (recommended)** vs. cloud-LLM-with-disclosure vs. defer?
9. **S12** — add the **lightweight export-audit ping (recommended)** vs. accept no trail?

**Two quick confirms:**
10. **P7** — confirm the headshot-purge window length.
11. **C5** — keep mark-deceased **manager-allowed (recommended, given D80)** vs. admin-only/step-up? And confirm **P2**'s Book→notice login-link is on the build checklist.

*— Drafted 2026-06-09 in-session for review before live Session 3. Next: you redline these proposals, then we run the live Session 3 triage in this same session to record dispositions into the §12 worksheet and any `D88+`. Next session after: Session 4 — Write-integrity / Ghost seam (+ restore).*
