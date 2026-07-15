import { type Profile, formatCanonicalName } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import {
  type GhostCreateResult,
  GhostDuplicateEmailError,
  type GhostLifecycle,
  type GhostMemberDiff,
} from "../identity/ghost-lifecycle.js";
import { RecordingGhostLifecycle } from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";
import {
  GhostStepError,
  computeGhostUpdateDiff,
  hasGhostDiff,
  pushGhostUpdate,
  runEmailGhostLifecycle,
} from "./ghost-push.js";

const changed = (...fields: (keyof Profile)[]) => new Set(fields);

describe("computeGhostUpdateDiff (PATCH pushed-field diff, N65)", () => {
  it("pushes only the pushed fields that changed", () => {
    const next = makeProfile({ id: 5001, email: "new@example.test" });
    expect(computeGhostUpdateDiff(next, changed("email"))).toEqual({ email: "new@example.test" });
  });

  it("recomputes the Canonical Name (sans suffix) when any name input changed", () => {
    const next = makeProfile({ id: 5001, firstName: "Jim", lastName: "Smyth", classYear: 1984 });
    for (const field of ["firstName", "lastName", "classYear"] as const) {
      expect(computeGhostUpdateDiff(next, changed(field))).toEqual({
        name: formatCanonicalName(next, false),
      });
    }
  });

  it("carries the newsletter boolean by its new value", () => {
    const next = makeProfile({ id: 5001, allowNewsletterEmail: false });
    expect(computeGhostUpdateDiff(next, changed("allowNewsletterEmail"))).toEqual({
      allowNewsletterEmail: false,
    });
  });

  it("makes an empty diff when no pushed field changed", () => {
    const next = makeProfile({ id: 5001, phone: "555-1234" });
    expect(computeGhostUpdateDiff(next, changed("phone"))).toEqual({});
    expect(hasGhostDiff(computeGhostUpdateDiff(next, changed("phone")))).toBe(false);
  });

  it("omits a changed-but-cleared email (Ghost members require an email)", () => {
    const next = makeProfile({ id: 5001, email: undefined });
    expect(computeGhostUpdateDiff(next, changed("email"))).toEqual({});
  });
});

describe("pushGhostUpdate (the Ghost-first gate, N65)", () => {
  class Recorder implements GhostLifecycle {
    readonly calls: GhostMemberDiff[] = [];
    async deleteMember(): Promise<void> {}
    async createMember(): Promise<{ ghostMemberId: string }> {
      return { ghostMemberId: "x" };
    }
    async updateMember(_profile: Profile, diff: GhostMemberDiff): Promise<void> {
      this.calls.push(diff);
    }
  }

  it("pushes when the profile has a ghostMemberId and the diff is non-empty", async () => {
    const ghost = new Recorder();
    const profile = makeProfile({ id: 5001, ghostMemberId: "gm-1" });
    const pushed = await pushGhostUpdate(ghost, profile, { email: "new@example.test" });
    expect(pushed).toBe(true);
    expect(ghost.calls).toEqual([{ email: "new@example.test" }]);
  });

  it("does not call Ghost when the diff is empty", async () => {
    const ghost = new Recorder();
    const pushed = await pushGhostUpdate(
      ghost,
      makeProfile({ id: 5001, ghostMemberId: "gm-1" }),
      {},
    );
    expect(pushed).toBe(false);
    expect(ghost.calls).toHaveLength(0);
  });

  it("does not call Ghost when the profile has no ghostMemberId", async () => {
    const ghost = new Recorder();
    const pushed = await pushGhostUpdate(ghost, makeProfile({ id: 5001 }), {
      email: "new@example.test",
    });
    expect(pushed).toBe(false);
    expect(ghost.calls).toHaveLength(0);
  });

  it("wraps a Ghost failure in GhostStepError with the ghost_update_failed code", async () => {
    const ghost: GhostLifecycle = {
      async deleteMember() {},
      async createMember() {
        return { ghostMemberId: "x" };
      },
      async updateMember() {
        throw new Error("ghost 500");
      },
    };
    await expect(
      pushGhostUpdate(ghost, makeProfile({ id: 5001, ghostMemberId: "gm-1" }), {
        email: "new@example.test",
      }),
    ).rejects.toMatchObject({ name: "GhostStepError", code: "ghost_update_failed" });
    // And it is the exported error type.
    const err = await pushGhostUpdate(ghost, makeProfile({ id: 5001, ghostMemberId: "gm-1" }), {
      email: "x@example.test",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GhostStepError);
  });
});

describe("runEmailGhostLifecycle (the email↔Ghost lifecycle, D133/OFC-232)", () => {
  it("CREATES the member when an email is added to a living Ghost-less brother", async () => {
    const ghost = new RecordingGhostLifecycle();
    const stored = makeProfile({ id: 5001, email: undefined }); // Book-only
    const next = makeProfile({ id: 5001, email: "added@example.test" });
    const result = await runEmailGhostLifecycle(ghost, stored, next, changed("email"));
    expect(ghost.created).toEqual([5001]);
    expect(result).toEqual({ ghostMemberIdSet: "recreated-5001" });
  });

  it("DELETES the member when the email is cleared on a brother who had one", async () => {
    const ghost = new RecordingGhostLifecycle();
    const stored = makeProfile({ id: 5001, email: "old@example.test", ghostMemberId: "gm-1" });
    const next = makeProfile({ id: 5001, email: undefined, ghostMemberId: "gm-1" });
    const result = await runEmailGhostLifecycle(ghost, stored, next, changed("email"));
    expect(ghost.deleted).toEqual([5001]);
    expect(result).toEqual({ dropGhostMemberId: true });
  });

  it("UPDATES an existing member when a pushed field changes (no create/delete)", async () => {
    const ghost = new RecordingGhostLifecycle();
    const stored = makeProfile({ id: 5001, lastName: "Smyth", ghostMemberId: "gm-1" });
    const next = makeProfile({ id: 5001, lastName: "Renamed", ghostMemberId: "gm-1" });
    const result = await runEmailGhostLifecycle(ghost, stored, next, changed("lastName"));
    expect(ghost.updated).toHaveLength(1);
    expect(ghost.created).toHaveLength(0);
    expect(ghost.deleted).toHaveLength(0);
    expect(result).toEqual({});
  });

  it("does NOTHING for a Book-only brother whose non-email field changes", async () => {
    const ghost = new RecordingGhostLifecycle();
    const stored = makeProfile({ id: 5001, email: undefined });
    const next = makeProfile({ id: 5001, email: undefined, phone: "617-555-0100" });
    const result = await runEmailGhostLifecycle(ghost, stored, next, changed("phone"));
    expect(ghost.created).toHaveLength(0);
    expect(result).toEqual({});
  });

  it("does NOT create a member for a DECEASED brother who gains an email", async () => {
    const ghost = new RecordingGhostLifecycle();
    const stored = makeProfile({ id: 5001, email: undefined, deceased: { isDeceased: true } });
    const next = makeProfile({
      id: 5001,
      email: "added@example.test",
      deceased: { isDeceased: true },
    });
    const result = await runEmailGhostLifecycle(ghost, stored, next, changed("email"));
    expect(ghost.created).toHaveLength(0);
    expect(result).toEqual({});
  });

  it("does NOT create a member for a DE-BROTHERED brother who gains an email", async () => {
    const ghost = new RecordingGhostLifecycle();
    const stored = makeProfile({
      id: 5001,
      email: undefined,
      debrothered: { isDebrothered: true },
    });
    const next = makeProfile({
      id: 5001,
      email: "added@example.test",
      debrothered: { isDebrothered: true },
    });
    const result = await runEmailGhostLifecycle(ghost, stored, next, changed("email"));
    expect(ghost.created).toHaveLength(0);
    expect(result).toEqual({});
  });

  it("does not create/delete on an unrelated edit even if the brother is Ghost-less (email unchanged)", async () => {
    // A living brother with an email but (drift) no member: a phone edit must NOT
    // heal it silently — the create trigger is specifically the email changing (D133).
    const ghost = new RecordingGhostLifecycle();
    const stored = makeProfile({ id: 5001, email: "e@example.test", phone: "1" });
    const next = makeProfile({ id: 5001, email: "e@example.test", phone: "2" });
    const result = await runEmailGhostLifecycle(ghost, stored, next, changed("phone"));
    expect(ghost.created).toHaveLength(0);
    expect(ghost.deleted).toHaveLength(0);
    expect(result).toEqual({});
  });

  it("propagates a duplicate-email collision unchanged (→ 422 mapping, Option B)", async () => {
    const ghost: GhostLifecycle = {
      async deleteMember() {},
      async createMember(): Promise<GhostCreateResult> {
        throw new GhostDuplicateEmailError("dup@example.test");
      },
      async updateMember() {},
    };
    const stored = makeProfile({ id: 5001, email: undefined });
    const next = makeProfile({ id: 5001, email: "dup@example.test" });
    await expect(
      runEmailGhostLifecycle(ghost, stored, next, changed("email")),
    ).rejects.toBeInstanceOf(GhostDuplicateEmailError);
  });

  it("wraps a generic create failure as GhostStepError(ghost_create_failed)", async () => {
    const ghost: GhostLifecycle = {
      async deleteMember() {},
      async createMember(): Promise<GhostCreateResult> {
        throw new Error("ghost 500");
      },
      async updateMember() {},
    };
    const stored = makeProfile({ id: 5001, email: undefined });
    const next = makeProfile({ id: 5001, email: "added@example.test" });
    await expect(
      runEmailGhostLifecycle(ghost, stored, next, changed("email")),
    ).rejects.toMatchObject({ name: "GhostStepError", code: "ghost_create_failed" });
  });

  it("wraps a delete failure as GhostStepError(ghost_delete_failed)", async () => {
    const ghost: GhostLifecycle = {
      async deleteMember() {
        throw new Error("ghost 500");
      },
      async createMember(): Promise<GhostCreateResult> {
        return { ghostMemberId: "x" };
      },
      async updateMember() {},
    };
    const stored = makeProfile({ id: 5001, email: "old@example.test", ghostMemberId: "gm-1" });
    const next = makeProfile({ id: 5001, email: undefined, ghostMemberId: "gm-1" });
    await expect(
      runEmailGhostLifecycle(ghost, stored, next, changed("email")),
    ).rejects.toMatchObject({ name: "GhostStepError", code: "ghost_delete_failed" });
  });
});
