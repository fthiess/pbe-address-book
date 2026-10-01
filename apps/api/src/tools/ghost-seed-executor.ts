/**
 * The side-effecting half of `ghost-seed.ts` (OFC-340 / D183): carry out a
 * reviewed plan's seed actions against Ghost (the alternate→primary email move)
 * and Firestore (the link and what rides with it).
 *
 * VALIDATE FIRST. Every action in the plan file is checked for shape before
 * anything is touched (the restore's rule, D150): a hand-edited or truncated plan
 * is refused whole, never half-applied.
 *
 * ORDER. Ghost first, then Book — the app's own rule (N65). An action whose Ghost
 * step fails gets no Book write and is reported; the next plan run picks it up.
 *
 * WHAT WAS REVIEWED IS WHAT IS WRITTEN, ON BOTH SIDES. Every Book write is
 * conditional on the document's `updateTime` AT THE PLAN (`lastUpdateTime`
 * precondition): a record anyone edited since is skipped and reported, never
 * overwritten. The Ghost move is gated on the same token, read just before the
 * move — without that, a brother who changed his primary email after the plan
 * (minting a new member, OFC-451) would have his OLD member moved to an address
 * Book no longer holds. The gate is a read, not a transaction: an edit landing in
 * the moment between that read and the Ghost call can still slip through, and the
 * conditional Book write then skips the profile. That leaves the member at the
 * plan-time primary and the profile unlinked; the next plan run reports whatever
 * is then true (a match on the primary, or an unmatched member to look at).
 *
 * Only the planned fields move; `lastModified` is not touched (it means "a person
 * edited this", D181).
 */
import { normalizeEmail } from "@pbe/shared";
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { decodeToken, encodeToken } from "../data/profiles.js";
import type { SeedAction } from "./ghost-seed-plan.js";

/** gRPC FAILED_PRECONDITION: the document changed since the read. */
const GRPC_FAILED_PRECONDITION = 9;
/** gRPC NOT_FOUND: the document was deleted since the read. */
const GRPC_NOT_FOUND = 5;

/** The two Ghost calls the email move needs. */
export interface SeedGhostClient {
  /** The member's current email, or `null` when Ghost has no such member. */
  memberEmail(memberId: string): Promise<string | null>;
  setMemberEmail(memberId: string, email: string): Promise<void>;
}

export interface SeedOutcome {
  /** Profiles whose link was written. */
  written: string[];
  /** Profiles edited (or deleted) since the plan; left alone, in Book and in Ghost. */
  skipped: string[];
  /** Profiles whose write failed for any other reason (`<docId>: <message>`). */
  failed: string[];
  /** Ghost members moved to the profile's primary address. */
  ghostPushed: { docId: string; memberId: string; from: string; to: string }[];
  /** Email moves that did not happen (`<docId>: <reason>`); those profiles were not written. */
  ghostFailed: string[];
}

export function emptySeedOutcome(): SeedOutcome {
  return { written: [], skipped: [], failed: [], ghostPushed: [], ghostFailed: [] };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Every problem with a plan file's seed actions, as `<position>: <problem>` lines;
 * empty when the plan is well-formed. Checked before the first side effect.
 */
export function seedPlanProblems(seeds: readonly unknown[]): string[] {
  return seeds.flatMap((entry, index) => {
    const seed = (entry ?? {}) as Partial<SeedAction<unknown>>;
    const label = `seed ${index}${nonEmptyString(seed.docId) ? ` (#${seed.docId})` : ""}`;
    const push = seed.ghostEmailPush;
    const consent = seed.consent;
    const checks: [boolean, string][] = [
      [nonEmptyString(seed.docId), "no docId"],
      [nonEmptyString(seed.ghostMemberId), "no ghostMemberId"],
      [typeof seed.token === "string" && decodeToken(seed.token) !== null, "malformed token"],
      [
        push === undefined || (nonEmptyString(push?.from) && nonEmptyString(push?.to)),
        "malformed ghostEmailPush",
      ],
      [
        consent === undefined ||
          (typeof consent?.allowNewsletterEmail === "boolean" &&
            nonEmptyString(consent?.changedAt)),
        "malformed consent",
      ],
      [seed.adminNote === undefined || typeof seed.adminNote === "string", "malformed adminNote"],
    ];
    return checks.filter(([ok]) => !ok).map(([, problem]) => `${label}: ${problem}`);
  });
}

/** The Firestore fields one seed action writes. */
export function seedFields(action: SeedAction<string>): Record<string, unknown> {
  return {
    ghostMemberId: action.ghostMemberId,
    ...(action.adminNote !== undefined ? { adminNote: action.adminNote } : {}),
    ...(action.consent
      ? {
          allowNewsletterEmail: action.consent.allowNewsletterEmail,
          newsletterConsentChangedAt: action.consent.changedAt,
        }
      : {}),
  };
}

/**
 * The Ghost step of one action: move the member to the profile's primary address
 * when the plan says so. Returns whether the Book write may proceed; a refusal is
 * recorded on `outcome.skipped` (the profile changed since the plan) or
 * `outcome.ghostFailed` (Ghost is not as the plan saw it, or the call failed).
 */
async function moveGhostEmail(
  db: Firestore,
  ghost: SeedGhostClient,
  action: SeedAction<string>,
  outcome: SeedOutcome,
): Promise<boolean> {
  const push = action.ghostEmailPush;
  if (!push) {
    return true;
  }
  try {
    // The profile must still be the one the plan was reviewed against BEFORE Ghost
    // is touched — see the header.
    const snap = await db.collection("profiles").doc(action.docId).get();
    if (!snap.exists || encodeToken(snap.updateTime as Timestamp) !== action.token) {
      outcome.skipped.push(action.docId);
      return false;
    }
    const current = await ghost.memberEmail(action.ghostMemberId);
    if (current === null) {
      outcome.ghostFailed.push(`${action.docId}: the Ghost member no longer exists`);
      return false;
    }
    // Already at the primary address (a re-run after a skipped Book write).
    if (normalizeEmail(current) === normalizeEmail(push.to)) {
      return true;
    }
    // The plan was reviewed against `from`; anything else means Ghost moved on.
    if (normalizeEmail(current) !== normalizeEmail(push.from)) {
      outcome.ghostFailed.push(`${action.docId}: the member's email changed since the plan`);
      return false;
    }
    await ghost.setMemberEmail(action.ghostMemberId, push.to);
    outcome.ghostPushed.push({
      docId: action.docId,
      memberId: action.ghostMemberId,
      from: push.from,
      to: push.to,
    });
    return true;
  } catch (error) {
    outcome.ghostFailed.push(
      `${action.docId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Carry out `seeds`. `outcome` is filled in as the run proceeds, so a caller that
 * passes its own still holds what happened if this throws part-way.
 */
export async function executeGhostSeed(
  db: Firestore,
  ghost: SeedGhostClient,
  seeds: readonly SeedAction<string>[],
  outcome: SeedOutcome = emptySeedOutcome(),
): Promise<SeedOutcome> {
  const problems = seedPlanProblems(seeds);
  if (problems.length > 0) {
    throw new Error(`the plan file is malformed; nothing was written:\n  ${problems.join("\n  ")}`);
  }

  // Ghost first, one member at a time — a dozen calls, not worth parallelising.
  const cleared: SeedAction<string>[] = [];
  for (const action of seeds) {
    if (await moveGhostEmail(db, ghost, action, outcome)) {
      cleared.push(action);
    }
  }

  // BulkWriter: per-document writes, each conditional on the plan-time updateTime.
  // A FAILED_PRECONDITION is a record someone edited since — skipped and reported,
  // not retried. Anything else is retried a bounded number of times (BulkWriter's
  // default handler is replaced by ours) and then reported as failed.
  const writer = db.bulkWriter();
  writer.onWriteError((error) => {
    if (error.code === GRPC_FAILED_PRECONDITION || error.code === GRPC_NOT_FOUND) {
      outcome.skipped.push(error.documentRef.id);
      return false;
    }
    if (error.failedAttempts < 10) {
      return true;
    }
    outcome.failed.push(`${error.documentRef.id}: ${error.message}`);
    return false;
  });
  for (const action of cleared) {
    writer
      .update(db.collection("profiles").doc(action.docId), seedFields(action), {
        // Validated above, so the token always decodes.
        lastUpdateTime: decodeToken(action.token) as Timestamp,
      })
      .then(() => {
        outcome.written.push(action.docId);
      })
      // Every rejection has already been routed through onWriteError above.
      .catch(() => undefined);
  }
  await writer.close();
  return outcome;
}
