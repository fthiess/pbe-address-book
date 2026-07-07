import type { BrotherId } from "./types.js";

/**
 * The bug-report statuses (D121). A minimal **unread marker**, not a lifecycle:
 * `new` = an admin has not yet seen the report; `reviewed` = it has been
 * displayed but not yet deleted (deletion is the terminal act — Book stores no
 * "resolved"/"closed" state). One source for the server's write set, the admin
 * queue's filter tabs, and every `status` union across the API and SPA, so a new
 * status can't be accepted by the server and left unrenderable by the client
 * (mirrors {@link BANNER_SEVERITIES}).
 */
export const BUG_REPORT_STATUSES = ["new", "reviewed"] as const;

export type BugReportStatus = (typeof BUG_REPORT_STATUSES)[number];

/** The maximum accepted length of a bug-report `description` (D86 size cap). */
export const MAX_BUG_REPORT_DESCRIPTION = 2000;

/**
 * The optional, non-PII technical context the SPA captures with a report so an
 * admin can reproduce it (DATABASE-SCHEMA §6.4). Every field is optional — a
 * report is still valid with none of it.
 */
export interface BugReportClientContext {
  userAgent?: string;
  /** e.g. "1280x720". */
  viewport?: string;
  /** The SPA build hash / contract version. */
  appVersion?: string;
}

/**
 * A user-submitted bug report (D121; DATABASE-SCHEMA §6.4), one document per
 * report. **Book is a triage-and-clear surface, not a bug tracker** — it only
 * receives reports and lets an admin view, copy, and delete them; real bug
 * management happens in the team's external tracker. There is **no outbound
 * email**: a report is persisted and an audit entry written, keeping the admin's
 * inbox out of the attack surface. Reports are admin-read only and are never part
 * of any profile projection.
 */
export interface BugReport {
  /** Server-assigned document ID. */
  id: string;
  /** The authenticated submitter (Book is members-only, so always a known brother). */
  submittedBy: BrotherId;
  /** ISO 8601 timestamp; server-set. */
  submittedAt: string;
  /** The SPA route the report was filed from (path + query). */
  page: string;
  /** The absolute location, so an admin sees exactly where the report was filed. */
  url?: string;
  /** Free text; trimmed; capped at {@link MAX_BUG_REPORT_DESCRIPTION}; treated as untrusted. */
  description: string;
  clientContext?: BugReportClientContext;
  status: BugReportStatus;
}

/**
 * A bug report as the admin queue reads it (`GET /api/admin/bug-reports`):
 * the stored record, enriched server-side with the submitter's canonical name
 * (resolved from the in-memory profile cache) so the admin sees a name without
 * the client loading the roster. `submittedBy` is surfaced as `submitterId`.
 */
export interface AdminBugReport extends Omit<BugReport, "submittedBy"> {
  /** The submitter's Constitution ID (the stored `submittedBy`). */
  submitterId: BrotherId;
  /** The submitter's resolved canonical name, e.g. "James Smyth '84". */
  submitterName: string;
}
