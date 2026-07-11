import { describe, expect, it } from "vitest";
import { neutralizeCsvCell, profilesToCsv } from "./csv.js";
import type { Profile } from "./types.js";

type Row = Partial<Profile> & Pick<Profile, "id">;

const rows = (...r: Row[]) => r as (Partial<Profile> & Pick<Profile, "id">)[];

/** Parse a CSV string into header + data cell arrays (no quoted-comma edge in these fixtures unless noted). */
function header(csv: string): string[] {
  return (csv.split("\r\n")[0] ?? "").split(",");
}

describe("neutralizeCsvCell (S9)", () => {
  it("prefixes a leading formula character with a quote", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(neutralizeCsvCell(`${lead}cmd`)).toBe(`'${lead}cmd`);
    }
  });

  it("prefixes a leading line-break/whitespace control (OFC-99): \\n, \\v, \\f, NEL, LS, PS", () => {
    for (const lead of ["\n", "\v", "\f", "\u0085", "\u2028", "\u2029"]) {
      expect(neutralizeCsvCell(`${lead}=cmd|'/C calc'!A1`)).toBe(`'${lead}=cmd|'/C calc'!A1`);
    }
  });

  it("leaves an ordinary value untouched", () => {
    expect(neutralizeCsvCell("Smyth")).toBe("Smyth");
    expect(neutralizeCsvCell("")).toBe("");
  });
});

describe("profilesToCsv — newline-leading formula injection (OFC-99)", () => {
  it("neutralizes a `\\n`-leading formula and RFC-4180-quotes the newline cell", () => {
    // A free-text field beginning with a newline then a formula: the emitted cell
    // must carry the protective leading quote (before the newline) and be quoted.
    const csv = profilesToCsv(rows({ id: 5247, employerName: "\n=cmd|'/C calc'!A1" }), "brother");
    expect(csv).toContain(`"'\n=cmd|'/C calc'!A1"`);
  });
});

describe("profilesToCsv — role-aware columns (§10)", () => {
  it("omits staff-only columns from a brother's export", () => {
    const h = header(profilesToCsv(rows({ id: 5247 }), "brother"));
    expect(h[0]).toBe("id");
    expect(h).toContain("email"); // toggle column present for all roles
    expect(h).not.toContain("adminNote");
    expect(h).not.toContain("allowNewsletterEmail");
    expect(h).not.toContain("privacy.shareEmail");
    expect(h).not.toContain("unlisted");
  });

  it("includes the public verification columns in a brother's export (OFC-207)", () => {
    // Verification is public (amends D28), and the export inherits the projection,
    // so a brother's file carries the same verification signal he sees on profiles.
    const h = header(profilesToCsv(rows({ id: 5247 }), "brother"));
    expect(h).toContain("lastVerifiedDate");
    expect(h).toContain("verifiedBy");
  });

  it("includes staff-only columns for managers/admins", () => {
    const h = header(profilesToCsv(rows({ id: 5247 }), "manager"));
    expect(h).toContain("adminNote");
    expect(h).toContain("verifiedBy");
    expect(h).toContain("allowNewsletterEmail");
    expect(h).toContain("privacy.shareEmail");
    expect(h).toContain("unlisted");
  });
});

describe("profilesToCsv — cell rendering", () => {
  it("joins majors with semicolons and renders booleans as true/false", () => {
    const csv = profilesToCsv(
      rows({ id: 5247, majors: ["6-3", "18"], allowNewsletterEmail: true }),
      "manager",
    );
    const h = header(csv);
    const cells = (csv.split("\r\n")[1] ?? "").split(",");
    expect(cells[h.indexOf("majors")]).toBe("6-3;18");
    expect(cells[h.indexOf("allowNewsletterEmail")]).toBe("true");
  });

  it("RFC-4180-escapes a value containing a comma", () => {
    const csv = profilesToCsv(rows({ id: 5247, employerName: "Smith, Jones & Co" }), "brother");
    expect(csv).toContain('"Smith, Jones & Co"');
  });

  it("neutralizes a formula-injection attempt in a free-text field", () => {
    // No comma → neutralized (leading quote) but not RFC-quote-wrapped.
    expect(profilesToCsv(rows({ id: 5247, firstName: "=HYPERLINK(1)" }), "brother")).toContain(
      "'=HYPERLINK(1)",
    );
    // Both at once: a leading formula char AND a comma → neutralized then escaped.
    expect(profilesToCsv(rows({ id: 5247, employerName: "=cmd, evil" }), "brother")).toContain(
      `"'=cmd, evil"`,
    );
  });

  it("leaves absent fields blank", () => {
    const csv = profilesToCsv(rows({ id: 5247 }), "brother");
    const h = header(csv);
    const cells = (csv.split("\r\n")[1] ?? "").split(",");
    expect(cells[0]).toBe("5247");
    expect(cells[h.indexOf("email")]).toBe("");
  });
});
