import type { Discrepancy, DiscrepancyCategory, GhostAuditReport } from "@pbe/shared";
import { formatTimestamp } from "./bugReportFormat.js";

/**
 * Render the alignment-audit JSON (`GET /api/admin/ghost-audit`) as a Markdown
 * document for download (the 5b-2 decision: no in-UI report — the SPA fetches the
 * JSON and saves an `.md`). Markdown because the report is heterogeneous (five
 * categories, different columns each) and meant to be *read* by an admin or the
 * future OFC-214 sysadmin — it renders as tables in any viewer and stays legible as
 * plain text. Pure and unit-tested; the download wrapper adds the filename.
 *
 * The audit resolves nothing (the 5b-2 amendment to D103), so a newsletter row
 * shows both values and both change timestamps and the reader decides which side to
 * flip by hand — the copy says so.
 */

/** The shared admin timestamp format ({@link formatTimestamp}), with an em-dash for absent. */
function fmtTime(iso: string | undefined): string {
  return iso ? formatTimestamp(iso) : "—";
}

const CATEGORY_TITLES: Record<DiscrepancyCategory, string> = {
  newsletterDrift: "Newsletter subscription drift",
  fieldDrift: "Field drift (email / name)",
  missingGhostMember: "Missing Ghost member",
  unmatchedGhostMember: "Unmatched Ghost member",
  bookInternalOrphan: "Book-internal orphan",
};

// A stable, most-actionable-first section order.
const CATEGORY_ORDER: DiscrepancyCategory[] = [
  "newsletterDrift",
  "fieldDrift",
  "missingGhostMember",
  "unmatchedGhostMember",
  "bookInternalOrphan",
];

const CATEGORY_NOTES: Record<DiscrepancyCategory, string> = {
  newsletterDrift:
    "Book and Ghost disagree on the newsletter subscription. The audit does not change either side — compare the two change dates below and flip the toggle on the side that changed *earlier* to match the later one (the member's most recent intent).",
  fieldDrift:
    "A pushed field (email or Canonical Name) differs. Re-save the profile in Book to re-push it to Ghost.",
  missingGhostMember:
    "A Book profile has no matching Ghost member (a failed create, a stale id, or a never-linked profile). Re-create the member as needed.",
  unmatchedGhostMember:
    "A Ghost member matches no Book profile (a self-signup or a historical address). Identify and link, or remove from Ghost.",
  bookInternalOrphan:
    "A dangling reference inside Book (a Big-Brother pointer to a deleted profile, or a leftover `users` record). Clean up the stale reference.",
};

/** `| a | b |` escaping — newlines flattened, pipes escaped, so a value can't break the table. */
function cell(value: string | number | boolean | undefined): string {
  if (value === undefined) {
    return "";
  }
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}`;
}

function sectionTable(category: DiscrepancyCategory, items: Discrepancy[]): string {
  if (category === "newsletterDrift") {
    return table(
      ["Profile", "Ghost member", "Book", "Ghost", "Book changed", "Ghost changed"],
      items.map((d) => [
        cell(d.profileId),
        cell(d.ghostMemberId),
        cell(d.bookValue),
        cell(d.ghostValue),
        fmtTime(d.bookChangedAt),
        fmtTime(d.ghostChangedAt),
      ]),
    );
  }
  if (category === "fieldDrift") {
    return table(
      ["Profile", "Ghost member", "Field", "Book value", "Ghost value"],
      items.map((d) => [
        cell(d.profileId),
        cell(d.ghostMemberId),
        cell(d.field),
        cell(d.bookValue),
        cell(d.ghostValue),
      ]),
    );
  }
  if (category === "unmatchedGhostMember") {
    return table(
      ["Ghost member", "Email"],
      items.map((d) => [cell(d.ghostMemberId), cell(d.ghostValue)]),
    );
  }
  if (category === "missingGhostMember") {
    return table(
      ["Profile", "Stale Ghost id"],
      items.map((d) => [cell(d.profileId), cell(d.ghostMemberId)]),
    );
  }
  // bookInternalOrphan
  return table(
    ["Profile / id", "Kind", "Dangling value"],
    items.map((d) => [cell(d.profileId), cell(d.field), cell(d.bookValue)]),
  );
}

/**
 * One category as a **collapsible** `<details>` block, its title an `<h2>` inside
 * the `<summary>` — so it's a real level-2 heading under the report's H1 (visible,
 * in the outline) *and* the clickable fold control. `<details>/<summary>` isn't
 * core Markdown but renders as a fold in the common viewers (GitHub, Obsidian, VS
 * Code) and degrades to plain visible text elsewhere. Kept **open by default** — an
 * audit must never hide a finding — but a long section can be collapsed so the
 * reader can scan past it and not miss a shorter one below (Forrest's request). The
 * blank lines are load-bearing: they let the viewer parse the note + table inside
 * the block as Markdown rather than literal HTML.
 */
function section(category: DiscrepancyCategory, items: Discrepancy[]): string {
  const heading = `${CATEGORY_TITLES[category]} (${items.length})`;
  return `<details open>\n<summary><h2>${heading}</h2></summary>\n\n${CATEGORY_NOTES[category]}\n\n${sectionTable(category, items)}\n\n</details>`;
}

export function formatAuditReportMarkdown(report: GhostAuditReport): string {
  const { discrepancies } = report;
  const header = `# Book / Ghost alignment audit\n\nGenerated: ${fmtTime(report.generatedAt)}`;

  if (discrepancies.length === 0) {
    return `${header}\n\n**No discrepancies found — Book and Ghost are aligned.**\n`;
  }

  // Group by category, preserving input order within each group.
  const byCategory = new Map<DiscrepancyCategory, Discrepancy[]>();
  for (const d of discrepancies) {
    const list = byCategory.get(d.category) ?? [];
    list.push(d);
    byCategory.set(d.category, list);
  }
  const present = CATEGORY_ORDER.filter((c) => byCategory.has(c));
  const summary = present
    .map((c) => `${byCategory.get(c)?.length} ${CATEGORY_TITLES[c].toLowerCase()}`)
    .join(", ");
  // biome-ignore lint/style/noNonNullAssertion: `present` is filtered to keys in the map.
  const sections = present.map((c) => section(c, byCategory.get(c)!));

  const intro = `**${discrepancies.length} discrepanc${
    discrepancies.length === 1 ? "y" : "ies"
  }:** ${summary}.\n\nThe audit is read-only into Book — it reports differences but changes nothing. Resolve each by hand.`;

  return `${[header, intro, ...sections].join("\n\n")}\n`;
}
