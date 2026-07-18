import { describe, expect, it } from "vitest";

import { helpContent } from "../../packages/help-content/src/registry.js";
import type { HelpContent } from "../../packages/help-content/src/types.js";
import { BEGIN, END, renderEntry, renderReference, spliceIntoManual } from "./help-manual.js";

/**
 * Unit cover for the USER-MANUAL §10 generator (N118). The value of these tests
 * is the *guards*: the orphan-key throw and the marker throw are what stop a
 * silent omission — the precise drift the generator exists to prevent — from
 * passing the gate unnoticed.
 */
describe("renderEntry", () => {
  it("emits only the fields an entry actually carries", () => {
    const out = renderEntry({
      key: "directory.columns",
      label: "Columns",
      helperText: "Pick some.",
    });

    expect(out).toBe("#### Columns\n\n- **Helper text:** Pick some.");
    expect(out).not.toContain("Placeholder");
    expect(out).not.toContain("Behind the");
  });

  it("renders a switch's two consequence lines and its static toggle-tip", () => {
    const out = renderEntry({
      key: "profile.consent.listed",
      label: "Listed in the directory",
      whenOn: "You appear.",
      whenOff: "You don't appear.",
      toggleTip: "Deeper explanation.",
    });

    expect(out).toContain("- **Shows when on:** You appear.");
    expect(out).toContain("- **Shows when off:** You don't appear.");
    expect(out).toContain("- **Behind the “?”:** Deeper explanation.");
  });

  it("orders the fields as the reader meets them on the page", () => {
    const out = renderEntry({
      key: "profile.classYear",
      label: "Class year",
      helperText: "Helper.",
      placeholder: "Placeholder.",
      toggleTip: "Tip.",
    });

    expect(out.indexOf("Helper text")).toBeLessThan(out.indexOf("Placeholder"));
    expect(out.indexOf("Placeholder")).toBeLessThan(out.indexOf("Behind the"));
  });
});

describe("renderReference", () => {
  const fixture: HelpContent = {
    "admin.backup": { key: "admin.backup", label: "Download backup" },
    "directory.search": { key: "directory.search", label: "Name Search" },
    "profile.privacy.shareEmail": { key: "profile.privacy.shareEmail", label: "Share email" },
    "profile.classYear": { key: "profile.classYear", label: "Class year" },
  };

  it("groups by key prefix in the manual's declared group order, not registry order", () => {
    const out = renderReference(fixture);

    expect(out.indexOf("### Directory")).toBeLessThan(out.indexOf("### Your profile"));
    expect(out.indexOf("### Your profile")).toBeLessThan(
      out.indexOf("### Privacy and consent switches"),
    );
    expect(out.indexOf("### Privacy and consent switches")).toBeLessThan(
      out.indexOf("### Administration"),
    );
  });

  it("sorts a privacy/consent key into the switch group, not the profile group", () => {
    const out = renderReference(fixture);
    const switchesAt = out.indexOf("### Privacy and consent switches");

    expect(out.indexOf("#### Share email")).toBeGreaterThan(switchesAt);
    expect(out.indexOf("#### Class year")).toBeLessThan(switchesAt);
  });

  it("omits a group that has no entries", () => {
    const out = renderReference({
      "directory.search": { key: "directory.search", label: "Name Search" },
    });

    expect(out).toContain("### Directory");
    expect(out).not.toContain("### Administration");
  });

  it("throws on a key matching no group rather than silently dropping it", () => {
    expect(() =>
      renderReference({ "settings.theme": { key: "settings.theme", label: "Theme" } }),
    ).toThrow(/settings\.theme/);
  });

  it("renders every entry in the real registry", () => {
    const out = renderReference(helpContent);

    for (const entry of Object.values(helpContent)) {
      expect(out).toContain(`#### ${entry.label}`);
    }
  });
});

describe("spliceIntoManual", () => {
  const manual = `# Manual\n\n## 10. Help\n\n${BEGIN}\nstale content\n${END}\n\n## 11. Next\n`;

  it("replaces only the marked block, leaving the surrounding manual intact", () => {
    const out = spliceIntoManual(manual, "### Directory");

    expect(out).not.toContain("stale content");
    expect(out).toContain("### Directory");
    expect(out).toContain("## 10. Help");
    expect(out).toContain("## 11. Next");
  });

  it("is idempotent — splicing the same reference twice changes nothing", () => {
    const once = spliceIntoManual(manual, "### Directory");

    expect(spliceIntoManual(once, "### Directory")).toBe(once);
  });

  it("throws when a marker is missing", () => {
    expect(() => spliceIntoManual("# Manual\n\nno markers here\n", "x")).toThrow(/markers/);
  });

  it("throws when the markers are inverted", () => {
    expect(() => spliceIntoManual(`${END}\n${BEGIN}\n`, "x")).toThrow(/markers/);
  });
});
