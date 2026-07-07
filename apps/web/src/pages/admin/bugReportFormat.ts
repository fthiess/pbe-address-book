import type { AdminBugReport } from "@pbe/shared";

/** ISO 8601 → a compact, locale-independent "2026-06-12 · 14:02 UTC" for the admin view. */
export function formatTimestamp(iso: string): string {
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  return date && time ? `${date} · ${time} UTC` : iso;
}

/**
 * Render one report as a plain-text block for the clipboard, so an admin can paste
 * it straight into whatever external tracker they use — Book does no tracker
 * integration by design (D121). All the captured context is included.
 */
export function formatForCopy(report: AdminBugReport): string {
  const lines = [
    `Bug report from ${report.submitterName} (#${report.submitterId})`,
    `Submitted: ${formatTimestamp(report.submittedAt)}`,
    `Page: ${report.page || "(unknown)"}`,
  ];
  if (report.url) lines.push(`URL: ${report.url}`);
  const ctx = report.clientContext;
  if (ctx?.userAgent) lines.push(`User agent: ${ctx.userAgent}`);
  if (ctx?.viewport) lines.push(`Viewport: ${ctx.viewport}`);
  if (ctx?.appVersion) lines.push(`App version: ${ctx.appVersion}`);
  lines.push("", report.description);
  return lines.join("\n");
}
