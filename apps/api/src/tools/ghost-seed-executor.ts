/**
 * The side-effecting half of `ghost-seed.ts` (OFC-340 / D183): carry out a
 * reviewed plan's seed actions against Ghost (the alternate→primary email move)
 * and Firestore (the link and what rides with it).
 *
 * ORDER. Ghost first, then Book — the app's own rule (N65). An action whose Ghost
 * step fails gets no Book write and is reported; the next plan run picks it up
 * again. An action whose Ghost step succeeds but whose Book write is then refused
 * (the record changed since the plan) leaves the member at the primary address
 * and the profile unlinked — harmless, and the next plan run matches it on the
 * primary address with nothing left to push.
 *
 * Every Book write is conditional on the document's `updateTime` AT THE PLAN
 * (`lastUpdateTime` precondition), so what is written is exactly what was
 * reviewed: a record anyone edited since — including an email edit that minted a
 * new Ghost member in the meantime (OFC-451) — is skipped and reported, never
 * overwritten. Only the planned fields move; `lastModified` is not touched (it
 * means "a person edited this", D181).
 */
import { normalizeEmail } from "@pbe/shared";
import type { Firestore } from "firebase-admin/firestore";
import { decodeToken } from "../data/profiles.js";
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
  /** Profiles edited since the plan; left alone. */
  skipped: string[];
  /** Profiles whose write failed for any other reason (`<docId>: <message>`). */
  failed: string[];
  /** Ghost members moved to the profile's primary address. */
  ghostPushed: { docId: string; memberId: string; from: string; to: string }[];
  /** Email moves that did not happen (`<docId>: <reason>`); those profiles were not written. */
  ghostFailed: string[];
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
 * when the plan says so. Returns whether the Book write may proceed; a refusal or
 * a failure is recorded on `outcome.ghostFailed`.
 */
async function moveGhostEmail(
  ghost: SeedGhostClient,
  action: SeedAction<string>,
  outcome: SeedOutcome,
): Promise<boolean> {
  const push = action.ghostEmailPush;
  if (!push) {
    return true;
  }
  try {
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

export async function executeGhostSeed(
  db: Firestore,
  ghost: SeedGhostClient,
  seeds: readonly SeedAction<string>[],
): Promise<SeedOutcome> {
  const outcome: SeedOutcome = {
    written: [],
    skipped: [],
    failed: [],
    ghostPushed: [],
    ghostFailed: [],
  };

  // Ghost first, one member at a time — a dozen calls, not worth parallelising.
  const cleared: SeedAction<string>[] = [];
  for (const action of seeds) {
    if (await moveGhostEmail(ghost, action, outcome)) {
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
    const lastUpdateTime = decodeToken(action.token);
    if (lastUpdateTime === null) {
      outcome.failed.push(`${action.docId}: malformed token in the plan file`);
      continue;
    }
    writer
      .update(db.collection("profiles").doc(action.docId), seedFields(action), { lastUpdateTime })
      .then(() => {
        outcome.written.push(action.docId);
      })
      // Every rejection has already been routed through onWriteError above.
      .catch(() => undefined);
  }
  await writer.close();
  return outcome;
}
