import type { GhostAuditReport } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { formatAuditReportMarkdown } from "./ghostAuditFormat.js";

const GEN = "2026-07-09T12:00:00.000Z";

describe("formatAuditReportMarkdown", () => {
  it("renders a clean, aligned report when there are no discrepancies", () => {
    const md = formatAuditReportMarkdown({ generatedAt: GEN, discrepancies: [] });
    expect(md).toContain("# Book / Ghost alignment audit");
    expect(md).toContain("Generated: 2026-07-09 · 12:00 UTC");
    expect(md).toContain("**No discrepancies found — Book and Ghost are aligned.**");
  });

  it("groups by category, counts, and states the read-only posture", () => {
    const report: GhostAuditReport = {
      generatedAt: GEN,
      discrepancies: [
        {
          category: "newsletterDrift",
          profileId: 5247,
          ghostMemberId: "g1",
          field: "allowNewsletterEmail",
          bookValue: true,
          ghostValue: false,
          bookChangedAt: "2026-01-01T00:00:00.000Z",
          ghostChangedAt: "2026-06-01T00:00:00.000Z",
        },
        { category: "unmatchedGhostMember", ghostMemberId: "g2", ghostValue: "x@example.test" },
      ],
    };
    const md = formatAuditReportMarkdown(report);
    expect(md).toContain("**2 discrepancies:**");
    expect(md).toContain("it reports differences but changes nothing");
    // Each section is a collapsible <details> block, open by default (Forrest's
    // request), with the title + count in the <summary>.
    expect(md).toContain("<details open>");
    // Section titles are H2 (under the report's H1) and the fold control.
    expect(md).toContain("<summary><h2>Newsletter subscription drift (1)</h2></summary>");
    expect(md).toContain("2026-01-01 · 00:00 UTC");
    expect(md).toContain("2026-06-01 · 00:00 UTC");
    expect(md).toContain("<summary><h2>Unmatched Ghost member (1)</h2></summary>");
    expect(md).toContain("x@example.test");
    // One <details>/<summary>/</details> per present category (here: 2).
    expect(md.match(/<details open>/g)).toHaveLength(2);
    expect(md.match(/<\/details>/g)).toHaveLength(2);
  });

  it("escapes pipes so a value cannot break a Markdown table", () => {
    const md = formatAuditReportMarkdown({
      generatedAt: GEN,
      discrepancies: [
        {
          category: "fieldDrift",
          profileId: 5247,
          ghostMemberId: "g1",
          field: "name",
          bookValue: "A | B",
          ghostValue: "C",
        },
      ],
    });
    expect(md).toContain("A \\| B");
  });

  it("escapes backslashes before pipes so `\\|` cannot break a table (OFC-152)", () => {
    // A value containing a backslash then a pipe: without escaping the backslash
    // first, `\|` renders as an escaped-backslash + a live pipe and breaks the row.
    const md = formatAuditReportMarkdown({
      generatedAt: GEN,
      discrepancies: [
        {
          category: "fieldDrift",
          profileId: 5247,
          ghostMemberId: "g1",
          field: "name",
          bookValue: "A \\| B",
          ghostValue: "C\\D",
        },
      ],
    });
    // `\|` → `\\\|` (escaped backslash + escaped pipe); a bare `\` → `\\`.
    expect(md).toContain("A \\\\\\| B");
    expect(md).toContain("C\\\\D");
  });

  it("uses the singular for exactly one discrepancy", () => {
    const md = formatAuditReportMarkdown({
      generatedAt: GEN,
      discrepancies: [{ category: "missingGhostMember", profileId: 5247, ghostMemberId: "g1" }],
    });
    expect(md).toContain("**1 discrepancy:**");
  });
});
