import { type Profile, formatCanonicalName } from "@pbe/shared";
import type { GhostLifecycle, GhostMemberDiff } from "../identity/ghost-lifecycle.js";

/**
 * The Ghost-first-gated update push shared by `PATCH /api/profiles/{id}` and
 * `PUT …/deceased` (DECISIONS N65). Both endpoints compute the changed subset of
 * the three pushed fields (email, name, `allowNewsletterEmail`), then — before
 * committing to Firestore — call {@link pushGhostUpdate}, which forwards a
 * non-empty diff to Ghost and lets a failure abort the whole save
 * (`502 ghost_update_failed`, Book untouched).
 */

/** The profile fields whose change drives a Ghost push (N65). */
const EMAIL_FIELD: keyof Profile = "email";
const NAME_INPUT_FIELDS: readonly (keyof Profile)[] = ["firstName", "lastName", "classYear"];
const NEWSLETTER_FIELD: keyof Profile = "allowNewsletterEmail";

/** The full set that participates in the push, for a quick "is any pushed field touched" test. */
export const GHOST_PUSHED_FIELDS: ReadonlySet<keyof Profile> = new Set<keyof Profile>([
  EMAIL_FIELD,
  ...NAME_INPUT_FIELDS,
  NEWSLETTER_FIELD,
]);

/**
 * Build the Ghost diff for a **PATCH**, from the post-write record `next` and the
 * set of fields that actually changed. Only changed pushed fields appear; the
 * `name` is recomputed from `next` (its Canonical Name, sans disambiguation suffix)
 * whenever any name input changed. A changed-but-now-empty `email` is **omitted**
 * (Ghost members require an email; clearing the login address is a degenerate case
 * left to the reconciliation audit rather than pushed as an invalid empty value).
 */
export function computeGhostUpdateDiff(
  next: Profile,
  changed: ReadonlySet<keyof Profile>,
): GhostMemberDiff {
  const diff: GhostMemberDiff = {};
  if (changed.has(EMAIL_FIELD) && typeof next.email === "string" && next.email !== "") {
    diff.email = next.email;
  }
  if (NAME_INPUT_FIELDS.some((field) => changed.has(field))) {
    diff.name = formatCanonicalName(next, false);
  }
  if (changed.has(NEWSLETTER_FIELD)) {
    diff.allowNewsletterEmail = next.allowNewsletterEmail;
  }
  return diff;
}

/**
 * Build the Ghost diff for a **deceased raise/reverse**, from the newsletter flag a
 * status write `set` establishes versus what is `stored`. Deceased writes only ever
 * move consent booleans (never email or name), and only a genuine change to the one
 * pushable flag is sent — a re-PUT that edits the obituary link but leaves the
 * newsletter subscription alone yields an empty diff and makes no Ghost call.
 */
export function computeConsentDiff(stored: Profile, set: Partial<Profile>): GhostMemberDiff {
  const diff: GhostMemberDiff = {};
  if (
    set.allowNewsletterEmail !== undefined &&
    set.allowNewsletterEmail !== stored.allowNewsletterEmail
  ) {
    diff.allowNewsletterEmail = set.allowNewsletterEmail;
  }
  return diff;
}

/** True when a computed diff carries at least one field to push. */
export function hasGhostDiff(diff: GhostMemberDiff): boolean {
  return Object.keys(diff).length > 0;
}

/**
 * Whether a brother has an email usable as a Ghost identity key (OFC-201 follow-up)
 * — a non-empty, non-whitespace string. The one predicate the **create** and
 * **de-brother-reverse** paths both gate `createMember` on, so "does this brother
 * get a Ghost member" is decided identically (a Ghost member is email-keyed; a
 * brother with no usable email is Book-only, C15/D20/D115).
 */
export function hasUsableEmail(email: string | undefined): boolean {
  return typeof email === "string" && email.trim() !== "";
}

/**
 * Thrown by a Ghost-first step to abort a record write **clean** — before any Book
 * mutation — so the endpoint returns `502 { error: code }` with Book untouched
 * (N65). One error type carries every Ghost-step failure so all three write paths
 * map it identically: `code` is `ghost_update_failed` for the diff push
 * ({@link pushGhostUpdate}) and `ghost_delete_failed` / `ghost_create_failed` for
 * the de-brother member delete / re-create.
 */
export class GhostStepError extends Error {
  constructor(
    readonly code: string,
    cause?: unknown,
  ) {
    super(`ghost step failed (${code}): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "GhostStepError";
  }
}

/**
 * Perform the Ghost-first-gated push (N65): if `diff` is non-empty **and** the
 * profile has a `ghostMemberId`, push it to Ghost; a Ghost failure throws
 * {@link GhostStepError} (`ghost_update_failed`) so the caller aborts the save with
 * `502` and Book stays untouched. An empty diff (no pushed field changed) or a
 * profile with no `ghostMemberId` (nothing to update — e.g. a de-brothered record,
 * or a fake-data staging profile) is a no-op that never contacts Ghost. Returns
 * whether a push was actually made.
 */
export async function pushGhostUpdate(
  ghostLifecycle: GhostLifecycle,
  profile: Profile,
  diff: GhostMemberDiff,
): Promise<boolean> {
  if (!hasGhostDiff(diff) || !profile.ghostMemberId) {
    return false;
  }
  try {
    await ghostLifecycle.updateMember(profile, diff);
    return true;
  } catch (cause) {
    throw new GhostStepError("ghost_update_failed", cause);
  }
}
