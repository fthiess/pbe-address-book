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
 * admin can diagnose it (DATABASE-SCHEMA §6.4). Every field is optional and
 * best-effort — a report is valid with none of it, and several fields depend on
 * browser support (the device *model* and radio generation are not exposed by any
 * browser; network details are Chromium-only, absent on Safari/iOS).
 */
export interface BugReportClientContext {
  /** The raw User-Agent string (the always-available fallback for the parsed fields). */
  userAgent?: string;
  /** e.g. "1280x720". */
  viewport?: string;
  /** The SPA build identifier (commit SHA), for spotting a stale cached SPA vs `apiVersion`. */
  webVersion?: string;
  /** Coarse device class — "Mobile" | "Tablet" | "Desktop" (the specific model is never exposed). */
  device?: string;
  /** Operating system + version where derivable, e.g. "iOS 18.2", "Windows 11", "Android 14". */
  os?: string;
  /** Browser + major version, e.g. "Safari 18.2", "Chrome 130". */
  browser?: string;
  /** Best-effort network summary (Chromium only), e.g. "Wi-Fi · ~10 Mbps". */
  network?: string;
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
  /**
   * The submitter's canonical name, **snapshotted at filing time** from the
   * session identity (D121). Stored rather than resolved on read so a report still
   * names its submitter even after their profile is deleted, and so the admin queue
   * needs no roster lookup. Frozen at filing: a later rename is not reflected (the
   * `submittedBy` id stays authoritative).
   */
  submitterName: string;
  /** ISO 8601 timestamp; server-set. */
  submittedAt: string;
  /** The SPA route the report was filed from (path + query). */
  page: string;
  /** The absolute location, so an admin sees exactly where the report was filed. */
  url?: string;
  /** Free text; trimmed; capped at {@link MAX_BUG_REPORT_DESCRIPTION}; treated as untrusted. */
  description: string;
  clientContext?: BugReportClientContext;
  /**
   * The API build identifier (commit SHA), **stamped server-side** at filing (not
   * client-supplied, so it's authoritative). Compared against
   * `clientContext.webVersion` it reveals a stale cached SPA or a web/API skew.
   */
  apiVersion?: string;
  status: BugReportStatus;
}

/**
 * A bug report as the admin queue reads it (`GET /api/admin/bug-reports`): the
 * stored record with `submittedBy` surfaced as `submitterId`. The submitter's
 * name is already on the stored record (`submitterName`, snapshotted at filing),
 * so the admin read needs no roster lookup.
 */
export interface AdminBugReport extends Omit<BugReport, "submittedBy"> {
  /** The submitter's Constitution ID (the stored `submittedBy`). */
  submitterId: BrotherId;
}
