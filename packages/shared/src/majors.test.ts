import { describe, expect, it } from "vitest";
import {
  COURSE_FAMILIES,
  type CourseFamily,
  MAJORS,
  MAJOR_CODES,
  compareCourseCodes,
  courseFamily,
  courseLabel,
  courseName,
} from "./majors.js";

describe("course vocabulary", () => {
  it("resolves a known code to its display name", () => {
    expect(courseName("6-3")).toBe("Computer Science and Engineering");
    expect(courseName("18")).toBe("Mathematics");
  });

  it("returns an empty name for an unknown code", () => {
    expect(courseName("99-99")).toBe("");
  });

  it("formats 'code — Name' for a known code and falls back to the bare code", () => {
    expect(courseLabel("2")).toBe("2 — Mechanical Engineering");
    expect(courseLabel("99-99")).toBe("99-99");
  });

  it("has unique codes and exposes them via MAJOR_CODES", () => {
    expect(MAJOR_CODES).toHaveLength(MAJORS.length);
    expect(new Set(MAJOR_CODES).size).toBe(MAJORS.length);
  });

  it("orders course codes by number, not as strings (2 before 10; 6-1 < 6-2 < 6-3)", () => {
    const sorted = ["10", "2", "6-3", "18", "6-1", "6-2", "7"].sort(compareCourseCodes);
    expect(sorted).toEqual(["2", "6-1", "6-2", "6-3", "7", "10", "18"]);
  });

  it("maps every code to its family, and every family is a known one", () => {
    const families = new Set(COURSE_FAMILIES);
    for (const code of MAJOR_CODES) {
      const family = courseFamily(code);
      expect(family).not.toBeNull();
      expect(families.has(family as CourseFamily)).toBe(true);
    }
    expect(courseFamily("6-3")).toBe("6");
    expect(courseFamily("21W")).toBe("21");
    expect(courseFamily("CMS")).toBe("Other");
  });

  // An unknown code must NOT borrow "Other" — that is a real family with a real
  // hue (CMS/HST/STS), so a legacy code would be indistinguishable from a genuine
  // inter-school programme. null routes it to the reserved neutral instead.
  it("returns null — not 'Other' — for a code outside the vocabulary", () => {
    expect(courseFamily("99-99")).toBeNull();
    expect(courseFamily("")).toBeNull();
    expect(courseFamily("Other")).toBeNull();
  });

  it("puts a bare code before its own variants (6 < 6-1; 21 < 21A)", () => {
    expect(compareCourseCodes("6", "6-1")).toBeLessThan(0);
    expect(compareCourseCodes("21", "21A")).toBeLessThan(0);
  });

  it("orders Course 21's letter-suffixed subjects alphabetically", () => {
    const sorted = ["21W", "21A", "21", "21M", "21H", "21E"].sort(compareCourseCodes);
    expect(sorted).toEqual(["21", "21A", "21E", "21H", "21M", "21W"]);
  });

  it("orders alpha sub-codes without producing NaN (3 < 3-C; 18 < 18-C)", () => {
    expect(compareCourseCodes("3", "3-C")).toBeLessThan(0);
    expect(compareCourseCodes("18", "18-C")).toBeLessThan(0);
    const sorted = ["20-B", "4-B", "3-C", "10-B", "18-C"].sort(compareCourseCodes);
    expect(sorted).toEqual(["3-C", "4-B", "10-B", "18-C", "20-B"]);
  });

  it("sorts non-numeric codes after every numbered course, alphabetically", () => {
    const sorted = ["STS", "6-3", "CMS", "25", "HST"].sort(compareCourseCodes);
    expect(sorted).toEqual(["6-3", "25", "CMS", "HST", "STS"]);
  });

  it("is a consistent total order over the whole vocabulary — never NaN, never a false tie", () => {
    for (const a of MAJOR_CODES) {
      for (const b of MAJOR_CODES) {
        const ab = compareCourseCodes(a, b);
        expect(Number.isNaN(ab)).toBe(false);
        // Distinct codes must never compare equal, and the order must be antisymmetric.
        expect(Math.sign(ab)).toBe(a === b ? 0 : -Math.sign(compareCourseCodes(b, a)));
      }
    }
  });

  it("sorts the vocabulary to the same order regardless of input order", () => {
    const canonical = [...MAJOR_CODES].sort(compareCourseCodes);
    // A deterministic shuffle — reversing and rotating exercises a different
    // insertion path through Array.sort than the already-ordered source does.
    const shuffled = [...MAJOR_CODES].reverse();
    shuffled.push(...shuffled.splice(0, 17));
    expect([...shuffled].sort(compareCourseCodes)).toEqual(canonical);
  });
});
