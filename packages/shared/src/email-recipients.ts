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
 *  2. **`privacy.shareEmail` off — for *every* role, admins included.** This is the
 *     one rule that deliberately departs from the read projection. D19 lets an
 *     admin read through an off toggle, and `csv.ts` gives him those addresses in
 *     an export; a CSV, though, goes to the exporter alone, while a `To:` line
 *     publishes the address to **every other recipient**. That is a new exposure
 *     the CSV never had, so this list honours the brother's choice at all three
 *     roles. ⚠ **Do not "fix" this to match the projection** — an admin who
 *     genuinely needs the address still has Export CSV and the brother's profile
 *     page. (Forrest's call.)
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
  "firstName" | "lastName" | "email" | "privacy" | "deceased" | "debrothered"
>;

/** What one press of Copy Emails produced — the string, and why anyone was left out. */
export interface RecipientList {
  /** The comma-separated list, ready for the clipboard. Empty when nothing qualified. */
  readonly text: string;
  /** How many addresses `text` carries. */
  readonly copied: number;
  /** Selected brothers with no usable email address. */
  readonly skippedNoEmail: number;
  /** Selected brothers whose `shareEmail` is off (see rule 2 — this includes admins). */
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
    if (profile.privacy?.shareEmail === false) {
      skippedPrivate += 1;
      continue;
    }
    // `hasUsableEmail` already covers `undefined`; the explicit check in front of it
    // is what narrows `email` to `string` for the call below (the shared predicate
    // returns a plain boolean, and widening its signature is not this ticket's job).
    const email = profile.email;
    if (email === undefined || !hasUsableEmail(email)) {
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
