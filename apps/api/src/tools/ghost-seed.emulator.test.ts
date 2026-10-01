import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, type Timestamp, getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeToken } from "../data/profiles.js";
import { makeProfile } from "../test-support/make-profile.js";
import { type SeedGhostClient, executeGhostSeed } from "./ghost-seed-executor.js";
import type { SeedAction } from "./ghost-seed-plan.js";

// Runs only under the Firestore emulator (set by emulators:exec); the guard keeps
// a stray direct run from ever touching a real Firestore.
const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

/**
 * The Ghost seed against real Firestore — reserved for what the planner's unit
 * tests cannot prove: that the plan-time `lastUpdateTime` precondition really
 * refuses a record changed since the plan, that only the planned fields move (not
 * `lastModified`), and that a failed Ghost email move withholds the Book write.
 */

const STAMP = "2026-09-16T01:01:39.574Z";

class FakeGhost implements SeedGhostClient {
  readonly emails = new Map<string, string>();
  readonly failOn = new Set<string>();

  async memberEmail(memberId: string): Promise<string | null> {
    return this.emails.get(memberId) ?? null;
  }

  async setMemberEmail(memberId: string, email: string): Promise<void> {
    if (this.failOn.has(memberId)) {
      throw new Error("ghost is down");
    }
    this.emails.set(memberId, email);
  }
}

describe.skipIf(!hasEmulator)("ghost seed (emulator)", () => {
  let db: Firestore;
  let ghost: FakeGhost;

  async function data(id: number) {
    return (await db.collection("profiles").doc(String(id)).get()).data() ?? {};
  }

  async function action(
    id: number,
    over: Partial<SeedAction<string>>,
  ): Promise<SeedAction<string>> {
    const snap = await db.collection("profiles").doc(String(id)).get();
    return {
      docId: String(id),
      token: encodeToken(snap.updateTime as Timestamp),
      ghostMemberId: `m${id}`,
      memberEmail: `b${id}@example.test`,
      matchedOn: "email",
      prior: {},
      ...over,
    };
  }

  beforeEach(async () => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = getFirestore();
    ghost = new FakeGhost();
    const existing = await db.collection("profiles").get();
    const wipe = db.batch();
    for (const d of existing.docs) {
      wipe.delete(d.ref);
    }
    await wipe.commit();
    const seed = db.batch();
    for (const id of [5001, 5002, 5003, 5004]) {
      seed.set(db.collection("profiles").doc(String(id)), {
        ...makeProfile({ id, email: `b${id}@example.test`, lastModified: STAMP }),
        allowNewsletterEmail: true,
        newsletterConsentChangedAt: STAMP,
      });
    }
    await seed.commit();
  });

  it("writes only the planned fields, and skips a record edited since the plan", async () => {
    const plain = await action(5001, {});
    const full = await action(5002, {
      adminNote: "from Ghost",
      consent: {
        allowNewsletterEmail: false,
        changedAt: "2024-03-02T10:00:00.000Z",
        source: "event",
      },
    });
    const stale = await action(5003, {});
    // A brother edits #5003 between the plan and the apply.
    await db.collection("profiles").doc("5003").update({ phone: "555-0100" });

    const outcome = await executeGhostSeed(db, ghost, [plain, full, stale]);

    expect(outcome.written.sort()).toEqual(["5001", "5002"]);
    expect(outcome.skipped).toEqual(["5003"]);
    expect(outcome.failed).toEqual([]);

    const first = await data(5001);
    expect(first.ghostMemberId).toBe("m5001");
    expect(first.allowNewsletterEmail).toBe(true);
    expect(first.newsletterConsentChangedAt).toBe(STAMP);
    expect(first.lastModified).toBe(STAMP);
    expect(first.adminNote).toBeUndefined();

    const second = await data(5002);
    expect(second.ghostMemberId).toBe("m5002");
    expect(second.adminNote).toBe("from Ghost");
    expect(second.allowNewsletterEmail).toBe(false);
    expect(second.newsletterConsentChangedAt).toBe("2024-03-02T10:00:00.000Z");
    expect(second.lastModified).toBe(STAMP);

    expect((await data(5003)).ghostMemberId).toBeUndefined();
  });

  it("moves the Ghost member to the primary address before linking, and withholds the link when Ghost fails", async () => {
    ghost.emails.set("m5001", "Old1@example.test");
    ghost.emails.set("m5002", "old2@example.test");
    ghost.emails.set("m5003", "someone-else@example.test");
    ghost.emails.set("m5004", "b5004@example.test");
    ghost.failOn.add("m5002");
    const push = (id: number) => ({
      matchedOn: "alternateEmail" as const,
      ghostEmailPush: { from: `old${id - 5000}@example.test`, to: `b${id}@example.test` },
    });

    const outcome = await executeGhostSeed(db, ghost, [
      await action(5001, push(5001)),
      await action(5002, push(5002)),
      // Ghost no longer holds the address the plan was reviewed against.
      await action(5003, push(5003)),
      // Already at the primary address (a re-run): nothing to push, link proceeds.
      await action(5004, push(5004)),
    ]);

    expect(outcome.ghostPushed).toEqual([
      { docId: "5001", memberId: "m5001", from: "old1@example.test", to: "b5001@example.test" },
    ]);
    expect(ghost.emails.get("m5001")).toBe("b5001@example.test");
    expect(outcome.ghostFailed).toEqual([
      "5002: ghost is down",
      "5003: the member's email changed since the plan",
    ]);
    expect(outcome.written.sort()).toEqual(["5001", "5004"]);
    expect((await data(5002)).ghostMemberId).toBeUndefined();
    expect((await data(5003)).ghostMemberId).toBeUndefined();
  });
});
