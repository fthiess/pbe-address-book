/**
 * The mentoring opt-in (D166; OFC-386) — one predicate, shared so the Profile
 * view, the Directory column, and the Directory filter cannot disagree about who
 * counts as willing.
 *
 * The stored `willingToMentor` boolean is what the brother chose; this predicate
 * is what may be *presented* as a live offer. They differ in exactly one case, and
 * it is the case that matters: a brother who opts in and later dies. His stored
 * value is deliberately left alone — it is his answer, not ours to rewrite, and the
 * `allowNewsletterEmail` machinery for forcing a flag off at mark-deceased exists
 * only because that flag drives an outbound *action* (mail), which this one does
 * not. But "willing to provide professional information and advice" is a statement
 * in the present tense, so it is suppressed on a deceased record rather than
 * shown on his memorial page or returned by a search for available mentors.
 *
 * Consume this, never the raw field, anywhere the value is shown or filtered on.
 * The raw field is correct in exactly two places: the edit form (which shows the
 * owner his own stored choice) and the CSV export (which is a dump of stored
 * state, deceased column included).
 */

import type { Profile } from "./types.js";

/**
 * Whether this brother may be presented as willing to mentor: he opted in **and**
 * is living. Written against a partial record because both the projected wire
 * shape (`Partial<Profile>`) and a full stored record must answer it — an absent
 * `willingToMentor` (a role that could not see it, or a record predating the
 * field) is not willing, and an absent `deceased` block is not deceased.
 */
export function isWillingToMentor(
  profile: Pick<Partial<Profile>, "willingToMentor" | "deceased">,
): boolean {
  return profile.willingToMentor === true && profile.deceased?.isDeceased !== true;
}
