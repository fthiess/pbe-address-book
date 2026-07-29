import type { AdminBugReport } from "@pbe/shared";

/** ISO 8601 → a compact, locale-independent "2026-06-12 · 14:02 UTC" for the admin view. */
export function formatTimestamp(iso: string): string {
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  return date && time ? `${date} · ${time} UTC` : iso;
}

/**
 * Render one report as a text block for the clipboard, so an admin can paste it
 * straight into whatever external tracker they use — Book does no tracker
 * integration by design (D121/N60). All the captured context is included.
 *
 * The shape is **aimed squarely at Linear**, which is where these actually go
 * (OFC-366). Three things follow from that, and each was measured by pasting into a
 * real issue rather than reasoned about:
 *
 * 1. **The member's own words come first**, directly under the two identifying
 *    lines, mirroring the admin card on screen. They used to be last, below a dozen
 *    lines of diagnostics that dwarfed them.
 * 2. **The diagnostics sit in a `>>>` collapsible**, Linear's own syntax for one —
 *    occasionally essential, usually noise, so the reader opens them on purpose.
 * 3. **The diagnostics are a fenced code block.** Linear's paste handler turns every
 *    newline into a paragraph break and — measured — honours *neither* CommonMark
 *    hard-break spelling, so two-space and backslash endings space the block out
 *    exactly like bare newlines do. A fence is the only encoding that survives as
 *    tight lines. The cost is that the URL stops being a clickable link; Forrest
 *    saw the rendered result and took that trade.
 *
 * The two header lines are still a paragraph apart for the same reason — nothing can
 * be done about it short of fencing them too, which would look worse.
 */
export function formatForCopy(report: AdminBugReport): string {
  const technical = [`Page: ${report.page || "(unknown)"}`];
  if (report.url) technical.push(`URL: ${report.url}`);
  const ctx = report.clientContext;
  if (ctx?.device) technical.push(`Device: ${ctx.device}`);
  if (ctx?.os) technical.push(`OS: ${ctx.os}`);
  if (ctx?.browser) technical.push(`Browser: ${ctx.browser}`);
  if (ctx?.network) technical.push(`Network: ${ctx.network}`);
  if (ctx?.viewport) technical.push(`Viewport: ${ctx.viewport}`);
  if (ctx?.webVersion) technical.push(`Web version: ${ctx.webVersion}`);
  if (report.apiVersion) technical.push(`API version: ${report.apiVersion}`);
  if (ctx?.userAgent) technical.push(`User agent: ${ctx.userAgent}`);

  return [
    `Bug report from ${report.submitterName} (#${report.submitterId})`,
    `Submitted: ${formatTimestamp(report.submittedAt)}`,
    "",
    report.description,
    "",
    ">>> Technical details",
    "```",
    ...technical,
    "```",
    ">>>",
  ].join("\n");
}
