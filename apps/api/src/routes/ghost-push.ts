import { type Profile, formatCanonicalName, shouldHaveGhostMember } from "@pbe/shared";
import {
  GhostDuplicateEmailError,
  type GhostLifecycle,
  type GhostMemberDiff,
} from "../identity/ghost-lifecycle.js";

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

/** True when a computed diff carries at least one field to push. */
export function hasGhostDiff(diff: GhostMemberDiff): boolean {
  return Object.keys(diff).length > 0;
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

/**
 * How a PATCH's Ghost-lifecycle step changed the record's `ghostMemberId`, for the
 * commit to fold into the write: a freshly-minted id to store, or a flag to drop the
 * stored id after a member deletion. Empty when the PATCH only updated (or didn't
 * touch) an existing member.
 */
export interface EmailLifecycleResult {
  /** A newly-created Ghost member id to fold into the write (email was added). */
  ghostMemberIdSet?: string;
  /** The Ghost member was deleted (email cleared) — drop the stored id. */
  dropGhostMemberId?: boolean;
}

/**
 * Run the **email↔Ghost-record lifecycle** for a PATCH (D133; OFC-232) — the
 * Ghost-first step that keeps a brother's Ghost membership in step with whether he
 * has a usable email. It resolves the transition from `stored` → `next` into one of
 * four Ghost actions, gated on {@link shouldHaveGhostMember} (living, non-de-brothered,
 * has a usable email):
 *
 *  - **create** — the email was added to an eligible Ghost-less brother: mint the
 *    member (Ghost-first, `send_email=false`, honoring his current
 *    `allowNewsletterEmail`), and return its fresh id for the write to store. A
 *    duplicate-email collision propagates as {@link GhostDuplicateEmailError} (→ a
 *    `422` reject, Option B); any other create failure aborts `502 ghost_create_failed`.
 *  - **delete** — the email was cleared on a brother who had a member: delete it
 *    (Ghost-first) and signal the write to drop the now-dangling id. A failure aborts
 *    `502 ghost_delete_failed`.
 *  - **update** — an eligible brother keeps his member: push the changed pushed
 *    fields (the existing N65 behavior).
 *  - **none** — a Book-only brother stays Book-only, or nothing pushable changed.
 *
 * Both create and delete are gated on the **email actually changing**, so an
 * unrelated PATCH (a phone edit) never mints or deletes a member as a side effect —
 * `D133`'s trigger is specifically *the PATCH that adds (or removes) the email*.
 * Deceased/de-brothered can't ride a PATCH (they are `protected`), so `next`'s
 * eligibility differs from `stored`'s only by the email — which is exactly the axis
 * this lifecycle governs.
 */
export async function runEmailGhostLifecycle(
  ghostLifecycle: GhostLifecycle,
  stored: Profile,
  next: Profile,
  changed: ReadonlySet<keyof Profile>,
): Promise<EmailLifecycleResult> {
  const emailChanged = changed.has("email");
  const hadMember = Boolean(stored.ghostMemberId);
  const shouldHave = shouldHaveGhostMember(next);

  // CREATE — the invariant's forward direction (D133): a living, non-de-brothered
  // brother who gains a usable email gets his Ghost member minted, its fresh id
  // folded into the same write.
  if (emailChanged && !hadMember && shouldHave) {
    try {
      const created = await ghostLifecycle.createMember(next);
      return { ghostMemberIdSet: created.ghostMemberId };
    } catch (cause) {
      // A duplicate-email collision is a permanent, admin-resolvable condition —
      // let it propagate so the route maps it to a `422` on `email` (Option B),
      // distinct from a transient outage's `502`.
      if (cause instanceof GhostDuplicateEmailError) {
        throw cause;
      }
      throw new GhostStepError("ghost_create_failed", cause);
    }
  }

  // DELETE — the inverse: clearing the email retires the member (Forrest's call). The
  // sole-usable-admin's email is guarded upstream, so this never orphans the org.
  if (emailChanged && hadMember && !shouldHave) {
    try {
      await ghostLifecycle.deleteMember(stored);
      return { dropGhostMemberId: true };
    } catch (cause) {
      throw new GhostStepError("ghost_delete_failed", cause);
    }
  }

  // UPDATE — an existing member gets any changed pushed field (N65). No-op if the
  // brother is Book-only both before and after (nothing to push).
  if (hadMember && shouldHave) {
    await pushGhostUpdate(ghostLifecycle, stored, computeGhostUpdateDiff(next, changed));
  }
  return {};
}
