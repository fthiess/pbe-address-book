import type { BounceReport } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { formatBounceReportCsv } from "./bounceReportFormat.js";

const GEN = "2026-07-09T12:00:00.000Z";

describe("formatBounceReportCsv", () => {
  it("writes a header and one CRLF-terminated row per bounce", () => {
    const report: BounceReport = {
      generatedAt: GEN,
      skipped: 0,
      rows: [
        {
          email: "a@example.test",
          bounce_count: 3,
          last_bounce_at: "2026-06-01T00:00:00.000Z",
          last_bounce_newsletter: "Summer Issue",
        },
      ],
    };
    const csv = formatBounceReportCsv(report);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("email,bounce_count,last_bounce_at,last_bounce_newsletter");
    expect(lines[1]).toBe("a@example.test,3,2026-06-01T00:00:00.000Z,Summer Issue");
  });

  it("quotes a title containing a comma", () => {
    const csv = formatBounceReportCsv({
      generatedAt: GEN,
      skipped: 0,
      rows: [
        {
          email: "a@example.test",
          bounce_count: 1,
          last_bounce_at: "",
          last_bounce_newsletter: "Issue 3, Spring",
        },
      ],
    });
    expect(csv).toContain('"Issue 3, Spring"');
  });

  it("defuses spreadsheet formula injection on a leading =/+/-/@", () => {
    const csv = formatBounceReportCsv({
      generatedAt: GEN,
      skipped: 0,
      rows: [
        {
          email: "=cmd@example.test",
          bounce_count: 1,
          last_bounce_at: "",
          last_bounce_newsletter: "x",
        },
      ],
    });
    // Leading apostrophe inside quotes → Excel treats it as text, not a formula.
    expect(csv).toContain('"\'=cmd@example.test"');
  });

  it("emits just the header when there are no bounces", () => {
    const csv = formatBounceReportCsv({ generatedAt: GEN, skipped: 0, rows: [] });
    expect(csv).toBe("email,bounce_count,last_bounce_at,last_bounce_newsletter");
  });
});
