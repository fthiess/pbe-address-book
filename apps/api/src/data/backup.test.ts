import { describe, expect, it } from "vitest";
import {
  BACKUP_SNAPSHOT_VERSION,
  type BackupData,
  buildBackupSnapshot,
  deriveImageManifest,
} from "./backup.js";

/**
 * The image-version manifest (D63's "image-version manifest"; 7b-2). Images are not
 * copied into a backup — GCS object versioning preserves them (D8) — so this list
 * of object keys is the *only* thing tying a snapshot to the right photo versions.
 * If it is wrong, a restore silently reattaches the wrong (or no) headshots.
 */

const profile = (data: Record<string, unknown>) => ({ id: String(data.id), data });

describe("deriveImageManifest", () => {
  it("emits both object keys for a brother with a headshot", () => {
    const manifest = deriveImageManifest([
      profile({ id: 5247, hasHeadshot: true, headshotVersion: "abc123" }),
    ]);
    expect(manifest).toEqual([
      {
        id: 5247,
        version: "abc123",
        headshotKey: "headshots/5247/abc123.webp",
        thumbnailKey: "thumbnails/5247/abc123.webp",
      },
    ]);
  });

  it("omits brothers with no headshot (about two thirds of the roster)", () => {
    const manifest = deriveImageManifest([
      profile({ id: 5001, hasHeadshot: false }),
      profile({ id: 5002 }),
      profile({ id: 5247, hasHeadshot: true, headshotVersion: "v1" }),
    ]);
    expect(manifest.map((entry) => entry.id)).toEqual([5247]);
  });

  it("skips a half-built record rather than emitting a malformed key", () => {
    // `hasHeadshot` set but the version token missing, and vice versa: either way
    // there is no key to pin, and a `headshots/5247/undefined.webp` in a manifest
    // would be worse than an absent entry — it names an object that cannot exist.
    const manifest = deriveImageManifest([
      profile({ id: 5247, hasHeadshot: true }),
      profile({ id: 5248, hasHeadshot: true, headshotVersion: 42 }),
      profile({ id: 5249, headshotVersion: "orphaned" }),
    ]);
    expect(manifest).toEqual([]);
  });

  it("skips a document with no numeric id", () => {
    const manifest = deriveImageManifest([
      profile({ id: "5247", hasHeadshot: true, headshotVersion: "v1" }),
    ]);
    expect(manifest).toEqual([]);
  });

  it("returns an empty manifest for an empty snapshot", () => {
    expect(deriveImageManifest([])).toEqual([]);
  });
});

describe("buildBackupSnapshot", () => {
  const collections: BackupData = {
    profiles: [
      profile({ id: 5247, lastName: "Smyth", hasHeadshot: true, headshotVersion: "v9" }),
      profile({ id: 5001, lastName: "Doe" }),
    ],
    users: [{ id: "5001", data: { id: 5001, stars: [5247] } }],
    config: [{ id: "systemBanner", data: { active: false } }],
  };
  const at = new Date("2026-07-25T19:35:05.480Z");

  it("wraps the collections with the version, the instant, and the manifest", () => {
    const snapshot = buildBackupSnapshot(collections, at);
    expect(snapshot).toMatchObject({
      version: BACKUP_SNAPSHOT_VERSION,
      generatedAt: "2026-07-25T19:35:05.480Z",
      collections,
    });
    expect(snapshot.images).toEqual([
      {
        id: 5247,
        version: "v9",
        headshotKey: "headshots/5247/v9.webp",
        thumbnailKey: "thumbnails/5247/v9.webp",
      },
    ]);
  });

  it("is JSON-round-trippable (it is written to the bucket as a string)", () => {
    const snapshot = buildBackupSnapshot(collections, at);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("declares version 2 — the manual D52 download stays at 1 (collections only)", () => {
    // A reader distinguishes the two envelopes by this number; 7b-3 decides
    // whether to unify them. Pinning it here makes an accidental bump visible.
    expect(BACKUP_SNAPSHOT_VERSION).toBe(2);
  });
});
