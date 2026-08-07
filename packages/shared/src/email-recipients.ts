/**
 * The Directory's **Copy Emails** recipient list (D167; OFC-391) — the pure half
 * of the staff action that turns a row selection into something pasteable into a
 * mail client's `To:` line.
 *
 * It lives in `packages/shared` for the same reason `csv.ts` does: the action runs
 * entirely client-side (no server generates this string), but *what the string is*
 * is a canonical decision with privacy consequences, so it belongs beside the
 * visibility and capability tables it has to agree with rather than buried in a
 * component. That also makes every rule below unit-testable without a DOM.
 *
 * **Who is skipped, and why.** Three exclusions, each a deliberate call recorded in
 * D167, applied in a fixed order so a record lands in exactly one bucket:
 *
 *  1. **Deceased or de-brothered.** The same reasoning as `isWillingToMentor`
 *     (`mentoring.ts`) and D80's force-clearing of `allowNewsletterEmail` at
 *     mark-deceased: a value that drives an **outbound action** must not survive
 *     the brother. Composing an email is an outbound action, and a deceased
 *     brother's address now most likely reaches his family.
 *
 *  2. **A privacy choice by the brother — `unlisted`, or `privacy.shareEmail` off —
 *     for *every* role, admins included.** This is the rule that deliberately
 *     departs from the read projection. D19 lets an admin read through an off
 *     toggle and D124 shows staff an `unlisted` record in full, and `csv.ts` gives
 *     him both in an export; a CSV, though, goes to the exporter alone, while a
 *     `To:` line publishes the address to **every other recipient**. That is a new
 *     exposure the CSV never had, so this list honours the brother's choice at all
 *     three roles. ⚠ **Do not "fix" this to match the projection** — an admin who
 *     genuinely needs the address still has Export CSV and the brother's profile
 *     page. (Forrest's call.)
 *
 *     ⚠ **`unlisted` is here because the governing question is "may this address be
 *     REPUBLISHED to other brothers?", not "may staff see it?"** D167 originally
 *     kept unlisted brothers in on the second reading — staff *can* see the record,
 *     and the staffer deliberately ticked it — and that was wrong (N164, found in
 *     live testing): a brother who hides his whole record from his peers has made a
 *     *stronger* statement than one who merely turned off `shareEmail`, so it makes
 *     no sense to honour the weaker signal and ignore the stronger. Any future
 *     "should X be skipped?" question is settled by the republication test, not by
 *     the visibility table.
 *
 *  3. **No usable email**, via the shared {@link hasUsableEmail}.
 *
 * The order matters for more than tidiness: testing the *flag* before the *value*
 * is what makes a manager and an admin produce identical counts. `privacy` is
 * `restricted`, so both staff roles receive it, but only the admin receives the
 * `email` behind an off toggle — classify on the email first and the two roles
 * would report different tallies for the same selection, which is exactly what
 * rule 2 set out to avoid. The cost is one imprecision: a brother with
 * `shareEmail: false` *and* no stored email is reported as "private" rather than
 * "no email". That is the right trade — the counts are a courtesy, role-agreement
 * is the invariant.
 */

import { hasUsableEmail } from "./capabilities.js";
import type { Profile } from "./types.js";

/**
 * The minimal record shape this needs. Written against a partial `Profile`
 * because the caller holds the **wire** shape (`DirectoryProfile`), where every
 * non-`id` field may be absent — the projection collapses "not visible" and "not
 * set" on purpose, so absence is never treated as a signal here beyond "there is
 * nothing to copy".
 */
export type RecipientCandidate = Pick<
  Partial<Profile>,
  "firstName" | "lastName" | "email" | "privacy" | "unlisted" | "deceased" | "debrothered"
>;

/** What one press of Copy Emails produced — the string, and why anyone was left out. */
export interface RecipientList {
  /** The comma-separated list, ready for the clipboard. Empty when nothing qualified. */
  readonly text: string;
  /** How many addresses `text` carries. */
  readonly copied: number;
  /** Selected brothers with no usable email address. */
  readonly skippedNoEmail: number;
  /** Selected brothers who chose privacy — `unlisted`, or `shareEmail` off (rule 2,
   *  which applies to admins too). The two share a bucket because they are the same
   *  answer to the user ("he asked us not to"), exactly as deceased and de-brothered
   *  do; splitting them would add a reason without adding an action. */
  readonly skippedPrivate: number;
  /** Selected brothers who are deceased or de-brothered. */
  readonly skippedNotLiving: number;
}

/**
 * C0 controls, DEL and the C1 range — everything with no representation inside an
 * RFC 5322 quoted-string. A stray CR/LF in a display name would be a header
 * injection the moment the list is pasted into a mail client, so these are
 * collapsed to spaces rather than escaped.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/gu;

/** Backslash and double-quote — the only two characters a quoted-string must escape. */
const QUOTED_STRING_SPECIALS = /(["\\])/gu;

/**
 * Characters that must never appear raw in the address half. Unlike the display
 * name, an address **cannot be escaped into safety** — it sits between `<` and `>`
 * in a comma-separated list, so any of these ends the address early and turns the
 * remainder into extra, unintended recipients.
 *
 * ⚠ **Book's own validator does not prevent this.** `EMAIL_RE` in `validation.ts`
 * is `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` — it rejects whitespace and a second `@` and
 * nothing else, so `x@evil.com>,y.z` is a *valid* stored email by Book's rules and
 * renders as `"Name" <x@evil.com>,y.z>`: two recipients, one of them never
 * selected. Tightening `EMAIL_RE` is a separate, riskier change (it governs every
 * write path and would reject addresses already in the roster), so the recipient
 * list defends itself here instead.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: excluding them is the point.
const UNSAFE_IN_ADDRESS = /[<>,;:"\\()[\]\s\u0000-\u001F\u007F-\u009F]/u;

/**
 * Whether an address can be emitted into a recipient list without risk of breaking
 * out of its own `addr-spec`. A stored address that fails this cannot be rendered
 * safely at all — see {@link UNSAFE_IN_ADDRESS} — so {@link buildRecipientList}
 * omits it rather than emitting something that would mail an unintended party.
 */
export function isEmittableAddress(email: string): boolean {
  const address = email.trim();
  return address !== "" && !UNSAFE_IN_ADDRESS.test(address);
}

/**
 * Render one `Name <address>` recipient in RFC 5322 form, with the display name
 * **always** in a quoted-string (§3.2.4/§3.4).
 *
 * The quoting is load-bearing, not cosmetic. An unquoted display name is a
 * sequence of `atom`s, and real brothers' names routinely fall outside `atext`:
 * a `.` ("Jr.", "St. John") is not `atext` at all, and a `(` opens an RFC 5322
 * **comment** — so `Bob (Robert) Smith <b@x.test>` parses with half the name
 * silently discarded. Quoting sidesteps the whole class.
 *
 * A name that reduces to nothing yields the bare address, which is still a valid
 * `addr-spec`; an empty quoted string in front of it would only look broken.
 *
 * ⚠ **Precondition: `email` has already passed {@link isEmittableAddress}.** The
 * address half is spliced in verbatim because it cannot be escaped — the check
 * belongs in front of this function, and {@link buildRecipientList} is where it
 * lives. This is deliberately not exported from the package index for that reason.
 */
export function formatRecipient(displayName: string, email: string): string {
  const name = displayName.replace(CONTROL_CHARS, " ").trim().replace(/\s+/gu, " ");
  const address = email.trim();
  if (name === "") {
    return address;
  }
  return `"${name.replace(QUOTED_STRING_SPECIALS, "\\$1")}" <${address}>`;
}

/**
 * Build the clipboard string for a selection, plus the tally the toast reports.
 * Input order is preserved — the caller passes rows already sorted by the
 * Directory's active sort, so the pasted `To:` line matches what the user last
 * saw on screen.
 *
 * The display name is the plain **First Last**, not the Canonical Name: a mail
 * client's recipient chip is not the place for a class year or a `(#5247)`
 * disambiguator (Forrest's call, D167).
 */
export function buildRecipientList(profiles: readonly RecipientCandidate[]): RecipientList {
  const recipients: string[] = [];
  let skippedNoEmail = 0;
  let skippedPrivate = 0;
  let skippedNotLiving = 0;

  for (const profile of profiles) {
    if (profile.deceased?.isDeceased === true || profile.debrothered?.isDebrothered === true) {
      skippedNotLiving += 1;
      continue;
    }
    // Before the email value, deliberately — see the module note on role agreement.
    // `unlisted` sits here rather than with the not-living pair because it is the
    // brother's own privacy choice, and it is the *stronger* of the two choices in
    // this branch: hiding the whole record from peers subsumes hiding one field.
    if (profile.unlisted === true || profile.privacy?.shareEmail === false) {
      skippedPrivate += 1;
      continue;
    }
    // Two conditions, both landing in the same bucket. `hasUsableEmail` is the
    // shared "is there an address at all" predicate; `isEmittableAddress` then asks
    // whether it can be put in a recipient list without breaking out of its own
    // `addr-spec` — a stored address Book considers valid can still do that. A
    // brother who fails either has, for this feature's purposes, no address that
    // can be safely copied, so both are reported as "no email address" rather than
    // growing a fourth reason for a case that should never occur in real data.
    //
    // The `undefined` check is not redundant with `hasUsableEmail` (which accepts
    // `string | undefined`): it is what narrows `email` to `string` for the two
    // calls below, since the shared predicate is not a type guard.
    const email = profile.email;
    if (email === undefined || !hasUsableEmail(email) || !isEmittableAddress(email)) {
      skippedNoEmail += 1;
      continue;
    }
    const name = `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim();
    recipients.push(formatRecipient(name, email));
  }

  return {
    text: recipients.join(", "),
    copied: recipients.length,
    skippedNoEmail,
    skippedPrivate,
    skippedNotLiving,
  };
}
