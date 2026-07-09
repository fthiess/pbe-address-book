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

  it("defuses formula injection incl. a stripped-control leader (shared neutralizer, OFC-99)", () => {
    const csv = formatBounceReportCsv({
      generatedAt: GEN,
      skipped: 0,
      rows: [
        {
          email: "a@example.test",
          bounce_count: 1,
          last_bounce_at: "",
          // A Ghost subject beginning with a stripped control + '=' — the OFC-99 case
          // the shared neutralizer covers but the old regex-only copy did not.
          last_bounce_newsletter: "\n=CMD()",
        },
      ],
    });
    // Neutralized with a leading apostrophe (then RFC-quoted for the embedded newline),
    // so a spreadsheet renders it as text, not a formula (S9/OFC-99).
    expect(csv).toContain("'\n=CMD()");
  });

  it("emits just the header when there are no bounces", () => {
    const csv = formatBounceReportCsv({ generatedAt: GEN, skipped: 0, rows: [] });
    expect(csv).toBe("email,bounce_count,last_bounce_at,last_bounce_newsletter");
  });

  it("records skipped events as a trailing note so dropped bounces aren't hidden", () => {
    const csv = formatBounceReportCsv({ generatedAt: GEN, skipped: 3, rows: [] });
    expect(csv).toContain("3 bounce event(s) skipped");
  });
});
