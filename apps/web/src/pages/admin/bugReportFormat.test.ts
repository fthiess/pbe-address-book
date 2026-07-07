import type { AdminBugReport } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { formatForCopy, formatTimestamp } from "./bugReportFormat.js";

const full: AdminBugReport = {
  id: "bug-1",
  submitterId: 5247,
  submitterName: "James Smyth '84",
  submittedAt: "2026-06-12T14:02:00.000Z",
  page: "/brother/5247/edit",
  url: "https://book.pbe400.org/brother/5247/edit",
  description: "Save did nothing.",
  clientContext: {
    userAgent: "Mozilla/5.0",
    viewport: "1280x720",
    webVersion: "abc123",
    device: "Desktop",
    os: "Windows 11",
    browser: "Chrome 130",
    network: "Wi-Fi · 4g · ~10 Mbps",
  },
  apiVersion: "def456",
  status: "new",
};

describe("formatTimestamp", () => {
  it("renders a compact UTC date/time from an ISO string", () => {
    expect(formatTimestamp("2026-06-12T14:02:00.000Z")).toBe("2026-06-12 · 14:02 UTC");
  });

  it("falls back to the raw value for an unexpected shape", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
});

describe("formatForCopy", () => {
  it("includes the submitter, timestamp, route, url, and all context, then the description", () => {
    expect(formatForCopy(full)).toBe(
      [
        "Bug report from James Smyth '84 (#5247)",
        "Submitted: 2026-06-12 · 14:02 UTC",
        "Page: /brother/5247/edit",
        "URL: https://book.pbe400.org/brother/5247/edit",
        "Device: Desktop",
        "OS: Windows 11",
        "Browser: Chrome 130",
        "Network: Wi-Fi · 4g · ~10 Mbps",
        "Viewport: 1280x720",
        "Web version: abc123",
        "API version: def456",
        "User agent: Mozilla/5.0",
        "",
        "Save did nothing.",
      ].join("\n"),
    );
  });

  it("omits absent optional lines and shows (unknown) for a blank page", () => {
    const minimal: AdminBugReport = {
      id: "bug-2",
      submitterId: 5002,
      submitterName: "(former member)",
      submittedAt: "2026-06-13T10:00:00.000Z",
      page: "",
      description: "Just the text.",
      status: "reviewed",
    };
    expect(formatForCopy(minimal)).toBe(
      [
        "Bug report from (former member) (#5002)",
        "Submitted: 2026-06-13 · 10:00 UTC",
        "Page: (unknown)",
        "",
        "Just the text.",
      ].join("\n"),
    );
  });
});
