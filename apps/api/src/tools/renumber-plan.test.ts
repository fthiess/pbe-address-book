import { describe, expect, it } from "vitest";
import type { BackupData, CollectionSnapshot } from "../data/backup.js";
import { validateSnapshot } from "../data/restore.js";
import { makeProfile } from "../test-support/make-profile.js";
import { renumberSnapshot } from "./renumber-plan.js";

// Fake ids only (> #5000). The gap is #5003: #5004–#5006 move down to #5003–#5005.
const GAP = 5003;

function profile(id: number, extra: Record<string, unknown> = {}): CollectionSnapshot {
  return {
    id: String(id),
    data: { ...makeProfile({ id, email: `b${id}@example.test` }), ...extra },
  };
}

function data(): BackupData {
  return {
    profiles: [
      profile(5001),
      profile(5002, { bigBrotherId: 5001, verifiedBy: 5005 }),
      profile(5004, {
        bigBrotherId: 5002,
        hasHeadshot: true,
        headshotVersion: "gabc123",
        verifiedBy: 5004,
      }),
      profile(5005, {
        bigBrotherId: 5004,
        deceasedConsentSnapshot: { shareEmail: true, verifiedBy: 5006 },
        debrotherConsentSnapshot: { shareEmail: false, verifiedBy: 5001 },
        links: [{ label: "x", url: "https://book.example/brother/5006" }],
      }),
      profile(5006, { bigBrotherId: 5005, hasHeadshot: true, headshotVersion: "u-1" }),
    ],
    users: [
      { id: "5001", data: { id: 5001, stars: [5002, 5004, 5006] } },
      { id: "5005", data: { id: 5005, stars: [] } },
    ],
    config: [
      {
        id: "systemBanner",
        data: { active: false, message: "", severity: "info", updatedBy: 5006, updatedAt: "x" },
      },
    ],
  };
}

function ok(result: ReturnType<typeof renumberSnapshot>) {
  if (!result.ok) {
    throw new Error(result.errors.join("\n"));
  }
  return result;
}

const byId = (docs: readonly CollectionSnapshot[], id: string) =>
  docs.find((d) => d.id === id)?.data;

describe("renumberSnapshot", () => {
  it("moves every profile above the gap down one, keys and ids together", () => {
    const result = ok(renumberSnapshot(data(), { gap: GAP, expectShifted: 3 }));
    expect(result.collections.profiles.map((d) => d.id)).toEqual([
      "5001",
      "5002",
      "5003",
      "5004",
      "5005",
    ]);
    for (const doc of result.collections.profiles) {
      expect(doc.data.id).toBe(Number(doc.id));
    }
    expect(result.moves).toEqual([
      { from: 5004, to: 5003 },
      { from: 5005, to: 5004 },
      { from: 5006, to: 5005 },
    ]);
    // Identity is carried by content, not position: the old #5004 is now #5003.
    expect(byId(result.collections.profiles, "5003")?.email).toBe("b5004@example.test");
  });

  it("remaps every id-valued reference above the gap and leaves those below alone", () => {
    const { collections, counts } = ok(renumberSnapshot(data(), { gap: GAP, expectShifted: 3 }));
    expect(byId(collections.profiles, "5002")).toMatchObject({
      bigBrotherId: 5001,
      verifiedBy: 5004,
    });
    expect(byId(collections.profiles, "5003")).toMatchObject({
      bigBrotherId: 5002,
      verifiedBy: 5003,
    });
    expect(byId(collections.profiles, "5004")).toMatchObject({
      bigBrotherId: 5003,
      deceasedConsentSnapshot: { shareEmail: true, verifiedBy: 5005 },
      debrotherConsentSnapshot: { shareEmail: false, verifiedBy: 5001 },
    });
    expect(byId(collections.profiles, "5005")).toMatchObject({ bigBrotherId: 5004 });
    expect(collections.users).toEqual([
      { id: "5001", data: { id: 5001, stars: [5002, 5003, 5005] } },
      { id: "5004", data: { id: 5004, stars: [] } },
    ]);
    expect(byId(collections.config, "systemBanner")?.updatedBy).toBe(5005);
    expect(counts).toEqual({
      profilesMoved: 3,
      bigBrotherIds: 2,
      verifiedBy: 2,
      consentSnapshotVerifiedBy: 1,
      usersMoved: 1,
      stars: 2,
      bannerUpdatedBy: 1,
    });
  });

  it("produces a snapshot the restore validates cleanly", () => {
    const { collections } = ok(renumberSnapshot(data(), { gap: GAP, expectShifted: 3 }));
    const report = validateSnapshot(collections);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("lists a copy for both image objects of every moved brother with a headshot, version unchanged", () => {
    const { imageCopies } = ok(renumberSnapshot(data(), { gap: GAP, expectShifted: 3 }));
    expect(imageCopies).toEqual([
      { from: "headshots/5004/gabc123.webp", to: "headshots/5003/gabc123.webp" },
      { from: "thumbnails/5004/gabc123.webp", to: "thumbnails/5003/gabc123.webp" },
      { from: "headshots/5006/u-1.webp", to: "headshots/5005/u-1.webp" },
      { from: "thumbnails/5006/u-1.webp", to: "thumbnails/5005/u-1.webp" },
    ]);
  });

  it("reports, but never rewrites, a free-text URL naming a moved id", () => {
    const result = ok(renumberSnapshot(data(), { gap: GAP, expectShifted: 3 }));
    expect(result.freeTextHits).toEqual([
      { collection: "profiles", docId: "5005", path: "links[0].url" },
    ]);
    expect(byId(result.collections.profiles, "5004")?.links).toEqual([
      { label: "x", url: "https://book.example/brother/5006" },
    ]);
  });

  it("does not mutate its input, and returns untouched documents as-is", () => {
    const input = data();
    const before = JSON.stringify(input);
    const { collections } = ok(renumberSnapshot(input, { gap: GAP, expectShifted: 3 }));
    expect(JSON.stringify(input)).toBe(before);
    expect(collections.profiles[0]).toBe(input.profiles[0]);
  });

  it("refuses while a profile still holds the gap", () => {
    const input = data();
    input.profiles.push(profile(GAP));
    const result = renumberSnapshot(input, { gap: GAP, expectShifted: 3 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join()).toMatch(/#5003 still exists/u);
  });

  it.each([
    [
      "bigBrotherId",
      (d: BackupData) => Object.assign(d.profiles[1]?.data ?? {}, { bigBrotherId: GAP }),
    ],
    [
      "verifiedBy",
      (d: BackupData) => Object.assign(d.profiles[1]?.data ?? {}, { verifiedBy: GAP }),
    ],
    [
      "consent-snapshot verifiedBy",
      (d: BackupData) =>
        Object.assign(d.profiles[0]?.data ?? {}, { debrotherConsentSnapshot: { verifiedBy: GAP } }),
    ],
    ["a star", (d: BackupData) => (d.users[0]?.data.stars as number[]).push(GAP)],
    [
      "banner updatedBy",
      (d: BackupData) => Object.assign(d.config[0]?.data ?? {}, { updatedBy: GAP }),
    ],
  ])("refuses while %s still references the gap", (_label, mutate) => {
    const input = data();
    mutate(input);
    const result = renumberSnapshot(input, { gap: GAP, expectShifted: 3 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join()).toMatch(/still references #5003/u);
  });

  it("refuses when the count above the gap is not what the operator expected", () => {
    const result = renumberSnapshot(data(), { gap: GAP, expectShifted: 4 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join()).toMatch(
      /Expected exactly #5004–#5007 \(4\).*found 3/u,
    );
  });

  it("refuses a non-contiguous range above the gap, even at the expected count", () => {
    const input = data();
    input.profiles = input.profiles.filter((d) => d.id !== "5005");
    input.profiles.push(profile(5009));
    for (const doc of input.profiles) {
      if (doc.data.bigBrotherId === 5005) doc.data.bigBrotherId = 5004;
    }
    input.users = input.users.filter((d) => d.id !== "5005");
    const result = renumberSnapshot(input, { gap: GAP, expectShifted: 3 });
    expect(result.ok).toBe(false);
  });

  it("refuses a document whose key disagrees with its id", () => {
    const input = data();
    input.profiles[0] = { id: "5001", data: { ...input.profiles[0]?.data, id: 5011 } };
    const result = renumberSnapshot(input, { gap: GAP, expectShifted: 3 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join()).toMatch(/does not carry a matching integer/u);
  });

  it("refuses nonsense options", () => {
    expect(renumberSnapshot(data(), { gap: 0, expectShifted: 3 }).ok).toBe(false);
    expect(renumberSnapshot(data(), { gap: GAP, expectShifted: 0 }).ok).toBe(false);
  });
});
