# PBE Address Book — User Manual

> **Status: draft.** This manual is authored during planning from the settled design. Its wording and structure will be completed and refined once the interface is built and can be seen and photographed — screenshots, final button labels, and small UI details are still to come. The **per-control help reference** in §10 is the **single source** for the help text shown inside Book itself (see §11); the narrative sections describe how to *use* the app and are written here.

## 1. What Book is

Book is the online address book for the living brothers of Phi Beta Epsilon. It lets you look up any brother's contact information, keep your own information current, and — if you help run PBE — manage the membership behind the scenes. It is members-only: you reach it through the PBE website at `pbe400.org`, and only PBE brothers can sign in.

Book is designed to be used without a manual. Wherever a control isn't obvious, the page itself explains it, right where you are working. This manual exists as a reference and a place to read about Book away from the screen — but if you ever find yourself reaching for it to get ordinary things done, that's a sign we have more design work to do, and we'd like to hear about it.

A note on who Book is for: the brothers of PBE range in age from as young as 18 to as old as their 90s and will access Book using devices ranging from cellphones to desktop computers, some over very slow connections and some over very fast ones. Book is built with this range squarely in mind — large enough text, clear labels, full keyboard operation, a dark mode, and adjustable font sizes. If anything is hard to read or hard to operate, that is a bug in Book, not a failing on your part.

## 2. Getting started — signing in

You reach Book through the PBE website. Sign in to `pbe400.org` the way you normally do to read PBE News, then follow the link to the Address Book. Book recognizes you from your PBE website sign-in — there is no second password to remember, and there is no separate Book account to create.

**If Book doesn't recognize you.** Book matches you by the email address on your PBE website membership. If that email isn't yet in the address book, Book will tell you it can't find you and ask you to contact an administrator. This usually means the address book simply doesn't have your current email yet; an administrator can add it in a moment. (PBE's records have grown over the years from several old mailing lists, so a few brothers are on file under an out-of-date address — this is the most common reason sign-in doesn't work the first time.) A small number of brothers have no email address on file at all, or have not yet been matched to a record; they cannot sign in themselves, and their information is kept current by the membership staff on their behalf.

**Staying signed in.** Book keeps you signed in for a few hours and then asks you to sign in again, so that a shared or public computer doesn't stay open to your account indefinitely. When it does ask again, it tells you clearly and brings you back to sign in — and if you happen to be in the middle of editing your profile, your changes are kept while you do. You can also sign out yourself at any time: a **Sign out** control sits in the top corner of every page, beside your profile icon, and ends your Book session at once — worth using whenever you've been on a shared or public computer.

## 3. Finding brothers — the Directory

The **Directory** is Book's home page: a searchable, sortable list of every brother. By default it shows living brothers, sorted by name.

**Searching by name.** The Name Search box near the top finds brothers by name. It is forgiving: it tolerates misspellings, matches names that *sound* alike, and knows common nicknames — so "Bill" finds "William" and "Tom" finds "Thomas" — letting you find a brother even if you aren't sure how his name is spelled or what he goes by formally. It searches names only — first, last, middle, and the mug (nickname) — not class years or majors; those you narrow with the filters instead.

**Filtering.** The filter panel lets you narrow the list — by class year, major, city, state or province, country, and (for managers and admins) a few additional fields. Filters combine sensibly: choosing two majors shows brothers in *either*, while also setting a class-year range shows only brothers who match *both*. The class-year filter is more capable than it looks — it accepts single years, ranges, and lists together (for example, `1980-1989, 1992`); the page's own help explains this where you type.

**Sorting.** Click a column heading to sort by that column; click again to reverse it. Whatever you sort by, brothers with the same value fall into name order, so the list never looks arbitrary.

**Stars.** The star in each row is yours alone — a private bookmark. Star the brothers you look up often, then turn on **Starred only** to see just them. Your stars are visible only to you, and the starred view shows your starred brothers whether or not they're living.

**Brothers who have passed.** Out of respect, the Directory shows living brothers by default. Turn on **Include deceased** to see brothers who have passed; they are marked clearly, with an "In Memoriam" note, and their pages show only the information appropriate to share in memory. Where the dates are known, a brother's page shows the years he lived — for example, "1940–2024."

**Opening a brother's page.** Click a brother's name to open his full profile. As with any link, you can open it in a new browser tab if you like (the usual Ctrl-click or middle-click), and the Back button returns you to exactly where you were in the list.

## 4. Your own profile

Open your own profile from the person icon in the top corner of every page. You'll see it first in **view** mode; the **Edit** button switches to editing. Book is the one place to keep your information current — your PBE News email settings included — so a change you make here is the change everywhere.

**Editing and saving.** Edit any field, then **Save**. If you try to leave with unsaved changes, Book warns you first. In the rare case that someone else (an administrator, say) changed your profile while you had it open, Book won't silently overwrite their change or lose yours — it tells you what changed and lets you reconcile, so no edit is quietly lost.

**Your contact preferences — the switches.** Several settings on your profile are simple two-position switches, each labeled in plain words for exactly what it controls — what you will and won't receive, or who can and can't see a given piece of information. Each switch shows, in plain language, what it is doing right now ("Brothers can reach you by email"); the consequence of the other position is a tap away under the small "?" beside it, so nothing is hidden behind jargon. Most of these start in the open position — but the ones that govern sharing *beyond* the brotherhood start *off*, so that kind of sharing happens only if you deliberately turn it on. Those are **Share with the MIT Alumni Association** (a master switch over your contact information — see §8) and the switches over your **emergency-contact** and **spouse-or-partner** information.

**Hiding yourself from the directory.** If you'd rather not appear in the directory for other brothers, you can mark your record **Unlisted** on your profile. You remain a full member — you can still sign in, and you still receive PBE News — but other brothers won't see you in the directory or find you by searching. Managers and administrators can still see your record so the staff can keep it current, and an administrator can set or clear this for you if you ask. Most brothers leave themselves listed, since the directory is only useful when people are in it; this is here for the few who want it.

**Your photo.** You can add or change your headshot. After you choose a photo, Book lets you crop it to a square before saving; the cropped photo is staged until you press Save, so you can cancel and start over without affecting your current picture.

**Keeping your profile verified.** When you edit and save your own profile, Book marks it **verified** as of that date — your way of telling other brothers the information is current and confirmed by you. If it's been a couple of years since you last confirmed it, Book gives you a gentle nudge to take a look. (When an administrator edits your profile on your behalf, it is *not* marked verified, since only you can confirm your own details.)

## 5. Looking up another brother

Another brother's profile shows the contact information he has chosen to share. If he has turned a particular detail off, you simply won't see it — Book never shows you information a brother has asked to keep private. You can't edit another brother's profile (unless you're a manager or admin acting in that role; see §§6–7), but you can star him, and from his page you can get back to the Directory with the Back button.

## 6. For managers

If you help maintain the membership, you may have a **manager** role, which the badge by your name will show. Managers see everything a brother sees, plus a few additional fields that help with membership upkeep, and managers can **export** a filtered list from the Directory for offline work. Managers see a brother's privacy and consent settings and the dates on his record, but — like everyone else — a manager does not see a contact detail a brother has chosen to keep private; only an administrator can see through those settings. Managers can correct a brother's information; note that correcting another brother's profile removes its "verified" mark, because only the brother himself can confirm his own details.

## 7. For administrators

Administrators have full access. Adding, removing, and re-rolling brothers are admin actions, and there is a dedicated **Admin** page for the whole-membership operations that run online.

**Adding and removing brothers.** A new brother is added from the **Add Brother** page, reached from the Directory, where you enter his Constitution-roster details. From a brother's own profile, an administrator can change his role or, with a deliberate typed confirmation, delete him; Book prevents removing the last administrator, so you can't accidentally lock everyone out.

**De-brothering a member.** In rare and serious circumstances a brother may be removed from the brotherhood ("de-brothered"). This is an administrator action, taken from the brother's own profile behind a deliberate confirmation. De-brothering hides the record from all brothers (managers and administrators still see it, with the name shown struck through), removes the member's PBE website account so he can no longer sign in to the website or to Book, stops all PBE News email to him, and keeps his information out of any sharing with the MIT Alumni Association. It can be **reversed**: reinstating a de-brothered member restores his settings and re-creates his website account.

**The Admin page** gathers the whole-membership operations that remain online in Book:

- **Download a backup.** Produce a complete backup of the address book — the data plus a folder of the headshot images. A backup also runs automatically every day. Once you download an archive, it is outside Book's protections and holds every brother's information, so you are its **custodian**: keep it somewhere safe and delete old copies you no longer need.
- **Sync with Ghost.** Check the address book against the PBE website's member list and present the differences in a report for you to act on. The report is read-only into Book for every field but one: where a brother has unsubscribed from PBE News on the website — or changed that setting in Book — the two are reconciled automatically to whichever change is the more recent, so an unsubscribe is always honored. Every other difference is reported for you to resolve by hand. Each run also produces a **bounce report** — the brothers whose PBE News email is bouncing — for your records; this is a report only, not shown elsewhere in Book.
- **Post a message to everyone.** Set an optional **banner** that appears across the top of every page in Book — to announce a maintenance window or a deadline, say. You write the message and choose whether it reads as an ordinary notice or a warning; it stays up until you clear it. It works like, but is separate from, the banner on the PBE website.
- **Review bug reports.** When a brother uses the "Report a bug" link, the report is saved here for you to review. By design, Book does **not** email it to anyone.

**Restoring from a backup** is *not* a button on the Admin page. It is the single most destructive thing you can do — it replaces everything — so it is performed as an **offline maintenance procedure**: Book is taken down, its data is replaced from a backup, and it comes back up on the restored data. If you ever need a restore, it is an operator task, not a click.

**Loading a batch of updates from a spreadsheet** (for example, reconciling against the MIT Alumni Association) is **not part of the first release**. In practice those corrections amount to a handful of individual edits a year, so they are made by hand for now; a bulk-import tool may be added later if a real need for one emerges.

Because Book is the single place where member information lives, the PBE website's own member-editing is turned off and its account screen sends brothers to Book instead. When you add, edit, or remove a brother in Book, the few things the website needs — name, email, and the two PBE News email preferences — are updated on the website automatically.

## 8. Your privacy and how your information is shared

Book shows each brother only what the brother whose page it is has chosen to share, and that enforcement happens on Book's server — hidden information is never sent to another brother's browser, so "private" really means private. The one detail every signed-in brother can always see is a brother's **headshot**: photos carry no per-brother privacy switch, just as the printed directory always showed them. Everything else on a profile is either public by nature or governed by the switches described in §4.

Two kinds of sharing reach beyond Book itself, and both are under your control on your profile:

- **PBE News email.** Your newsletter and comment-reply email preferences live on your Book profile and govern what PBE News sends you. Changing them here changes them on the PBE website too.
- **The MIT Alumni Association.** The **Share with the MIT Alumni Association** switch controls whether your contact information may be included when PBE shares data with the MITAA. It starts **off** — PBE shares your contact information with the MITAA only if you deliberately turn it on. Turned on, PBE may include your full contact set; turned off, it shares none of it. Either way, your **emergency-contact** information is *never* shared with the MITAA, and basic facts that are already public — your name, class year, and, sadly, news of a brother's passing — always flow regardless, because that is MIT's own membership data. PBE's privacy notice describes this as well.

You can read PBE's full privacy notice at any time: there is a link to it in the **footer at the bottom of every page** (it is also shown when you first sign in).

## 9. Reading and operating Book comfortably

Book is built to be comfortable to read and operate:

- **Dark mode.** Switch between a light and a dark appearance, or let Book follow your device's setting.
- **Font size.** Make the text larger in a few steps; the whole interface, including the help icons, grows with it.
- **Keyboard.** Everything in Book can be operated from the keyboard, in a sensible order, without a mouse.
- **Screen readers.** Labels and help text are announced by screen readers, and the help bubbles read their contents aloud when opened.

These settings are remembered on the device you set them on.

**If something looks wrong.** Every page has a **"Report a bug"** link near your profile icon at the top — use it whenever something doesn't work or doesn't look right, and the report goes straight to the people who run Book. From time to time you may also see a **message banner** across the top of the page (an announcement from the administrators) or, if Book is briefly down for maintenance, a "check back shortly" page — both are normal. And the very first time you open Book after a quiet stretch, it may take a few seconds to wake up; a **"Loading…"** note lets you know it's working.

## 10. Help reference (the single source for in-page help)

This section is the reference text for the guidance Book shows inside its pages. Each entry corresponds to a control whose purpose or usage isn't self-evident — Book deliberately does *not* clutter obvious controls (Save, Cancel) with help. In the running app, the **helper text** appears beneath the control, the **placeholder** appears as a light example inside an empty field, and the **toggle-tip** is the explanation revealed by the small "?" (question-mark-in-a-circle) beside the control. The same text is the source for this reference, so the two can never disagree (see §11).

### Name Search (Directory)
- **Label:** Name Search
- **Helper text:** Searches names only — first, last, middle, and mug names. Use the filters for class year, major, or location.
- **Placeholder:** Search by name — e.g., Smyth, or Lissajous
- **Toggle-tip:** Type any part of a brother's name. Spelling doesn't have to be exact: Book tolerates typos and matches names that sound alike, so "Smith" still finds "Smyth." It searches names only — to narrow by class year, major, or location, use the filters below.

### Class year (Directory filter and Profile)
- **Label:** Class year
- **Helper text:** Accepts a single year, a range, or a list — e.g., `1980-1989, 1992`.
- **Placeholder:** e.g., 1984 or 1980-1989, 1992
- **Toggle-tip:** Enter one year (`1984`), a range with a hyphen (`1980-1989`), or several of either separated by commas (`1980-1989, 1992`). On a brother's own profile this is a single year; in the Directory filter you can combine years and ranges to gather a whole span of classes at once.

### Constitution ID filter (Directory, managers/admins)
- **Label:** Constitution ID
- **Helper text:** Accepts a single ID, a range, or a list — e.g., `5200-5219, 5230`.
- **Toggle-tip:** The Constitution ID is a brother's permanent PBE number. Filter by a single ID, a hyphenated range, or a comma-separated list, the same way as class year.

### Majors — ordering (Profile)
- **Label:** Majors
- **Helper text:** Drag to reorder. The major listed first is the one shown in the Directory.
- **Toggle-tip:** Add each major you studied. Drag the chips — or use the keyboard — to order them; the one you place first is the major shown beside your name in the Directory listing. You can list more than one.

### Big Brother (Profile)
- **Label:** Big Brother
- **Helper text:** Start typing a brother's name and choose from the list.
- **Toggle-tip:** Begin typing your Big Brother's name and pick him from the suggestions, so the link points to the right brother. Your Little Brothers are filled in automatically from the other direction — you don't enter them here.

### Verify (Profile)
- **Label:** Verify
- **Helper text (owner):** Confirm your information is current. Saving any change verifies it automatically.
- **Helper text (manager/admin):** Editing another brother's profile removes its verified mark, since only he can confirm his own details.
- **Toggle-tip:** "Verified" means the information has been confirmed as current. When you edit and save your *own* profile, Book marks it verified as of that date. A correction made by someone else removes the verified mark, because only the brother himself can vouch for his details.

### Share with the MIT Alumni Association (Profile)
- **Label:** Share with the MIT Alumni Association
- **Helper text (on):** PBE may occasionally share your contact information with the MIT Alumni Association.
- **Helper text (off):** PBE will not share your contact information with the MIT Alumni Association.
- **Toggle-tip:** This switch controls whether your contact information may be included when PBE shares data with the MIT Alumni Association. It starts off. Turned on, PBE may include your full contact set; turned off, none of it. Your emergency-contact information is never shared either way, and public facts — your name and class year — always flow, because they are MIT's own data.

### Alternate email (Profile)
- **Label:** Alternate email
- **Helper text:** A secondary contact address. Your primary email is the one you sign in with.
- **Toggle-tip:** An optional second address where brothers can reach you. It is a contact detail only — you sign in with your primary email, and PBE News is sent to your primary email, not this one.

## 11. How the help stays in step with this manual

The guidance Book shows on its pages and the §10 reference above are **one source, not two.** The help text lives in a single place in Book's code — a structured set of entries, one per control — which the running app reads to render its in-page help, and from which the §10 reference is assembled. A help string is therefore written once and appears in both places identically; the two cannot drift apart over time.

Each entry has a small, fixed shape:

| Field | Meaning |
|---|---|
| `id` | A stable identifier for the control (e.g. `directory.nameSearch`, `profile.classYear`). |
| `label` | The control's visible label. |
| `helperText` | The always-visible line beneath the control, announced by screen readers on focus. Optional. May vary by role, or by the control's current state, where noted (e.g. the Verify text differs for an owner versus a manager; a two-position switch states the consequence of its *current* position, via its on/off helper text). |
| `placeholder` | A light example shown inside an empty field, which clears the instant you type. Never carries essential instructions. Optional. |
| `toggleTip` | The deeper "what is this and how do I use it" explanation revealed by the "?" control. Optional. |

A control that needs no help simply has no entry; help is provided only where a control isn't self-evident. When the interface is built, the §10 entries above seed this source, and this manual's reference section is generated from it thereafter.
