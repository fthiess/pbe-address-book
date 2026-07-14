# PBE Address Book — UAT Plan (Phase 7.7)

Adopted 2026-07-14 (DECISIONS **D132**). This plan governs **Phase 7.7 — user-acceptance testing**: real, non-developer PBE brothers exercising Book on staging, against fake data, before any production work begins. It replaces the earlier placement of UAT inside Phase 8 (`CODING-PROJECT-PLAN.md` §9) and resolves the platform fork N64 deliberately left open. The production cutover itself is a separate plan (`CUTOVER-PLAN.md`, currently a stub filled in at Phase 8 planning).

## 1. Purpose and philosophy

Book's UAT is not really about "acceptance." It is the first exposure of the product to its actual audience — a cohort that includes brothers 60+, on slow connections, with vision and fine-motor needs — and its purpose is to **gather feedback and find bugs before launch**. Testers will find defects we fix and suggest improvements we mostly adopt; they are not signing off on anything. The name is kept because it is the conventional one for this phase.

Two firm boundaries, carried over from N64 and unchanged by this plan:

- **Fake data only, non-production only.** Testers create, edit, and delete freely with zero risk to real brothers. No real member data is ever loaded for UAT.
- UAT stays on the test-data side of the line that the real-data migration dry-run and go-live sit on. Those remain Phase 8 activities.

The one piece of real information in the environment is the testers themselves: their accounts carry their **real names and email addresses** (§5), by design.

## 2. Placement in the build

UAT is **Phase 7.7**, strictly after Phases 6 (help + manual), 7 (hardening), and 7.5 (client cache unification). All three are genuine prerequisites: the in-page help must exist so UAT tests whether it actually helps; hardening (analytics, logging, backups, full E2E/a11y, perf-at-scale) should precede a 15-person cohort; and 7.5's byte-efficiency work matters most to exactly the audience being recruited.

A new small **Phase 7.6 — Ghost↔Book theme integration on staging** (§8) precedes it in numbering, but 7.6 has no dependency on 6/7/7.5 and can run any time before UAT.

Several preparation items can — and should — start early, in parallel with the remaining build phases:

| Early-start item | Owner | Ticket |
|---|---|---|
| Recruit testers (invitations, volunteer list) | Forrest | — (process, §4) |
| Generate the fake photo corpus (~200 × 1024² PNG) | Forrest | OFC-249 (corpus half) |
| Outbound-email fix for Ghost-staging | Forrest | OFC-252 |
| Phase 7.6 theme integration + staging test content | either | OFC-250, OFC-251 |

The tooling tickets (OFC-248, OFC-249) are ordinary Book sessions and can likewise be scheduled whenever convenient before UAT setup.

## 3. Environment and data policy

**Platform: the existing staging environment** (`pbe-book-staging.web.app` + Ghost-staging at `staging.pbe400.org`). This resolves N64's deferred fork as its option (a), with one refinement the fork's framing missed: *code* deploys and *data* reseeds are separable, so "frozen" applies only to the data layer.

- **During the UAT window, the repository variable `STAGING_AUTOSEED` is set to `false`.** Merges to `main` still auto-deploy code to staging — testers see fixes and improvements as soon as they land, which is the point of running UAT and remediation concurrently — but the reseed step is skipped, so tester links, role upgrades, profile edits, and photos survive every deploy. Regressions slipping through are an accepted risk on a test environment (Forrest's call, D132).
- **A full manual reseed remains available at any time** and reproduces the complete UAT state in one pass: fake profiles → Ghost mirror → tester roster → photo corpus (§5–§6 give the pieces). The known cost: a mid-window reseed wipes testers' in-progress edits (accepted, D132). Use it for data-shape fixes or a deliberate clean slate.
- **Post-UAT, staging returns to normal**: `STAGING_AUTOSEED` back to unset/`true`, wipe-reseed on every deploy (N18/N90). Because the tester roster is applied *inside* the reseed step (§5), selected brothers can retain staging access indefinitely — the standing "friendly testers on staging" capability Forrest wants beyond UAT — with their accounts deterministically recreated on every deploy (edits don't persist in that mode, which is fine for spot-testing PRs).

The Ghost side: staging profiles get real `ghostMemberId`s via the existing `mirror:ghost-staging` delta reconcile, so the Book→Ghost write path behaves as it will in production (a tester editing their email/name/newsletter flag exercises the real Ghost-first-gated push against Ghost-staging). UAT setup runs the mirror as part of seeding.

## 4. Tester cohort and recruitment

**Invited:** roughly 30 brothers. **Expected volunteers: 10–15** (⅓–½ acceptance). Forrest emails the invitation (template: Appendix A); brothers volunteer by replying. Only volunteers are provisioned — no accounts are created for non-responders.

The invitation states plainly the one privacy fact that matters: **volunteers' real names and email addresses will be visible to the other testers** inside the UAT environment (it is a fraternity directory; the cohort is all brothers). Everything else in the environment is fake, and anything a tester types into their own profile is theirs to choose — real or invented. No signed releases; the notice in the invitation suffices (Forrest's call, D132).

## 5. Tester provisioning

Mechanism: **OFC-248**, `seed:staging-testers` — a generalization of the current single-tester `link:staging-tester` script.

**The roster** is a CSV with columns `profileId` (fake-range, default-assigned from #5001 upward), `firstName`, `lastName`, `classYear`, `email`, `role`. Because testers appear under their real names, **the roster must never enter the public repo**: it lives as a **private GCS object** in the `pbe-book-staging` project. The deploy workflow already authenticates to that project via WIF, so CI reads it with no new secrets; the same file works for local runs. Forrest edits it with a one-line `gsutil cp`.

**What the tool does** for each roster row, idempotently: overwrite the designated fake profile with the tester's real name, class year, and email; set the role; make the record listed, living, and email-visible; **blank the remaining personal fields** — address, professional, links, big brother, and the rest — because *"fill in your profile" is deliberately the testers' first task* (Forrest's call, D132: account setup becomes end-to-end coverage of the edit path, the highest-value flow to watch real users attempt). It then delta-reconciles the matching **Ghost-staging members** (create/update, scoped to roster emails) so each tester can sign in through the real bridge, and writes the `ghostMemberId` back.

**Wiring:** the tool runs at the end of the deploy workflow's reseed step (after `seed:staging` / `seed:staging-images`), so *any* reseed — automatic or manual — lands with the testers present. It subsumes the old `STAGING_TESTER_EMAIL` mechanism: Forrest's own admin account becomes roster row #1.

**Roles and the manager upgrade.** Testers start as **brother** — the role nearly all real users will hold. The tester instructions (Appendix B) promise: file at least one report through the in-app **"Report a bug"** control and Forrest upgrades your account to **manager**, unlocking the maintain-any-record layer (editing others' fields, the staff-internal admin note, CSV export, unlisted visibility) for further testing. The upgrade is a normal admin role change in the UI; Forrest also updates the roster row so the role survives any reseed. (Bug-report attribution works out of the box: `submitterName` snapshots the profile's name at filing, which is now the tester's real name — the motivating reason for real-name accounts.)

## 6. Fake photo corpus

Out of ~1,200 fake profiles, testers should see a directory that looks alive — real-looking faces, not eight recycled placeholders and a sea of initials-silhouettes. Mechanism: **OFC-249**.

- Forrest supplies **~200 AI-generated fake headshots**, square **1024×1024 PNGs** (1024² downscales cleanly through the existing sharp pipeline to the 512² headshot + 96² thumbnail WEBPs; below 512² would upscale).
- The corpus is uploaded once (manual step) to a **private fixtures prefix in GCS** in the staging project. Like the roster, it never enters the public repo.
- The image seeder gains an opt-in UAT source: map the corpus deterministically onto the first ~200 `hasHeadshot` fake profiles, encode through the same pipeline as real uploads, fall back to the committed placeholders for the rest, and skip roster-overwritten profiles (testers upload their own photo as a task — their choice whether it's a real one).

## 7. Outbound email — the hard prerequisite

UAT **must** exercise the real magic-link sign-in flow — it is precisely the step the 60+ audience will stumble on at launch, so bypassing it via `DevIdentityProvider` would test around the riskiest UX in the system. That means Ghost-staging must deliver mail to 10–15 arbitrary addresses, and its current Mailgun **sandbox** mode caps delivery at ~5 pre-authorized recipients.

**Forrest owns this fix (OFC-252), before UAT setup.** Baseline plan: a short-term paid Mailgun account covering 30–40 recipients; alternatives under investigation include a verified sending domain on Mailgun, a free-tier transactional SMTP provider (e.g. Brevo), or Gmail app-password SMTP. Staging sends no newsletters — magic-link transactional mail only — so any Ghost-supported SMTP provider works. This is a della2/self-hosted-Ghost config change, outside the Book repo. Done means: a magic link delivers to an arbitrary, non-pre-authorized address.

## 8. Phase 7.6 — Ghost↔Book theme integration and staging content

Before testers arrive, the *newsletter side* of the composite system must look the way it will at launch, so the cohort experiences the real navigation: articles on Ghost-staging linking into Book, and Ghost's account-management entry points landing on Book instead of Ghost's member portal.

Phase 7.6 (sequenced in `CODING-PROJECT-PLAN.md` §7; no dependency on Phases 6/7/7.5):

- **Theme work (OFC-250)**, in the `pbe-news-ghost-theme` repo: repoint the theme's member account-management links at Book; sweep for other integration touches. Deployed **to Ghost-staging only** (manually, as always — themes have no CI/CD); `pbe400.org` stays on the current non-Book theme until cutover, making the theme diff a cutover artifact (`CUTOVER-PLAN.md`). If the auth-bridge files are touched, the byte-identical `ghost-bridge/` mirror in this repo is updated in the same change.
- **Test content (OFC-251)**, on Ghost-staging: a little article content with plain HTML links into Book-staging (directory, a profile) so the article→Book→article path exists for the task script. Content work, no code.

**Gate:** a signed-in member on Ghost-staging can follow an article link into Book and reach account management from the Ghost site's UI, landing on Book.

## 9. Running the UAT

**Window: 2–3 weeks.** Long enough for two rounds of fix-and-retest, short enough to hold volunteers' interest (Forrest's call). Continuous deploys during the window keep giving testers new things to look at.

**Kickoff.** When prerequisites are green (email fix, 7.6 deployed, roster + photos seeded, autoseed off), Forrest sends volunteers the instructions email (Appendix B): how to sign in, the task script, how to give feedback, the manager-upgrade offer, and the reminder that the data around them is fake and resettable.

**Feedback channels, two and only two:**

- **In-app "Report a bug"** for anything broken or confusing in place — it auto-captures route, URL, and client context, and lands in the admin queue attributed to the tester's real name.
- **Plain email to Forrest** for suggestions, impressions, and anything that isn't a bug.

**Triage.** Forrest reviews the bug-report queue and his inbox on a regular cadence (daily is realistic at this scale). Every actionable item becomes a Linear ticket in PBE-Book labeled **`UAT`**, severity-triaged: *fix-during-UAT* (bugs, quick wins — the normal branch → PR → merge loop, deployed to staging automatically, tester notified to re-try) versus *post-UAT* (larger improvements → triaged into fix-before-cutover or post-launch). Book's queue stays triage-and-clear (N60/N61): reports are copied into Linear and deleted; Linear is the tracker.

**Mid-point nudge.** Halfway through the window, a short email: thanks, what's been fixed so far (testers love seeing their bugs die), a nudge to those who haven't started, and a reminder of the manager-upgrade offer.

**Mobile and accessibility emphasis.** The instructions explicitly ask testers to try Book **on their phones** as well as desktop (the 5.5h mobile work gets its first real-user exercise), to note anything hard to read, click, or understand, and to report load times that feel slow — this cohort *is* the accessibility and slow-connection audience the product is designed for, so their friction reports are first-class findings, not noise.

**Close.** At window end: a thank-you email to all participants (with a preview of what launch will look like), and the wind-down of §10.

## 10. Exit criteria and wind-down

Phase 7.7 is complete when:

1. **All `UAT`-labeled bugs of high severity are fixed and live-confirmed on staging.** (Normal Gate-5 discipline — a fix isn't done until confirmed, by Forrest or by the reporting tester.)
2. **Every remaining `UAT` item is explicitly triaged** into *fix before cutover* (stays on the board blocking Phase 8) or *post-launch backlog* — nothing left undecided.
3. **Participation was real**: at least ~8 testers completed the task script (best effort — if volunteering falls short, Forrest decides whether the coverage achieved suffices).
4. **Wind-down executed**: `STAGING_AUTOSEED` restored, the roster trimmed to the brothers keeping standing staging access, testers thanked, and the UAT experience written up briefly in the decision log (what the cohort taught us — input to CUTOVER-PLAN's staged-exposure thinking, since some UAT testers are natural candidates for the early-exposure ring at launch).

## 11. Out of scope

- **The production deploy workflow** (manual promotion, `prod.env`, `pbe-book-prod`) — cutover machinery, designed in `CUTOVER-PLAN.md` (ticket OFC-253).
- **The real-data migration dry-run and everything in `PRE-LAUNCH-TOOLS.md`** — Phase 8, unchanged by this plan.
- **Production Ghost.** Nothing in UAT touches `pbe400.org` beyond the unchanged live theme continuing to serve the auth bridge route.

---

## Appendix A — Invitation email (draft)

> **Subject: Help us test the new PBE Address Book (15–30 minutes, at your leisure)**
>
> Brothers —
>
> Over the past months we've been building **Book**, a members-only online directory of the brotherhood — around 1,200 brothers, searchable, with photos, class years, and contact information each brother controls himself. It will launch alongside PBE News later this year.
>
> Before launch, I'd like a dozen or two brothers to try it out and tell me what's broken, what's confusing, and what would make it better. If you're willing, reply to this email and I'll set you up with a test account. Plan on 15–30 minutes of poking around over a couple of weeks, whenever suits you — laptop, tablet, or phone.
>
> Two things to know. First, **everything in the test system is fake** — invented brothers, invented addresses, computer-generated photos — so you can click, edit, and experiment freely; you cannot break anything that matters. Second, the exception is the testers themselves: **your real name and email address will be visible to the other testers** (all brothers), just as they will be in the real directory at launch. Anything else you choose to put on your own test profile is up to you — real or invented.
>
> Reply and I'll send you instructions.
>
> Fraternally,
> Forrest

## Appendix B — Tester instructions and task script (draft)

> **Subject: Your PBE Address Book test account is ready**
>
> Thanks for volunteering! Your account is set up. Here's how to start, and a short list of things I'd like every tester to try. After that — roam free. The system is all fake data (except the testers' own names), and I can reset it at any time, so nothing you do can cause harm.
>
> **Getting in.** Go to *[staging newsletter URL]* and click *[account/Book entry point]*, or go directly to *[Book-staging URL]*. Enter **this email address** and you'll be sent a sign-in link — there is no password. If no email arrives within a couple of minutes, check spam, then tell me.
>
> **The task list** (15–30 minutes, in any order, over any number of sittings):
>
> 1. **Sign in** via the emailed link. (If anything about this step is confusing, that alone is a valuable report.)
> 2. **Fill in your profile.** Your profile starts nearly empty — add whatever you like (it doesn't have to be real). Try the address, your degree/course, and picking a Big Brother.
> 3. **Add a photo** — yours or any picture you please. Try the crop tool.
> 4. **Explore the Directory.** Search a name (try a nickname — "Bill" should find Williams). Sort a column. Filter by class year. Star a few brothers and use the starred-only view.
> 5. **Visit a profile** and page through prev/next.
> 6. **Try it on your phone** as well as your computer.
> 7. **Use the help** ("?" markers) anywhere something isn't obvious.
> 8. **Report a bug** — the "Report a bug" control in the top bar. Report anything: a real defect, something confusing, something slow, something too small to read. **When you file your first report, I'll upgrade your account to the "manager" role**, which unlocks editing other brothers' records and exporting — then try those too.
>
> **Feedback:** bugs and confusions via the in-app control (best, because it tells me exactly where you were); ideas and general impressions by replying to this email. I'll be fixing things continuously — you'll often see a bug you reported fixed within a day or two, and I may ask you to re-try it.
>
> The test runs through **[end date]**. Thank you — you're seeing Book before anyone else, and your feedback will shape what the brotherhood gets at launch.
>
> Fraternally,
> Forrest
