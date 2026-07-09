/**
 * The wire shapes of the two admin Ghost reports (Phase 5b-2; API-SPEC §7), shared
 * so the API producer and the SPA download-formatter cannot drift (D3):
 *
 *  - the **Book/Ghost alignment audit** (`GET /api/admin/ghost-audit`) — a
 *    discrepancy report, read-only into Book in every category (the 5b-2 decision
 *    amending D103: the audit resolves nothing);
 *  - the **email-bounce report** (`GET /api/admin/bounce-report`) — per-brother
 *    bounce aggregates (D120).
 *
 * The SPA renders neither in the UI: it fetches the JSON and formats a download
 * (the audit → Markdown, the bounce report → CSV).
 */

/** The alignment audit's discrepancy categories (API-SPEC §7). */
export type DiscrepancyCategory =
  | "unmatchedGhostMember"
  | "fieldDrift"
  | "missingGhostMember"
  | "bookInternalOrphan"
  | "newsletterDrift";

/**
 * One discrepancy row. Optional fields are present only where they apply to the
 * category. There is deliberately **no `resolution` field**: the audit acts on
 * nothing (the 5b-2 amendment to D103), so nothing is ever resolved — a human or
 * the future OFC-214 sysadmin reconciles a difference by hand.
 */
export interface Discrepancy {
  category: DiscrepancyCategory;
  profileId?: number;
  ghostMemberId?: string;
  /** Field name (`fieldDrift`/`newsletterDrift`) or orphan kind (`bookInternalOrphan`). */
  field?: string;
  bookValue?: string | number | boolean;
  ghostValue?: string | number | boolean;
  /** Book's `newsletterConsentChangedAt` (newsletterDrift only). */
  bookChangedAt?: string;
  /** The latest Ghost newsletter-event timestamp for the member (newsletterDrift only). */
  ghostChangedAt?: string;
}

export interface GhostAuditReport {
  generatedAt: string;
  discrepancies: Discrepancy[];
}

/** One row of the bounce report — the CSV's four columns (D120). */
export interface BounceRow {
  email: string;
  bounce_count: number;
  /** ISO timestamp of the most recent bounce, or "" if none carried one. */
  last_bounce_at: string;
  /** Title (or raw id) of the newsletter whose send most recently bounced. */
  last_bounce_newsletter: string;
}

export interface BounceReport {
  generatedAt: string;
  rows: BounceRow[];
  /** Bounce events skipped because the member was hard-deleted from Ghost. */
  skipped: number;
}
