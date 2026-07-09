import { describe, expect, it } from "vitest";
import type { GhostMemberRecord } from "../identity/ghost-reader.js";
import { makeProfile } from "../test-support/make-profile.js";
import { type GhostAuditInput, planGhostAudit } from "./ghost-audit.js";

/**
 * The Book/Ghost alignment audit engine (5b-2; API-SPEC §7). A pure join, so every
 * category is exercised with fixtures — including the two invariants of the 5b-2
 * decision amending D103: the audit **never resolves** anything (no `resolution`
 * key on any row, in either newsletter direction), and a de-brothered profile is
 * excluded from every Ghost comparison (D115).
 */

const GEN = "2026-07-09T12:00:00.000Z";
/** James Smyth '84 is the makeProfile default; this is his pushed Canonical Name. */
const SMYTH_NAME = "James Smyth '84";

function member(overrides: Partial<GhostMemberRecord> & { id: string }): GhostMemberRecord {
  return { email: "james.smyth@example.test", name: SMYTH_NAME, subscribed: true, ...overrides };
}

function run(input: Partial<GhostAuditInput>) {
  return planGhostAudit({
    profiles: [],
    userIds: [],
    members: [],
    newsletterEvents: [],
    generatedAt: GEN,
    ...input,
  });
}

describe("planGhostAudit", () => {
  it("reports nothing when Book and Ghost agree", () => {
    const report = run({
      profiles: [makeProfile({ ghostMemberId: "g1" })],
      members: [member({ id: "g1" })],
    });
    expect(report.generatedAt).toBe(GEN);
    expect(report.discrepancies).toEqual([]);
  });

  it("flags a name difference as report-only fieldDrift", () => {
    const report = run({
      profiles: [makeProfile({ ghostMemberId: "g1" })],
      members: [member({ id: "g1", name: "Jim Smyth '84" })],
    });
    expect(report.discrepancies).toEqual([
      {
        category: "fieldDrift",
        profileId: 5247,
        ghostMemberId: "g1",
        field: "name",
        bookValue: SMYTH_NAME,
        ghostValue: "Jim Smyth '84",
      },
    ]);
  });

  it("flags an email difference as fieldDrift (normalized comparison)", () => {
    const report = run({
      profiles: [makeProfile({ ghostMemberId: "g1", email: "james.smyth@example.test" })],
      members: [member({ id: "g1", email: "OLD.address@example.test" })],
    });
    expect(report.discrepancies).toMatchObject([{ category: "fieldDrift", field: "email" }]);
  });

  it("does NOT flag an email that differs only by case (normalized equal)", () => {
    const report = run({
      profiles: [makeProfile({ ghostMemberId: "g1", email: "james.smyth@example.test" })],
      members: [member({ id: "g1", email: "James.Smyth@Example.Test" })],
    });
    expect(report.discrepancies).toEqual([]);
  });

  it("flags newsletterDrift with both values and both timestamps — but never resolves it", () => {
    const report = run({
      profiles: [
        makeProfile({
          ghostMemberId: "g1",
          allowNewsletterEmail: true,
          newsletterConsentChangedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      members: [member({ id: "g1", subscribed: false })],
      newsletterEvents: [
        { memberId: "g1", subscribed: false, at: "2026-06-01T00:00:00.000Z" },
        { memberId: "g1", subscribed: true, at: "2025-01-01T00:00:00.000Z" },
      ],
    });
    expect(report.discrepancies).toEqual([
      {
        category: "newsletterDrift",
        profileId: 5247,
        ghostMemberId: "g1",
        field: "allowNewsletterEmail",
        bookValue: true,
        ghostValue: false,
        bookChangedAt: "2026-01-01T00:00:00.000Z",
        ghostChangedAt: "2026-06-01T00:00:00.000Z", // the LATEST event wins
      },
    ]);
    // The audit acts on nothing (5b-2 amendment to D103): no resolution key anywhere.
    for (const d of report.discrepancies) {
      expect(d).not.toHaveProperty("resolution");
    }
  });

  it("reports newsletterDrift without ghostChangedAt when no event is available", () => {
    const report = run({
      profiles: [makeProfile({ ghostMemberId: "g1", allowNewsletterEmail: false })],
      members: [member({ id: "g1", subscribed: true })],
    });
    const [drift] = report.discrepancies;
    expect(drift).toMatchObject({
      category: "newsletterDrift",
      ghostValue: true,
      bookValue: false,
    });
    expect(drift).not.toHaveProperty("ghostChangedAt");
  });

  it("reports missingGhostMember for an emailed profile whose Ghost id doesn't resolve", () => {
    const report = run({
      profiles: [makeProfile({ ghostMemberId: "gone" })],
      members: [],
    });
    expect(report.discrepancies).toEqual([
      { category: "missingGhostMember", profileId: 5247, ghostMemberId: "gone" },
    ]);
  });

  it("reports missingGhostMember for an emailed profile with no Ghost id at all", () => {
    const report = run({ profiles: [makeProfile({ ghostMemberId: undefined })], members: [] });
    expect(report.discrepancies).toEqual([{ category: "missingGhostMember", profileId: 5247 }]);
  });

  it("does NOT flag a no-email profile as missing (the C15/D20 unidentified case)", () => {
    const report = run({
      profiles: [makeProfile({ email: undefined, ghostMemberId: undefined })],
      members: [],
    });
    expect(report.discrepancies).toEqual([]);
  });

  it("excludes a de-brothered profile from every Ghost comparison (D115)", () => {
    const report = run({
      // De-brothered, its Ghost member gone — normally a missingGhostMember, but expected.
      profiles: [makeProfile({ ghostMemberId: "g1", debrothered: { isDebrothered: true } })],
      members: [],
    });
    expect(report.discrepancies).toEqual([]);
  });

  it("surfaces a de-brothered profile's STILL-LIVE Ghost member as unmatched (failed delete)", () => {
    // A de-brother is supposed to delete the Ghost member; if that failed, the member
    // lingers. Its id must NOT be treated as legitimately referenced, so the leftover
    // is flagged rather than hidden in no category (review OFC).
    const report = run({
      profiles: [makeProfile({ ghostMemberId: "g1", debrothered: { isDebrothered: true } })],
      members: [member({ id: "g1", email: "ex.brother@example.test" })],
    });
    expect(report.discrepancies).toEqual([
      {
        category: "unmatchedGhostMember",
        ghostMemberId: "g1",
        ghostValue: "ex.brother@example.test",
      },
    ]);
  });

  it("does not flag a name differing only by Unicode form (NFC-normalized comparison)", () => {
    // Book stores the composed form (é = U+00E9); Ghost returns the decomposed form
    // (e + U+0301). Same name — must not be a permanent false-positive fieldDrift.
    const composed = "José Smyth '84";
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed); // genuinely different code units
    const report = run({
      profiles: [makeProfile({ firstName: "José", ghostMemberId: "g1" })],
      members: [member({ id: "g1", name: decomposed })],
    });
    expect(report.discrepancies.filter((d) => d.field === "name")).toEqual([]);
  });

  it("reports an unmatched Ghost member (a self-signup / historical address)", () => {
    const report = run({
      profiles: [makeProfile({ ghostMemberId: "g1" })],
      members: [member({ id: "g1" }), member({ id: "g2", email: "stranger@example.test" })],
    });
    expect(report.discrepancies).toEqual([
      {
        category: "unmatchedGhostMember",
        ghostMemberId: "g2",
        ghostValue: "stranger@example.test",
      },
    ]);
  });

  it("reports a dangling bigBrotherId as a bookInternalOrphan", () => {
    const report = run({
      profiles: [makeProfile({ id: 5247, ghostMemberId: "g1", bigBrotherId: 9999 })],
      members: [member({ id: "g1" })],
    });
    expect(report.discrepancies).toContainEqual({
      category: "bookInternalOrphan",
      profileId: 5247,
      field: "bigBrotherId",
      bookValue: 9999,
    });
  });

  it("does NOT flag a bigBrotherId that resolves to a live profile", () => {
    const report = run({
      profiles: [
        makeProfile({ id: 5247, ghostMemberId: "g1", bigBrotherId: 5300 }),
        makeProfile({ id: 5300, ghostMemberId: "g2", email: "b@example.test" }),
      ],
      members: [member({ id: "g1" }), member({ id: "g2", email: "b@example.test" })],
    });
    expect(report.discrepancies.filter((d) => d.category === "bookInternalOrphan")).toEqual([]);
  });

  it("reports a users doc with no live profile as a bookInternalOrphan", () => {
    const report = run({
      profiles: [makeProfile({ id: 5247, ghostMemberId: "g1" })],
      members: [member({ id: "g1" })],
      userIds: [5247, 8888],
    });
    expect(report.discrepancies).toContainEqual({
      category: "bookInternalOrphan",
      profileId: 8888,
      field: "users",
    });
  });
});
