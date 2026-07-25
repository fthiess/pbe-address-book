import { describe, expect, it } from "vitest";
import {
  BACKUP_OBJECT_PREFIX,
  InMemoryBackupStore,
  backupObjectName,
  parseBackupObjectName,
} from "./backup-store.js";

/**
 * The automated-backup object store's naming contract (D63/7b-2). The names are
 * load-bearing in two places nothing else guards: the offline restore (D101/7b-3)
 * picks a snapshot by reading them, and {@link InMemoryBackupStore.latest} — the
 * pre-flight staleness check's only input — decides "newest" from them alone.
 */

const AT = new Date("2026-07-25T19:35:05.480Z");

describe("backup object naming", () => {
  it("encodes the instant, shell-safely, under the snapshot prefix", () => {
    expect(backupObjectName(AT)).toBe("backups/2026-07-25T19-35-05-480Z.json");
    expect(backupObjectName(AT).startsWith(BACKUP_OBJECT_PREFIX)).toBe(true);
    // No colons: an operator restoring under pressure types these into a shell.
    expect(backupObjectName(AT)).not.toContain(":");
  });

  it("round-trips through parseBackupObjectName", () => {
    const parsed = parseBackupObjectName(backupObjectName(AT));
    expect(parsed?.toISOString()).toBe(AT.toISOString());
  });

  it("sorts lexicographically by time — the property `latest` depends on", () => {
    const instants = [
      new Date("2026-01-02T00:00:00.000Z"),
      new Date("2026-01-10T00:00:00.000Z"),
      new Date("2026-02-01T00:00:00.000Z"),
      new Date("2026-02-01T09:00:00.000Z"),
      new Date("2026-02-01T10:00:00.000Z"),
    ];
    const names = instants.map(backupObjectName);
    expect([...names].sort()).toEqual(names);
  });

  it("returns null for anything that is not a snapshot name", () => {
    for (const name of [
      "backups/notes.txt",
      "backups/2026-07-25.json",
      "other/2026-07-25T19-35-05-480Z.json",
      "backups/2026-07-25T19-35-05-480Z.json.bak",
      "",
    ]) {
      expect(parseBackupObjectName(name)).toBeNull();
    }
  });

  it("returns null for a well-shaped but impossible instant", () => {
    expect(parseBackupObjectName("backups/2026-13-45T99-99-99-999Z.json")).toBeNull();
  });
});

describe("InMemoryBackupStore", () => {
  it("reports no latest snapshot when empty (the bootstrap case)", async () => {
    expect(await new InMemoryBackupStore().latest()).toBeNull();
  });

  it("picks the newest snapshot regardless of insertion order", async () => {
    const older = backupObjectName(new Date("2026-07-24T03:00:00.000Z"));
    const newest = backupObjectName(new Date("2026-07-25T03:00:00.000Z"));
    const middle = backupObjectName(new Date("2026-07-24T15:00:00.000Z"));
    const store = new InMemoryBackupStore([
      [newest, "{}"],
      [older, "{}"],
      [middle, "{}"],
    ]);
    const latest = await store.latest();
    expect(latest?.name).toBe(newest);
    expect(latest?.takenAt.toISOString()).toBe("2026-07-25T03:00:00.000Z");
  });

  it("ignores foreign objects rather than failing the staleness check", async () => {
    const snapshot = backupObjectName(AT);
    const store = new InMemoryBackupStore([
      ["backups/README.txt", "hand-written note"],
      [snapshot, "{}"],
    ]);
    expect((await store.latest())?.name).toBe(snapshot);
  });

  it("has no latest when the bucket holds only foreign objects", async () => {
    const store = new InMemoryBackupStore([["backups/README.txt", "note"]]);
    expect(await store.latest()).toBeNull();
  });

  it("is create-only — a duplicate name is refused, never silently replaced", async () => {
    const name = backupObjectName(AT);
    const store = new InMemoryBackupStore([[name, "original"]]);
    await expect(store.write(name, "replacement")).rejects.toThrow(/already exists/);
    expect(store.objects.get(name)).toBe("original");
  });
});
