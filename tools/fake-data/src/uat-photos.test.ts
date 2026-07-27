import { describe, expect, it } from "vitest";
import { PLACEHOLDER_COUNT, planPhotoAssignments, tallyAssignments } from "./uat-photos.js";

// Fixture ids sit in the fake range (> #5000, D65/FAKE_ID_FLOOR) like every other
// test in this repo — never anything derived from the real UAT tester roster,
// which holds live names and addresses and lives only in private GCS.

describe("planPhotoAssignments", () => {
  it("gives the lowest ids the real faces and the rest placeholders", () => {
    const plan = planPhotoAssignments([5001, 5002, 5003, 5004, 5005], 3);

    expect(plan.map((a) => a.profileId)).toEqual([5001, 5002, 5003, 5004, 5005]);
    expect(plan.slice(0, 3).map((a) => a.source)).toEqual([
      { kind: "uat", index: 0 },
      { kind: "uat", index: 1 },
      { kind: "uat", index: 2 },
    ]);
    expect(plan.slice(3).map((a) => a.source.kind)).toEqual(["placeholder", "placeholder"]);
  });

  it("sorts the input rather than trusting its order", () => {
    const shuffled = planPhotoAssignments([5005, 5001, 5003, 5002, 5004], 2);

    expect(shuffled.map((a) => a.profileId)).toEqual([5001, 5002, 5003, 5004, 5005]);
    // The two real faces go to the two LOWEST ids, not the first two given.
    expect(shuffled.filter((a) => a.source.kind === "uat").map((a) => a.profileId)).toEqual([
      5001, 5002,
    ]);
  });

  it("is deterministic — the same inputs produce an identical plan", () => {
    const ids = [5010, 5003, 5247, 5001, 5099];

    expect(planPhotoAssignments(ids, 3)).toEqual(planPhotoAssignments(ids, 3));
  });

  it("keys a placeholder tint on the id, so it survives a change in corpus size", () => {
    const withTwo = planPhotoAssignments([5001, 5002, 5003, 5004], 2);
    const withThree = planPhotoAssignments([5001, 5002, 5003, 5004], 3);

    // #5004 falls back under both corpus sizes and keeps the same tint.
    const tintFor = (plan: ReturnType<typeof planPhotoAssignments>, id: number) =>
      plan.find((a) => a.profileId === id)?.source;
    expect(tintFor(withTwo, 5004)).toEqual({
      kind: "placeholder",
      variant: 5004 % PLACEHOLDER_COUNT,
    });
    expect(tintFor(withThree, 5004)).toEqual(tintFor(withTwo, 5004));
  });

  it("uses placeholders for everyone when no corpus is available", () => {
    const plan = planPhotoAssignments([5001, 5002, 5003], 0);

    expect(plan.every((a) => a.source.kind === "placeholder")).toBe(true);
  });

  it("never repeats a face when the corpus is smaller than the population", () => {
    const ids = Array.from({ length: 20 }, (_, i) => 5001 + i);

    const used = planPhotoAssignments(ids, 12)
      .map((a) => a.source)
      .filter((s) => s.kind === "uat")
      .map((s) => (s as { index: number }).index);

    expect(used).toHaveLength(12);
    expect(new Set(used).size).toBe(12);
  });

  it("leaves surplus photos unused rather than double-assigning them", () => {
    const plan = planPhotoAssignments([5001, 5002], 10);

    expect(plan.every((a) => a.source.kind === "uat")).toBe(true);
    expect(tallyAssignments(plan, 10)).toEqual({ uat: 2, placeholder: 0, unusedPhotos: 8 });
  });

  it("handles an empty population", () => {
    expect(planPhotoAssignments([], 5)).toEqual([]);
  });
});

describe("tallyAssignments", () => {
  it("splits a mixed plan and reports no surplus when the corpus is exhausted", () => {
    const plan = planPhotoAssignments([5001, 5002, 5003, 5004, 5005], 3);

    expect(tallyAssignments(plan, 3)).toEqual({ uat: 3, placeholder: 2, unusedPhotos: 0 });
  });
});
