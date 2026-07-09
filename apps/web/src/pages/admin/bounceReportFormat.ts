import type { BounceReport, BounceRow } from "@pbe/shared";

/**
 * Render the bounce-report JSON (`GET /api/admin/bounce-report`) as CSV for
 * download (D120; the 5b-2 decision: a CSV an admin opens in a spreadsheet, not an
 * in-UI panel or a log line). The columns and escaping mirror the proven
 * `export-bounces.js`. Pure and unit-tested; the download wrapper adds the UTF-8
 * BOM (so Excel reads accents correctly) and the filename.
 */

const COLUMNS: (keyof BounceRow)[] = [
  "email",
  "bounce_count",
  "last_bounce_at",
  "last_bounce_newsletter",
];

/**
 * Escape one CSV cell. Quotes fields containing a comma, quote, or newline; and
 * defuses spreadsheet **formula injection** — a value starting with `= + - @` is
 * quoted with a leading apostrophe so Excel treats it as text, not a formula
 * (mirrors export-bounces.js's `csvEscape`).
 */
function csvEscape(value: string | number): string {
  const s = String(value);
  if (/^[=+\-@]/.test(s)) {
    return `"'${s.replace(/"/g, '""')}"`;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatBounceReportCsv(report: BounceReport): string {
  const lines = [COLUMNS.join(",")];
  for (const row of report.rows) {
    lines.push(COLUMNS.map((c) => csvEscape(row[c])).join(","));
  }
  // CRLF for best Excel-on-Windows compatibility (matches export-bounces.js).
  return lines.join("\r\n");
}
