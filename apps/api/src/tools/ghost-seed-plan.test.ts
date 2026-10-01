import { describe, expect, it } from "vitest";
import { type SeedMember, type SeedProfileSource, planGhostSeed } from "./ghost-seed-plan.js";

const GENESIS = "2026-09-16T01:01:39.574Z";

function member(id: string, email: string, over: Partial<SeedMember> = {}): SeedMember {
  return {
    id,
    email,
    subscribed: true,
    note: "",
    createdAt: "2025-12-10T00:00:00.000Z",
    updatedAt: "2025-12-11T00:00:00.000Z",
    ...over,
  };
}

function profile(id: number, over: SeedProfileSource = {}) {
  return {
    id: String(id),
    token: `t${id}`,
    data: {
      allowNewsletterEmail: true,
      newsletterConsentChangedAt: GENESIS,
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      ...over,
    } as SeedProfileSource,
  };
}

/** Enough genesis-stamped filler that GENESIS is unambiguously the common stamp. */
const filler = [profile(5900), profile(5901), profile(5902)];

describe("planGhostSeed — the match", () => {
  it("links a profile to the member at its primary email, case-insensitively", () => {
    const plan = planGhostSeed(
      [profile(5247, { email: "james.smyth@example.test" }), ...filler],
      [member("m1", "James.Smyth@Example.test")],
    );
    expect(plan.seeds).toEqual([
      {
        docId: "5247",
        token: "t5247",
        ghostMemberId: "m1",
        memberEmail: "James.Smyth@Example.test",
        matchedOn: "email",
        prior: {},
      },
    ]);
    expect(plan.unmatched).toEqual([]);
  });

  it("links on the alternate address only when the primary has no member, and moves the member to the primary", () => {
    const plan = planGhostSeed(
      [profile(5247, { email: "new@example.test", alternateEmail: "old@example.test" }), ...filler],
      [member("m1", "Old@example.test")],
    );
    expect(plan.seeds).toHaveLength(1);
    expect(plan.seeds[0]).toMatchObject({
      ghostMemberId: "m1",
      matchedOn: "alternateEmail",
      ghostEmailPush: { from: "Old@example.test", to: "new@example.test" },
    });
  });

  it("prefers the primary-address member and reports the alternate one as a leftover", () => {
    const plan = planGhostSeed(
      [profile(5247, { email: "a@example.test", alternateEmail: "b@example.test" }), ...filler],
      [member("mA", "a@example.test"), member("mB", "b@example.test", { subscribed: false })],
    );
    expect(plan.seeds[0]).toMatchObject({ ghostMemberId: "mA", matchedOn: "email" });
    expect(plan.seeds[0]?.ghostEmailPush).toBeUndefined();
    expect(plan.leftovers).toEqual([
      {
        docId: "5247",
        memberId: "mB",
        email: "b@example.test",
        subscribed: false,
        createdAt: "2025-12-10T00:00:00.000Z",
        reason: "second-member-at-alternate",
        subscriptionDiffers: true,
      },
    ]);
    expect(plan.unmatched).toEqual([]);
  });

  it("counts Ghost-less brothers without treating them as errors", () => {
    const plan = planGhostSeed(
      [profile(5247, { email: "nobody@example.test" }), profile(5248), ...filler],
      [],
    );
    expect(plan.seeds).toEqual([]);
    expect(plan.ghostlessWithEmail).toEqual(["5247"]);
    expect(plan.ghostlessNoEmail).toBe(1 + filler.length);
    expect(plan.conflicts).toEqual([]);
  });

  it("never links a deceased or de-brothered profile; a member at its address is a leftover", () => {
    const plan = planGhostSeed(
      [
        profile(5247, { email: "a@example.test", deceased: { isDeceased: true } }),
        profile(5248, { email: "b@example.test", debrothered: { isDebrothered: true } }),
        ...filler,
      ],
      [member("mA", "a@example.test")],
    );
    expect(plan.seeds).toEqual([]);
    expect(plan.exempt).toBe(2);
    expect(plan.leftovers.map((l) => [l.docId, l.memberId, l.reason])).toEqual([
      ["5247", "mA", "member-of-exempt-profile"],
    ]);
  });

  it("reports a member no profile accounts for", () => {
    const stray = member("mX", "stranger@example.test");
    const plan = planGhostSeed(filler, [stray]);
    expect(plan.unmatched).toEqual([stray]);
  });
});

describe("planGhostSeed — a profile that already has a ghostMemberId", () => {
  it("is never re-linked; its other member is a leftover (the pre-seed duplicate)", () => {
    // The OFC-451 shape: Book minted mNew for the new primary; the original member
    // still sits at the address that is now the alternate.
    const plan = planGhostSeed(
      [
        profile(5247, {
          email: "new@example.test",
          alternateEmail: "old@example.test",
          ghostMemberId: "mNew",
        }),
        ...filler,
      ],
      [member("mNew", "new@example.test"), member("mOld", "old@example.test")],
    );
    expect(plan.seeds).toEqual([]);
    expect(plan.alreadyLinked).toEqual(["5247"]);
    expect(plan.leftovers.map((l) => [l.memberId, l.reason])).toEqual([
      ["mOld", "extra-member-of-linked-profile"],
    ]);
    expect(plan.unmatched).toEqual([]);
  });

  it("reports a stored id that names no Ghost member, and does not re-link", () => {
    const plan = planGhostSeed(
      [profile(5247, { email: "a@example.test", ghostMemberId: "gone" }), ...filler],
      [member("mA", "a@example.test")],
    );
    expect(plan.seeds).toEqual([]);
    expect(plan.alreadyLinked).toEqual([]);
    expect(plan.conflicts).toEqual([
      { docId: "5247", kind: "stale-ghost-member-id", memberId: "gone" },
    ]);
  });

  it("reports, and does not resolve, a consent disagreement with the linked member", () => {
    const plan = planGhostSeed(
      [profile(5247, { email: "a@example.test", ghostMemberId: "mA" }), ...filler],
      [member("mA", "a@example.test", { subscribed: false })],
    );
    expect(plan.seeds).toEqual([]);
    expect(plan.conflicts).toEqual([
      { docId: "5247", kind: "linked-consent-mismatch", memberId: "mA" },
    ]);
  });

  it("refuses to link a second profile to a member another profile already stores", () => {
    const plan = planGhostSeed(
      [
        profile(5247, { email: "x@example.test", ghostMemberId: "mA" }),
        profile(5248, { email: "a@example.test" }),
        ...filler,
      ],
      [member("mA", "a@example.test")],
    );
    expect(plan.seeds).toEqual([]);
    expect(plan.conflicts).toContainEqual({
      docId: "5248",
      kind: "member-linked-to-another-profile",
      memberId: "mA",
    });
  });
});

describe("planGhostSeed — what a link writes", () => {
  it("carries the Ghost note only when Book's note is blank", () => {
    const plan = planGhostSeed(
      [
        profile(5247, { email: "a@example.test" }),
        profile(5248, { email: "b@example.test", adminNote: "  " }),
        profile(5249, { email: "c@example.test", adminNote: "Book's own note" }),
        ...filler,
      ],
      [
        member("mA", "a@example.test", { note: " from Ghost " }),
        member("mB", "b@example.test", { note: "also Ghost" }),
        member("mC", "c@example.test", { note: "ignored" }),
      ],
    );
    expect(plan.seeds.map((s) => s.adminNote)).toEqual(["from Ghost", "also Ghost", undefined]);
  });

  it("overwrites the genesis placeholder consent from Ghost, stamped with the Ghost event time", () => {
    const plan = planGhostSeed(
      [profile(5247, { email: "a@example.test" }), ...filler],
      [member("mA", "a@example.test", { subscribed: false })],
      new Map([["mA", "2024-03-02T10:00:00.000Z"]]),
    );
    expect(plan.seeds[0]).toMatchObject({
      consent: {
        allowNewsletterEmail: false,
        changedAt: "2024-03-02T10:00:00.000Z",
        source: "event",
      },
      prior: { allowNewsletterEmail: true, newsletterConsentChangedAt: GENESIS },
    });
    expect(plan.genesisConsentStamp).toEqual({ value: GENESIS, count: 1 + filler.length });
  });

  it("falls back to the member's updated_at when no newsletter event was found", () => {
    const plan = planGhostSeed(
      [profile(5247, { email: "a@example.test" }), ...filler],
      [member("mA", "a@example.test", { subscribed: false })],
    );
    expect(plan.seeds[0]?.consent).toEqual({
      allowNewsletterEmail: false,
      changedAt: "2025-12-11T00:00:00.000Z",
      source: "member",
    });
  });

  it("writes no consent when Book and Ghost agree", () => {
    const plan = planGhostSeed(
      [profile(5247, { email: "a@example.test" }), ...filler],
      [member("mA", "a@example.test")],
    );
    expect(plan.seeds[0]?.consent).toBeUndefined();
    expect(plan.seeds[0]?.prior).toEqual({});
  });

  it("leaves a consent changed in Book since launch alone, still links, and reports it", () => {
    // Stamp differs from the genesis placeholder: a real choice made in Book.
    const plan = planGhostSeed(
      [
        profile(5247, {
          email: "a@example.test",
          allowNewsletterEmail: false,
          newsletterConsentChangedAt: "2026-09-25T12:00:00.000Z",
        }),
        ...filler,
      ],
      [member("mA", "a@example.test", { subscribed: true })],
    );
    expect(plan.seeds).toHaveLength(1);
    expect(plan.seeds[0]?.ghostMemberId).toBe("mA");
    expect(plan.seeds[0]?.consent).toBeUndefined();
    expect(plan.conflicts).toEqual([
      { docId: "5247", kind: "book-consent-changed-since-launch", memberId: "mA" },
    ]);
  });
});
