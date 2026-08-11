import type { HelpContent, HelpEntry } from "./types.js";

/**
 * The single help-content registry, keyed by stable control id. Both the running
 * UI and the assembled USER-MANUAL (Phase 6c) read from here, so a help string
 * lives in exactly one place and the two cannot drift (D53) — USER-MANUAL §10 is
 * generated from this file by `npm run docs:help`, and the verification gate
 * fails on drift via `npm run assert:help-manual` (N118). Edit the copy here, then
 * regenerate. The **baseline**
 * layer (label + helperText — the AA instructions a control needs to be usable,
 * D111) ships with each page in its phase; the above-baseline `toggleTip`
 * enrichment (the `?` CircleHelp popover) and the switch `whenOn`/`whenOff` copy
 * were wired in Phase 6b.
 *
 * Toggle-tips are provided **only where a control isn't self-evident** (the plan's
 * Phase 6 discipline) — most controls carry a label and, where needed, a helper
 * line, and nothing more. Switch entries carry `whenOn`/`whenOff` (the inline
 * active consequence the switch states, D45/D113); a switch's `?` shows only its
 * optional static `toggleTip` (MITAA and Listed today) — the earlier
 * counterfactual-in-`?` was dropped as redundant with the inline consequence (N103).
 */
export const helpContent: HelpContent = {
  // ── Directory ────────────────────────────────────────────────────────────
  "directory.search": {
    key: "directory.search",
    label: "Name Search",
    // Accurate to the field's real function (D35/D123): name fields only, with
    // typo, sound-alike, and common-nickname tolerance. The placeholder stays
    // short so it never clips inside the field (placeholders can't scroll); the
    // example and capabilities live in helperText, never carried as essential
    // instructions in the placeholder (D111/§5.9).
    helperText:
      "Find brothers by name — handles typos, sound-alikes, and nicknames (Bill finds William).",
    placeholder: "Search by name…",
    toggleTip:
      "Name Search looks only at names — first, last, nickname, and mug name — and forgives typos, sound-alikes, and common nicknames (type Bill to find William). To narrow by class year, course, city, or country, use Filters below.",
  },
  "directory.columns": {
    key: "directory.columns",
    label: "Columns",
    helperText: "Choose which columns appear; drag a column header's grip to reorder.",
  },
  // The two numeric filters carried hardcoded labels and placeholders and no
  // registry entry at all until 6c-2 (OFC-283) — so they had no `?` help, and
  // generating USER-MANUAL §10 from this registry (N118) would have dropped the
  // range-and-list syntax the hand-written manual used to document. Forrest's
  // call: the need for a toggle-tip here was borderline, and the manual being
  // generated from the registry pushed it over.
  "directory.filter.classYear": {
    key: "directory.filter.classYear",
    label: "Class Year",
    placeholder: "e.g. 1980, 1985-1989, 1990-",
    toggleTip:
      "The year the brother and his pledge class associate with; usually (but not always) the same as his year of graduation. Enter a single year (1985), a list separated by commas, or a range. Ranges can be open-ended: 1985-1989 for a span, 1990- for that year onward, -1975 for up to that year.",
  },
  "directory.filter.constitutionId": {
    key: "directory.filter.constitutionId",
    label: "Constitution ID",
    // Real Constitution IDs top out around 1481; the old "5001, 5100-5200" came
    // from the fake-data range (ids > #5000) and read as nonsense to testers,
    // who have no reason to know the seed convention (OFC-374).
    placeholder: "e.g. 721, 900-1000",
    toggleTip:
      "The Constitution ID is the sequence number of the brother's signature on the PBE constitution. Filter by Constitution ID the same way as Class Year: a single number, a comma-separated list, or a range like 800-900 (open-ended ranges like 800- work too).",
  },
  // The filter UAT asked for most (OFC-379/D164). The `?` exists for one reason:
  // the field holds a brother's single *current* employer, so a former company
  // finds nobody — a limitation of the data model that the control itself cannot
  // show, and the exact thing a brother would otherwise read as a broken filter.
  "directory.filter.employer": {
    key: "directory.filter.employer",
    label: "Employer",
    toggleTip:
      "Finds brothers whose employer contains what you type — acme finds Acme Corporation. Only a brother's current employer is on record, so a brother who has since moved on will not turn up under a former company, and one who left the field empty will not turn up at all.",
  },
  // The three OFC-404/405/406 filters. Each `?` carries the same two facts a
  // brother cannot infer from an empty text box: that it matches anywhere inside
  // what the brother wrote, and that a brother who left the field blank is not
  // found by it at all — which matters far more here than for Employer, because
  // these fields are new and most of the roster will be empty for a long while.
  "directory.filter.postPbeEducation": {
    key: "directory.filter.postPbeEducation",
    label: "Post-PBE education",
    toggleTip:
      "Finds brothers whose post-PBE education contains what you type — stanford finds “Ph.D. in Computer Science, Stanford”, and law finds every brother who mentioned a law degree. Brothers who have not filled this in will not turn up.",
  },
  "directory.filter.sports": {
    key: "directory.filter.sports",
    label: "Sports",
    toggleTip:
      "Finds brothers whose sports contain what you type — soccer finds “Varsity soccer and basketball”. Brothers who have not filled this in will not turn up.",
  },
  "directory.filter.activities": {
    key: "directory.filter.activities",
    label: "Activities",
    toggleTip:
      "Finds brothers whose activities contain what you type — sailing finds “Sailing and choral singing”. Brothers who have not filled this in will not turn up.",
  },
  // Proximity (OFC-378). The `?` carries the three things the control cannot show
  // and that design §8 and §12 both identify as the feature's real failure mode:
  // that it is US-only, that a small town may be missing from the list of places
  // (about a quarter of brothers live in one), and that a ZIP code always works
  // when a town name does not. A brother who types his town, sees nothing, and
  // does not think to try his ZIP will conclude the feature is broken — this
  // sentence is the whole mitigation.
  "directory.filter.near": {
    key: "directory.filter.near",
    label: "Located near",
    toggleTip:
      "Finds brothers within the distance you choose of a place — start typing a town, a ZIP code, or another brother's name, and pick from the list. Smaller towns may not be listed by name; a ZIP code always works, and finds the brothers around it just as well. Proximity search covers the United States only — use the Country filter for brothers living elsewhere. Brothers who keep their address private will not be found by this filter.",
  },
  "directory.filter.willingToMentor": {
    key: "directory.filter.willingToMentor",
    label: "Willing to mentor",
    toggleTip:
      "Finds brothers who have said they are willing to provide professional information and advice.",
  },
  // The `?` carries the one thing the control cannot show: that choosing "Yes"
  // reveals deceased brothers on its own, without also ticking "Include deceased"
  // (D171). Without that sentence the two controls look contradictory.
  "directory.filter.deceasedOnly": {
    key: "directory.filter.deceasedOnly",
    label: "Deceased",
    toggleTip:
      "Shows only brothers who have passed. You do not also need to turn on Include deceased — choosing Yes here shows them by itself.",
  },
  "directory.filter.staff": {
    key: "directory.filter.staff",
    label: "Staff",
    toggleTip:
      "Use this filter to find PBE Address Book staff — the managers and administrators who have extra powers to help keep brother information up to date and to maintain the system.",
  },
  // Manager/admin only, like the columns they mirror. Both say what the state
  // means as well as what the filter does — "de-brothered" in particular is a rare
  // enough action that a new manager may never have met the term.
  "directory.filter.unlisted": {
    key: "directory.filter.unlisted",
    label: "Unlisted",
    toggleTip:
      "Shows only brothers who have asked to be left out of the Directory. Their records are hidden from other brothers entirely, but stay visible to managers and administrators, marked UNLISTED.",
  },
  "directory.filter.debrothered": {
    key: "directory.filter.debrothered",
    label: "De-brothered",
    toggleTip:
      "Shows only brothers whose membership has been revoked. Like unlisted records, these are hidden from other brothers and visible only to managers and administrators.",
  },
  "directory.filter.verification": {
    key: "directory.filter.verification",
    label: "Verification",
    toggleTip:
      "A record is verified when a brother confirms it's current — saving a profile stamps that day's date.",
  },
  "directory.filter.verifiedBefore": {
    key: "directory.filter.verifiedBefore",
    label: "Not verified since",
    toggleTip:
      "A record is verified when a brother confirms it's current — use this to find the ones going stale before a date you pick.",
  },
  "directory.export": {
    key: "directory.export",
    label: "Export CSV",
    toggleTip:
      'Export downloads a spreadsheet (CSV) of the brothers you\'ve selected, and offers you two of them. "Export displayed columns" gives you just the columns you have on screen, reading as they read here — the usual choice. "Export all data" gives you every field your role can see, which is what you want for a full backup or for loading into another system. Your selection is kept as you search and filter, so it can span the whole directory — not just the rows on screen now. Photos are never included.',
  },
  "directory.copyEmails": {
    key: "directory.copyEmails",
    label: "Copy Emails",
    toggleTip:
      "Copies the email addresses of the brothers you've selected to your clipboard, so you can paste them straight into an email. Your selection is kept as you search and filter, so it can span the whole directory — not just the rows on screen now. Brothers with no email address are left out, as are brothers who have chosen privacy — either keeping their address private or their whole record unlisted — and brothers who are deceased or de-brothered; the message afterwards tells you how many, and why. Up to 50 brothers can be copied at a time; managers and administrators have no limit, so ask a staff member if you need a longer list.",
  },

  // ── Profile: fields ──────────────────────────────────────────────────────
  "profile.fullLegalName": {
    key: "profile.fullLegalName",
    label: "Full name",
    helperText: "Including suffixes (Jr., III) and any compound names.",
    toggleTip:
      "Your full name as it should appear in a formal listing — including suffixes (Jr., III) and any compound or hyphenated names. The separate First / Middle / Last fields are what the directory searches and sorts on.",
  },
  "profile.classYear": {
    key: "profile.classYear",
    label: "Class year",
    helperText: "An optional 4-digit year.",
    toggleTip:
      "The year you and your pledge brothers associate with. Usually, but not necessarily, the same as your graduation year.",
  },
  // OFC-409 splits OFC-402's single widened field into two. OFC-402 was right that
  // the old label was too narrow, but the fix was insufficient: a mug name and the
  // name a brother goes by are different facts. "Robert" may have a mug name of
  // "Quantum All-Star" and still be called "Bob" — and a brother who wants his mug
  // name used simply enters it in both.
  //
  // ⚠ Both are `helperText`, NOT `toggleTip` (Forrest's call, reversing OFC-402's
  // move of this field's help behind the `?`). These two controls sit adjacent and
  // the *only* thing a brother needs is to tell them apart — guidance that has to
  // be readable without a click to do its job at all. Each string is one short
  // line, which is what `helperText` is for.
  "profile.nickname": {
    key: "profile.nickname",
    label: "Nickname",
    helperText: "The name you would like other brothers to call you by.",
  },
  "profile.mugName": {
    key: "profile.mugName",
    label: "Mug name",
    helperText: "The name printed on your PBE mug.",
  },
  "profile.email": {
    key: "profile.email",
    label: "Email",
    toggleTip:
      "This is the email address that PBE News and Address Book login links are sent to. Clearing this field will make it impossible for you to log in. If you just want to unsubscribe from PBE News or hide your email address, turn off the appropriate privacy switch under “Privacy & consent”, below.",
  },
  "profile.alternateEmail": {
    key: "profile.alternateEmail",
    label: "Alternate email",
    helperText: "Optional — a second address we can reach you at.",
  },
  "profile.links": {
    key: "profile.links",
    label: "Links",
    toggleTip:
      "Links to other websites with information about you that you'd like to share with other brothers.",
  },
  "profile.majors": {
    key: "profile.majors",
    label: "Courses",
    toggleTip: "These are the MIT courses in which you did substantial work toward a degree.",
  },
  // The three OFC-404/405/406 fields. Each `helperText` states the 120-character
  // cap, because the input simply stops accepting text at that point (Forrest's
  // call) and a limit a brother meets without warning reads as a broken keyboard.
  // Each `?` gives an example, which is the fastest way to convey "a phrase, not
  // an essay" — the shape all three requests asked for.
  "profile.postPbeEducation": {
    key: "profile.postPbeEducation",
    label: "Post-PBE education",
    helperText: "Up to 120 characters.",
    toggleTip:
      "Degrees or study you completed after PBE — for example “Ph.D. in Computer Science, Stanford” or “MBA, Wharton”. A short line rather than a full history; other brothers can filter on what you put here.",
  },
  "profile.sports": {
    key: "profile.sports",
    label: "Sports",
    helperText: "Up to 120 characters.",
    toggleTip:
      "Sports you play or follow — for example “Varsity soccer and basketball” or “Golf and fishing”. Other brothers can filter on what you put here, so it is a good way to be found by brothers who share them.",
  },
  "profile.activities": {
    key: "profile.activities",
    label: "Activities",
    helperText: "Up to 120 characters.",
    toggleTip:
      "Interests and affiliations outside work — for example “MIT Education Council and local board member” or “Shakespeare Ensemble and hang gliding”. Sports have their own field just above.",
  },
  // Keyed `profile.willingToMentor`, NOT `profile.consent.*` (N160): the key prefix
  // is what files an entry into a manual group, and this control lives in
  // Professional & personal beside Courses, not among the privacy switches. It is a
  // fact the brother publishes about himself, not a switch governing who may see
  // something he already entered — which is exactly why it moved.
  "profile.willingToMentor": {
    key: "profile.willingToMentor",
    label: "Willing to mentor",
    whenOn: "You are willing to provide professional information and advice to other brothers.",
    whenOff: "You're not in a position to help right now, but may opt in later.",
    toggleTip:
      "This switch is how you signal to other brothers that you are willing to take time to provide professional information, advice, and answer questions. It will eventually be connected to a PBE Mentoring program, which may ask for more of a time commitment, but for the time being only shows up as a filterable toggle on your profile.",
  },
  "profile.bigBrother": {
    key: "profile.bigBrother",
    label: "Big Brother",
    toggleTip:
      "Record the brother who was your Big Brother. You don't enter your Little Brothers here — they appear automatically from the profiles of the brothers who name you as their Big Brother.",
  },
  "profile.verification": {
    key: "profile.verification",
    label: "Verification",
    toggleTip:
      "“Verified” means the information in this profile was confirmed current as of the date shown. Saving your own profile re-verifies it as of today.",
  },
  "profile.adminNote": {
    key: "profile.adminNote",
    label: "Admin note (staff only)",
    helperText: "Visible to managers and administrators only — never to the brother.",
  },

  // ── Profile: privacy & consent switches (whenOn/whenOff = inline + counterfactual) ──
  "profile.privacy.shareEmail": {
    key: "profile.privacy.shareEmail",
    label: "Share email with brothers",
    whenOn: "Brothers can reach you by email.",
    whenOff: "Your email is hidden from other brothers.",
  },
  "profile.privacy.shareAddress": {
    key: "profile.privacy.shareAddress",
    label: "Share address with brothers",
    whenOn: "Your mailing address is visible to brothers.",
    whenOff: "Your mailing address is hidden from other brothers.",
  },
  "profile.privacy.sharePhone": {
    key: "profile.privacy.sharePhone",
    label: "Share phone with brothers",
    whenOn: "Brothers can reach you by telephone.",
    whenOff: "Your phone number is hidden from other brothers.",
  },
  // The off-copy names the field ("Your emergency contacts…") rather than the bare
  // "Visible to administrators only." it once carried: since 6b-5 these two switches
  // sit together in Privacy & consent, away from the fields they protect (OFC-270),
  // so each row must identify itself on its own — as the reachability switches do.
  "profile.privacy.shareEmergency": {
    key: "profile.privacy.shareEmergency",
    label: "Share emergency contacts with brothers",
    whenOn: "Your emergency contacts are visible to brothers.",
    whenOff: "Your emergency contacts are visible to administrators only.",
  },
  "profile.privacy.shareSpousePartner": {
    key: "profile.privacy.shareSpousePartner",
    label: "Share spouse / partner with brothers",
    whenOn: "Your spouse / partner is visible to brothers.",
    whenOff: "Your spouse / partner is visible to administrators only.",
  },
  "profile.consent.allowShareWithMITAA": {
    key: "profile.consent.allowShareWithMITAA",
    label: "Share with the MIT Alumni Association",
    whenOn: "May be shared with the MIT Alumni Association.",
    whenOff: "Will not be shared with the MIT Alumni Association.",
    toggleTip:
      "If set to allowed, PBE may share updates of your information with the MIT Alumni Association to help maintain their alum.mit.edu alumni directory.",
  },
  "profile.consent.allowNewsletterEmail": {
    key: "profile.consent.allowNewsletterEmail",
    label: "PBE News newsletter",
    whenOn: "You will receive PBE News by email.",
    whenOff: "You won't receive PBE News by email.",
  },
  // Presented as the positive "Listed in the directory" (on = listed/visible), so
  // it reads like every other privacy switch — the stored field stays `unlisted`,
  // inverted at the call site (N35). `listed` true is the visible state.
  "profile.consent.listed": {
    key: "profile.consent.listed",
    label: "Listed in the directory",
    whenOn: "You appear in the directory for all brothers.",
    whenOff:
      "You don't appear in the directory for other brothers; managers and administrators can still see your record.",
    // The last sentence is the D168 disclosure. It is not a nicety: a brother
    // choosing this switch is entitled to know the one place his record leaves a
    // mark, and the previous copy's "none of your information" overstated the
    // guarantee — the Big-Brother pointer is a `public` field on someone *else's*
    // record, so it was never ours to hide. What is hidden is who he is.
    toggleTip:
      "This switch lets you be “unlisted”, so your name, photo, and details are hidden from the brotherhood at large — with one exception: on the profile of your Big Brother or a Little Brother, other brothers see that a brother is there, marked “Info is private”, and nothing more. You'll still be in PBE's official records, and Address Book staff can still see your information.",
  },

  // ── Admin (D111; PRD §5.8) — descriptions folded off the cards so the manual reads them too ──
  "admin.backup": {
    key: "admin.backup",
    label: "Download backup",
    helperText:
      "Save a complete snapshot of the PBE Address Book as a JSON file you keep off-site. Automatic nightly backups arrive in a later update.",
  },
  "admin.banner.message": {
    key: "admin.banner.message",
    label: "Message",
    helperText:
      "Shown across the top of every page for everyone, until you clear it. Use for maintenance notices and announcements.",
    placeholder: "Scheduled maintenance Sunday 2–4am ET…",
  },
  "admin.banner.severity": {
    key: "admin.banner.severity",
    label: "Severity",
    helperText: "Info for announcements; Warning for maintenance or disruptions.",
  },
  "admin.ghostAudit": {
    key: "admin.ghostAudit",
    label: "Book / Ghost alignment audit",
    helperText:
      "Compares Book membership to the PBE News membership on Ghost and downloads a report showing any differences. It only reports — it never changes Book — so each difference needs to be resolved by hand.",
  },
  "admin.bounceReport": {
    key: "admin.bounceReport",
    label: "Email bounce report",
    helperText:
      "Downloads a spreadsheet (CSV) of brothers whose PBE News emails have bounced, so their addresses can be checked and updated.",
  },
  "admin.bugReports": {
    key: "admin.bugReports",
    label: "Bug reports",
    // N116's naming rule applies here: this is ordinary admin copy, not part of
    // the Ghost alignment-audit surface, which deliberately keeps bare "Book" as
    // a system name set against "Ghost" (see `admin.ghostAudit` below — do not
    // "fix" that one).
    helperText:
      "Reports members file with the “Report a bug” control appear here. Copy any worth keeping into your bug tracker, then delete them — the Address Book only holds them so you can read them.",
  },
};

/** Look up a help entry by its control id, or `undefined` if none is defined. */
export function getHelpEntry(key: string): HelpEntry | undefined {
  return helpContent[key];
}
