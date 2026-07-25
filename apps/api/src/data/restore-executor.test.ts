import { describe, expect, it } from "vitest";
import type { BackupData, CollectionSnapshot } from "./backup.js";
import {
  InMemoryRestoreTarget,
  executeRestore,
  planRestore,
  readCurrentDocIds,
} from "./restore-executor.js";

/**
 * The restore is a **replacement**, not a merge (D63) — the property these tests
 * exist to pin. A `set()`-only restore looks correct on every record it writes and
 * is still wrong, because the records it does *not* write survive; that is the
 * failure `seed-staging.ts` records from the first Phase-2c staging deploy.
 */

const doc = (id: number, data: Record<string, unknown> = {}): CollectionSnapshot => ({
  id: String(id),
  data: { id, ...data },
});

const dataset = (overrides: Partial<BackupData> = {}): BackupData => ({
  profiles: [],
  users: [],
  config: [],
  ...overrides,
});

describe("planRestore", () => {
  it("deletes what the snapshot omits and writes everything it names", () => {
    const plan = planRestore(
      { profiles: ["5001", "5002", "5003"], users: ["5001"], config: ["systemBanner"] },
      dataset({ profiles: [doc(5001), doc(5099)], config: [{ id: "systemBanner", data: {} }] }),
    );
    const profiles = plan.collections.find((entry) => entry.collection === "profiles");
    expect(profiles?.deleteIds).toEqual(["5002", "5003"]);
    expect(profiles?.writeCount).toBe(2);
    // The `users` doc the snapshot omits goes, the config singleton stays.
    expect(plan.collections.find((entry) => entry.collection === "users")?.deleteIds).toEqual([
      "5001",
    ]);
    expect(plan.collections.find((entry) => entry.collection === "config")?.deleteIds).toEqual([]);
    expect(plan.totalDeletes).toBe(3);
    expect(plan.totalWrites).toBe(3);
  });

  it("plans a full wipe when the snapshot is empty", () => {
    const plan = planRestore({ profiles: ["5001"], users: [], config: [] }, dataset());
    expect(plan.totalDeletes).toBe(1);
    expect(plan.totalWrites).toBe(0);
  });
});

describe("executeRestore", () => {
  it("leaves each collection holding exactly the snapshot's documents", async () => {
    const target = new InMemoryRestoreTarget({
      profiles: [doc(5001, { name: "stale" }), doc(5002)],
      users: [doc(5002, { stars: [5001] })],
      config: [{ id: "systemBanner", data: { active: true } }],
    });
    await executeRestore(
      target,
      dataset({
        profiles: [doc(5001, { name: "restored" }), doc(5003)],
        config: [{ id: "systemBanner", data: { active: false } }],
      }),
    );
    expect([...target.collections.profiles.keys()].sort()).toEqual(["5001", "5003"]);
    expect(target.collections.profiles.get("5001")).toEqual({ id: 5001, name: "restored" });
    // The users doc the snapshot omits is gone, not merely left alone.
    expect([...target.collections.users.keys()]).toEqual([]);
    expect(target.collections.config.get("systemBanner")).toEqual({ active: false });
  });

  it("overwrites rather than merges — a field the snapshot omits is gone", async () => {
    const target = new InMemoryRestoreTarget({ profiles: [doc(5001, { adminNote: "leftover" })] });
    await executeRestore(target, dataset({ profiles: [doc(5001)] }));
    expect(target.collections.profiles.get("5001")).toEqual({ id: 5001 });
  });

  it("is idempotent — a re-run after a partial failure converges", async () => {
    const target = new InMemoryRestoreTarget({ profiles: [doc(5002)] });
    const snapshot = dataset({ profiles: [doc(5001)] });
    await executeRestore(target, snapshot);
    const second = await executeRestore(target, snapshot);
    expect(second.totalDeletes).toBe(0);
    expect([...target.collections.profiles.keys()]).toEqual(["5001"]);
  });

  it("reports the same plan it executed", async () => {
    const target = new InMemoryRestoreTarget({ profiles: [doc(5002)] });
    const before = await readCurrentDocIds(target);
    const snapshot = dataset({ profiles: [doc(5001)] });
    const expected = planRestore(before, snapshot);
    expect(await executeRestore(target, snapshot)).toEqual(expected);
  });

  it("emits progress only for collections it actually touched", async () => {
    const target = new InMemoryRestoreTarget({ profiles: [doc(5002)] });
    const lines: string[] = [];
    await executeRestore(target, dataset({ profiles: [doc(5001)] }), (line) => lines.push(line));
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.includes("profiles"))).toBe(true);
  });
});
