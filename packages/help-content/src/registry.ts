import type { HelpContent, HelpEntry } from "./types.js";

/**
 * The single help-content registry, keyed by stable control id. Both the running
 * UI and the assembled USER-MANUAL (Phase 6c) read from here, so a help string
 * lives in exactly one place and the two cannot drift (D53). The **baseline**
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
  "directory.filter.staff": {
    key: "directory.filter.staff",
    label: "Staff",
    toggleTip:
      "Use this filter to find PBE Address Book staff — the managers and administrators who have extra powers to help keep brother information up to date and to maintain the system.",
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
      "Export downloads a spreadsheet (CSV) of the brothers you've selected. Your selection is kept as you search and filter, so it can span the whole directory — not just the rows on screen now. Photos and staff roles are never included.",
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
    helperText: "A 4-digit year, or “unknown”.",
    toggleTip:
      "The year you and your pledge brothers associate with. Usually, but not necessarily, the same as your graduation year.",
  },
  "profile.mugName": {
    key: "profile.mugName",
    label: "Mug name",
    helperText: "The nickname printed on your PBE mug.",
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
  "profile.privacy.shareEmergency": {
    key: "profile.privacy.shareEmergency",
    label: "Share emergency contacts with brothers",
    whenOn: "Your emergency contacts are visible to brothers.",
    whenOff: "Visible to administrators only.",
  },
  "profile.privacy.shareSpousePartner": {
    key: "profile.privacy.shareSpousePartner",
    label: "Share spouse / partner with brothers",
    whenOn: "Your spouse / partner is visible to brothers.",
    whenOff: "Visible to administrators only.",
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
    toggleTip:
      "This switch lets you be “unlisted”, so none of your information is visible to the brotherhood at large. You'll still be in PBE's official records, and Address Book staff can still see your information.",
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
    helperText:
      "Reports members file with the “Report a bug” control appear here. Copy any worth keeping into your bug tracker, then delete them — Book only holds them so you can read them.",
  },
};

/** Look up a help entry by its control id, or `undefined` if none is defined. */
export function getHelpEntry(key: string): HelpEntry | undefined {
  return helpContent[key];
}
