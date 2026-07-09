import { type BounceReport, type BounceRow, formatCsvCell } from "@pbe/shared";

/**
 * Render the bounce-report JSON (`GET /api/admin/bounce-report`) as CSV for
 * download (D120; the 5b-2 decision: a CSV an admin opens in a spreadsheet, not an
 * in-UI panel or a log line). Cells are formatted by the shared `formatCsvCell`
 * (`@pbe/shared`) — the one canonical formatter that neutralizes spreadsheet
 * formula injection (S9/OFC-99, including stripped-control-char leaders) and
 * RFC-4180-escapes — so this export cannot drift from the directory/MITAA exports.
 * Pure and unit-tested; the download wrapper adds the UTF-8 BOM (so Excel reads
 * accents correctly) and the filename.
 */

const COLUMNS: (keyof BounceRow)[] = [
  "email",
  "bounce_count",
  "last_bounce_at",
  "last_bounce_newsletter",
];

export function formatBounceReportCsv(report: BounceReport): string {
  const lines = [COLUMNS.join(",")];
  for (const row of report.rows) {
    lines.push(COLUMNS.map((c) => formatCsvCell(String(row[c]))).join(","));
  }
  // If any events were dropped because their member was hard-deleted from Ghost,
  // record it as a trailing comment row so a header-only CSV never reads as a clean
  // "no bounces" when bounces were in fact discarded (the card says so too).
  if (report.skipped > 0) {
    lines.push("");
    lines.push(
      formatCsvCell(
        `# ${report.skipped} bounce event(s) skipped — the bouncing member is no longer in Ghost.`,
      ),
    );
  }
  // CRLF for best Excel-on-Windows compatibility (matches export-bounces.js).
  return lines.join("\r\n");
}
