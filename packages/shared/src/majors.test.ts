import { describe, expect, it } from "vitest";
import { MAJORS, MAJOR_CODES, courseLabel, courseName } from "./majors.js";

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
});
