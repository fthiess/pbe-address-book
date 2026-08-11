import type { RecipientList } from "@pbe/shared";

/**
 * The copy the Copy Emails toast shows (D167; OFC-391) — kept out of the component
 * so every branch is unit-testable, and so the arithmetic the user reads back is
 * pinned by tests rather than by reading JSX.
 *
 * Wording principle: the headline says what happened, the detail says who was left
 * out and why. The reasons use the vocabulary already on the rows — the Directory
 * badges say **In Memoriam** and **De-brothered** — so a staffer can look at the
 * grid and see the skipped brothers rather than having to guess which ones they were.
 */

/** A toast's two lines and its tone. `detail` is omitted when there is nothing to add. */
export interface CopyEmailsMessage {
  readonly headline: string;
  readonly detail?: string;
  readonly tone: "info" | "error";
}

/**
 * The clipboard write itself failed — an insecure context, or the browser refusing
 * the permission. This must be *visible*, not swallowed: a silent failure leaves
 * whatever was on the clipboard before, and the user pastes it into an email
 * believing it is the list they just asked for.
 */
export const CLIPBOARD_FAILURE: CopyEmailsMessage = {
  headline: "Couldn't copy to the clipboard.",
  detail: "Your browser blocked the copy. Try again, or use Export CSV instead.",
  tone: "error",
};

/**
 * The selection is larger than this role may copy at once (OFC-411) — nothing was
 * read, nothing was written, and the clipboard still holds whatever it held.
 *
 * In the **error** tone, like {@link CLIPBOARD_FAILURE} and for the same reason:
 * it reports that the copy did *not* happen, so it waits to be acknowledged rather
 * than clearing itself after ten seconds (N165). It is a refusal, not a fault — so
 * the wording states the ceiling and what the user has, and leaves out the apology.
 * The detail names the number selected because the count that matters is the one
 * the user can't see: the selection persists across filters (N79), so the brothers
 * over the line may well be off-screen.
 *
 * **It ends by naming the way through** (Forrest's call, OFC-411): a brother who
 * genuinely needs a larger list should ask a staff member, who is uncapped. Without
 * that line the cap reads as a wall, and the brother's next move is to press it
 * again with a slightly smaller selection — which is friction spent on nothing. The
 * word is **staff**, the Directory's own name for the role since OFC-407, not
 * "manager or administrator": the reader is being told whom to find, not taught the
 * role model.
 */
export function overLimitMessage(selectedCount: number, limit: number): CopyEmailsMessage {
  return {
    headline: `You can copy up to ${limit} brothers at a time.`,
    detail: `You have ${selectedCount} selected. Narrow the selection, or ask a staff member if you need a longer list.`,
    tone: "error",
  };
}

/** "1 brother" / "3 brothers". */
function brothers(n: number): string {
  return n === 1 ? "1 brother" : `${n} brothers`;
}

/**
 * The "who was left out" line, or `undefined` when nobody was. Reasons are listed
 * as labelled counts rather than sentence fragments so they pluralize cleanly and
 * stay short — this sits under a headline, not in a paragraph.
 */
export function skippedDetail(list: RecipientList): string | undefined {
  const reasons: string[] = [];
  if (list.skippedNoEmail > 0) {
    reasons.push(`no email address (${list.skippedNoEmail})`);
  }
  if (list.skippedPrivate > 0) {
    reasons.push(`address kept private (${list.skippedPrivate})`);
  }
  if (list.skippedNotLiving > 0) {
    reasons.push(`deceased or de-brothered (${list.skippedNotLiving})`);
  }
  if (reasons.length === 0) {
    return undefined;
  }
  const total = list.skippedNoEmail + list.skippedPrivate + list.skippedNotLiving;
  return `${brothers(total)} skipped — ${reasons.join(", ")}.`;
}

/**
 * The message for a completed press. `selectedCount` is the raw selection size, not
 * `list`'s input length: the two can differ when a selected brother was deleted
 * mid-session (the same caveat `ActionBar` already carries for the Export count), and
 * "nothing is selected" is a different thing to say than "nothing qualified".
 */
export function copyEmailsMessage(selectedCount: number, list: RecipientList): CopyEmailsMessage {
  if (selectedCount === 0) {
    return {
      headline: "No brothers were selected.",
      detail: "Tick the brothers you want to email, then press Copy Emails.",
      tone: "info",
    };
  }
  if (list.copied === 0) {
    return {
      headline: "No email addresses to copy.",
      detail: skippedDetail(list),
      tone: "info",
    };
  }
  return {
    headline:
      list.copied === 1
        ? "1 email address copied to your clipboard."
        : `${list.copied} email addresses copied to your clipboard.`,
    detail: skippedDetail(list),
    tone: "info",
  };
}
