import type { BugReport } from "@pbe/shared";
import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FirestoreBugReportStore } from "./bug-reports.js";

const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

function base(overrides: Partial<Omit<BugReport, "id">> = {}): Omit<BugReport, "id"> {
  return {
    submittedBy: 5247,
    submitterName: "James Smyth '84",
    submittedAt: "2026-06-12T14:02:00.000Z",
    page: "/",
    description: "Something went wrong.",
    status: "new",
    ...overrides,
  };
}

describe.skipIf(!hasEmulator)("FirestoreBugReportStore (emulator)", () => {
  let db: Firestore;

  beforeAll(() => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = getFirestore();
  });

  // A dedicated collection, so it can't touch the profiles-count assertion in
  // cache.emulator.test.ts — but the emulator suites share one Firestore
  // (fileParallelism:false), so this suite still deletes everything it wrote.
  afterEach(async () => {
    const snap = await db.collection("bugReports").get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  });

  it("create mints an id and round-trips the record", async () => {
    const store = new FirestoreBugReportStore(db);
    const created = await store.create(base({ description: "Round-trip me" }));
    expect(created.id).toBeTruthy();
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, description: "Round-trip me", status: "new" });
  });

  it("list returns newest first (by submittedAt)", async () => {
    const store = new FirestoreBugReportStore(db);
    await store.create(base({ submittedAt: "2026-06-10T00:00:00.000Z", description: "older" }));
    await store.create(base({ submittedAt: "2026-06-20T00:00:00.000Z", description: "newer" }));
    const list = await store.list();
    expect(list.map((r) => r.description)).toEqual(["newer", "older"]);
  });

  it("markReviewed flips only the named new reports and counts the transitions", async () => {
    const store = new FirestoreBugReportStore(db);
    const a = await store.create(base({ description: "A" }));
    const b = await store.create(base({ description: "B" }));
    // Re-marking `a` plus an unknown id: only `a` transitions.
    expect(await store.markReviewed([a.id, "missing"])).toBe(1);
    // A second call is a no-op (already reviewed).
    expect(await store.markReviewed([a.id])).toBe(0);
    const list = await store.list();
    expect(list.find((r) => r.id === a.id)?.status).toBe("reviewed");
    expect(list.find((r) => r.id === b.id)?.status).toBe("new");
  });

  it("markReviewed de-duplicates ids so a repeated id can't reject the batch", async () => {
    const store = new FirestoreBugReportStore(db);
    const a = await store.create(base({ description: "A" }));
    // A duplicate id in one commit would make Firestore reject the whole batch;
    // the store must dedupe and count the transition once.
    expect(await store.markReviewed([a.id, a.id, a.id])).toBe(1);
    expect((await store.list())[0]?.status).toBe("reviewed");
  });

  it("markReviewed ignores an unsafe id rather than throwing", async () => {
    const store = new FirestoreBugReportStore(db);
    // `a/b` is not a valid document path; it must be screened, not passed to .doc().
    await expect(store.markReviewed(["a/b"])).resolves.toBe(0);
  });

  it("delete removes a report, is idempotent for an absent id, and no-ops an unsafe id", async () => {
    const store = new FirestoreBugReportStore(db);
    const created = await store.create(base());
    await store.delete(created.id);
    expect(await store.list()).toHaveLength(0);
    await expect(store.delete("already-gone")).resolves.toBeUndefined();
    await expect(store.delete("a/b")).resolves.toBeUndefined();
  });
});
