import { headshotObjectKey, thumbnailObjectKey } from "@pbe/shared";
import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryImageStore } from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";
import {
  FirestorePointerStore,
  executePurge,
  executeUndo,
  executeUploads,
} from "./bulk-headshots-executor.js";
import {
  type ArtifactItem,
  type PlanRow,
  planPurge,
  planUndo,
  planUploads,
} from "./bulk-headshots-plan.js";

// Runs only under the Firestore emulator (set by emulators:exec); the guard keeps
// a stray direct run from ever touching a real Firestore.
const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

/**
 * The bulk headshot load against real Firestore — reserved for what the planner's
 * unit tests cannot prove: that the `lastUpdateTime` precondition really refuses a
 * record changed between the read and the write, that only the two pointer fields
 * move (not `lastModified`), and that undo clears a pointer the way the DELETE
 * route does (the `headshotVersion` field removed, not nulled).
 */

const STAMP = "2026-09-01T00:00:00.000Z";
const encode = async (bytes: Buffer) => ({
  headshot: Buffer.concat([Buffer.from("H:"), bytes]),
  thumbnail: Buffer.concat([Buffer.from("T:"), bytes]),
});

function row(id: number, expectedVersion: string | null): PlanRow {
  return { id, file: `${id}.png`, expectedVersion, line: 2 };
}

async function doc(db: Firestore, id: number) {
  return (await db.collection("profiles").doc(String(id)).get()).data() ?? {};
}

describe.skipIf(!hasEmulator)("bulk headshots (emulator)", () => {
  let db: Firestore;
  let images: InMemoryImageStore;
  let pointers: FirestorePointerStore;

  beforeEach(async () => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = getFirestore();
    const existing = await db.collection("profiles").get();
    const wipe = db.batch();
    for (const d of existing.docs) {
      wipe.delete(d.ref);
    }
    await wipe.commit();
    const seed = db.batch();
    // 5001 no photo; 5002 a Book photo ("gold2"); 5003 no photo, edited mid-run;
    // 5004 no photo when chosen, but the brother adds his own before the run.
    for (const id of [5001, 5003, 5004]) {
      seed.set(db.collection("profiles").doc(String(id)), {
        ...makeProfile({ id, email: `b${id}@example.test`, lastModified: STAMP }),
        hasHeadshot: false,
      });
    }
    seed.set(db.collection("profiles").doc("5002"), {
      ...makeProfile({ id: 5002, email: "b5002@example.test", lastModified: STAMP }),
      hasHeadshot: true,
      headshotVersion: "gold2",
    });
    await seed.commit();
    await db
      .collection("profiles")
      .doc("5004")
      .update({ hasHeadshot: true, headshotVersion: "gown4" });
    images = new InMemoryImageStore();
    images.seed(headshotObjectKey(5002, "gold2"), Buffer.from("old"));
    images.seed(thumbnailObjectKey(5002, "gold2"), Buffer.from("old"));
    pointers = new FirestorePointerStore(db);
  });

  async function upload() {
    const rows = [row(5001, null), row(5002, "gold2"), row(5003, null), row(5004, null)];
    const targets = new Map(rows.map((r) => [r.id, `gnew${r.id}`]));
    const current = await pointers.read(rows.map((r) => r.id));
    const decisions = planUploads(rows, targets, current);
    // A brother edits #5003 AFTER the read: the conditional write must refuse it.
    await db.collection("profiles").doc("5003").update({ nickname: "Edited mid-run" });
    const saved: ArtifactItem[][] = [];
    const outcome = await executeUploads(
      decisions,
      {
        pointers,
        images,
        encode,
        bytesOf: (id) => Buffer.from(`png${id}`),
        saveArtifact: async (items) => {
          saved.push(items.map((i) => ({ ...i })));
        },
      },
      current,
    );
    return { decisions, outcome, saved };
  }

  it("writes only unchanged records, objects first, pointer fields only", async () => {
    const { decisions, outcome, saved } = await upload();
    expect(decisions.map((d) => d.kind)).toEqual(["upload", "upload", "upload", "changed"]);
    // The undo list went down, all `intended`, before any write.
    expect(saved[0]?.map((i) => i.outcome)).toEqual(["intended", "intended", "intended"]);
    expect(outcome.errors).toEqual([]);
    expect(outcome.items.map((i) => [i.id, i.prior, i.outcome])).toEqual([
      [5001, null, "written"],
      [5002, "gold2", "written"],
      [5003, null, "changed"],
    ]);

    const d5001 = await doc(db, 5001);
    expect(d5001).toMatchObject({
      hasHeadshot: true,
      headshotVersion: "gnew5001",
      lastModified: STAMP,
    });
    expect((await doc(db, 5002)).headshotVersion).toBe("gnew5002");
    expect(await doc(db, 5003)).toMatchObject({ hasHeadshot: false, nickname: "Edited mid-run" });
    expect((await doc(db, 5004)).headshotVersion).toBe("gown4");

    expect(images.has(headshotObjectKey(5001, "gnew5001"))).toBe(true);
    expect(images.has(thumbnailObjectKey(5001, "gnew5001"))).toBe(true);
    // The replaced photo is KEPT (undo is instant; purge is a separate step).
    expect(images.has(headshotObjectKey(5002, "gold2"))).toBe(true);
  });

  it("undo restores prior pointers like the DELETE route and drops this run's objects", async () => {
    const { outcome } = await upload();
    const undo = planUndo(outcome.items, await pointers.read([5001, 5002, 5003]));
    const result = await executeUndo(undo, pointers, images);
    expect(result.reverted).toEqual([5001, 5002]);
    expect(result.errors).toEqual([]);

    const d5001 = await doc(db, 5001);
    expect(d5001.hasHeadshot).toBe(false);
    expect("headshotVersion" in d5001).toBe(false);
    expect(d5001.lastModified).toBe(STAMP);
    expect(await doc(db, 5002)).toMatchObject({ hasHeadshot: true, headshotVersion: "gold2" });
    expect(images.has(headshotObjectKey(5001, "gnew5001"))).toBe(false);
    expect(images.has(headshotObjectKey(5002, "gnew5002"))).toBe(false);
    expect(images.has(headshotObjectKey(5002, "gold2"))).toBe(true);
  });

  it("purge deletes only the replaced photo of a record still showing this run's photo", async () => {
    const { outcome } = await upload();
    const decisions = planPurge(outcome.items, await pointers.read([5001, 5002, 5003]));
    const result = await executePurge(decisions, images);
    expect(result.purged).toEqual([5002]);
    expect(images.has(headshotObjectKey(5002, "gold2"))).toBe(false);
    expect(images.has(thumbnailObjectKey(5002, "gold2"))).toBe(false);
    expect(images.has(headshotObjectKey(5002, "gnew5002"))).toBe(true);
  });

  it("a re-run after success changes nothing", async () => {
    await upload();
    const rows = [row(5001, null), row(5002, "gold2")];
    const decisions = planUploads(
      rows,
      new Map(rows.map((r) => [r.id, `gnew${r.id}`])),
      await pointers.read([5001, 5002]),
    );
    expect(decisions.map((d) => d.kind)).toEqual(["already-done", "already-done"]);
  });
});
