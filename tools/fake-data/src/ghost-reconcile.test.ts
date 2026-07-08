import { describe, expect, it } from "vitest";
import { type DesiredMember, type ExistingMember, planReconcile } from "./ghost-reconcile.js";

const desired = (
  profileId: number,
  email: string,
  name: string,
  subscribed: boolean,
): DesiredMember => ({
  profileId,
  email,
  name,
  subscribed,
});
const existing = (
  id: string,
  email: string,
  name: string,
  subscribed: boolean,
): ExistingMember => ({
  id,
  email,
  name,
  subscribed,
});

describe("planReconcile (ghost-staging mirror delta)", () => {
  it("creates a desired member with no existing match", () => {
    const plan = planReconcile([desired(1, "a@example.test", "A '84", true)], []);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.matchedLinks).toEqual([]);
  });

  it("links an unchanged match without creating or updating", () => {
    const plan = planReconcile(
      [desired(1, "a@example.test", "A '84", true)],
      [existing("m1", "a@example.test", "A '84", true)],
    );
    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.matchedLinks).toEqual([{ profileId: 1, ghostMemberId: "m1" }]);
  });

  it("updates a match whose name or subscription drifted", () => {
    const plan = planReconcile(
      [desired(1, "a@example.test", "Al '84", false)],
      [existing("m1", "a@example.test", "A '84", true)],
    );
    expect(plan.toUpdate).toEqual([
      { id: "m1", desired: desired(1, "a@example.test", "Al '84", false) },
    ]);
    // Still links the matched member so the profile gets its id.
    expect(plan.matchedLinks).toEqual([{ profileId: 1, ghostMemberId: "m1" }]);
    expect(plan.toCreate).toEqual([]);
  });

  it("deletes a seed-owned orphan matched by no desired member", () => {
    const plan = planReconcile([], [existing("m9", "gone@example.test", "Gone '84", true)]);
    expect(plan.toDelete).toEqual(["m9"]);
  });

  it("matches case-insensitively (normalized email)", () => {
    const plan = planReconcile(
      [desired(1, "MixedCase@Example.test", "A '84", true)],
      [existing("m1", "mixedcase@example.test", "A '84", true)],
    );
    expect(plan.matchedLinks).toEqual([{ profileId: 1, ghostMemberId: "m1" }]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });

  it("handles a mixed batch: create + update + link + delete together", () => {
    const plan = planReconcile(
      [
        desired(1, "keep@example.test", "Keep '84", true), // unchanged → link only
        desired(2, "edit@example.test", "Edited '85", false), // drifted → update
        desired(3, "new@example.test", "New '86", true), // no match → create
      ],
      [
        existing("m1", "keep@example.test", "Keep '84", true),
        existing("m2", "edit@example.test", "Old '85", true),
        existing("m9", "orphan@example.test", "Orphan '80", true), // no desired → delete
      ],
    );
    expect(plan.toCreate.map((m) => m.profileId)).toEqual([3]);
    expect(plan.toUpdate.map((u) => u.id)).toEqual(["m2"]);
    expect(plan.toDelete).toEqual(["m9"]);
    expect(plan.matchedLinks).toEqual([
      { profileId: 1, ghostMemberId: "m1" },
      { profileId: 2, ghostMemberId: "m2" },
    ]);
  });
});
