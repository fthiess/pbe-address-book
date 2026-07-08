import { type Profile, formatCanonicalName } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import type { GhostLifecycle, GhostMemberDiff } from "../identity/ghost-lifecycle.js";
import { makeProfile } from "../test-support/make-profile.js";
import {
  GhostPushError,
  computeConsentDiff,
  computeGhostUpdateDiff,
  hasGhostDiff,
  pushGhostUpdate,
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

  it("carries the two consent booleans by their new value", () => {
    const next = makeProfile({
      id: 5001,
      allowNewsletterEmail: false,
      allowCommentReplyEmail: false,
    });
    expect(
      computeGhostUpdateDiff(next, changed("allowNewsletterEmail", "allowCommentReplyEmail")),
    ).toEqual({ allowNewsletterEmail: false, allowCommentReplyEmail: false });
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

describe("computeConsentDiff (deceased raise/reverse diff, N65)", () => {
  it("pushes only the consent flags a status write actually changes", () => {
    const stored = makeProfile({
      id: 5001,
      allowNewsletterEmail: true,
      allowCommentReplyEmail: true,
    });
    const set: Partial<Profile> = { allowNewsletterEmail: false, allowCommentReplyEmail: false };
    expect(computeConsentDiff(stored, set)).toEqual({
      allowNewsletterEmail: false,
      allowCommentReplyEmail: false,
    });
  });

  it("is empty when the write leaves consent untouched (a facts-only re-PUT)", () => {
    const stored = makeProfile({ id: 5001 });
    expect(
      computeConsentDiff(stored, { obituaryUrl: "https://x.test" } as Partial<Profile>),
    ).toEqual({});
  });

  it("pushes only the one flag that moved", () => {
    const stored = makeProfile({
      id: 5001,
      allowNewsletterEmail: true,
      allowCommentReplyEmail: false,
    });
    const set: Partial<Profile> = { allowNewsletterEmail: false, allowCommentReplyEmail: false };
    expect(computeConsentDiff(stored, set)).toEqual({ allowNewsletterEmail: false });
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

  it("wraps a Ghost failure in GhostPushError", async () => {
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
    ).rejects.toBeInstanceOf(GhostPushError);
  });
});
