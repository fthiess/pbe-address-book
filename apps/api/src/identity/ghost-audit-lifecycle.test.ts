import { describe, expect, it } from "vitest";
import { AuditLog, type AuditSink } from "../audit/audit-log.js";
import { FailingGhostLifecycle, RecordingGhostLifecycle } from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";
import { AuditingGhostLifecycle } from "./ghost-audit-lifecycle.js";

/** A capturing sink so a test can assert the exact ghost.push record. */
function captureSink(): { records: Record<string, unknown>[]; sink: AuditSink } {
  const records: Record<string, unknown>[] = [];
  return { records, sink: { write: (record) => records.push(record) } };
}

const AT = new Date("2026-07-21T12:00:00.000Z");
const clock = () => AT;
const CTX = { actorId: 5001, trace: "trace-1" };
const PROFILE = makeProfile({
  id: 5247,
  email: "james.smyth.5247@example.test",
  ghostMemberId: "g-5247",
});

describe("AuditingGhostLifecycle", () => {
  it("emits ghost.push op=update with the pushed field NAMES, never values (7a-3a)", async () => {
    const { records, sink } = captureSink();
    const audited = new AuditingGhostLifecycle(
      new RecordingGhostLifecycle(),
      new AuditLog(sink),
      clock,
      CTX,
    );

    await audited.updateMember(PROFILE, {
      email: "james.smyth.5247@example.test",
      name: "James Smyth '84",
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      logType: "audit",
      action: "ghost.push",
      op: "update",
      actorId: 5001,
      targetId: 5247,
      outcome: "ok",
      fields: ["email", "name"],
      trace: "trace-1",
    });
    // Names-not-values: the diff carried an email *value*, but the record must not.
    expect(JSON.stringify(records[0])).not.toContain("@");
  });

  it("records a FAILED update as outcome=error and rethrows so the abort-clean contract holds", async () => {
    const { records, sink } = captureSink();
    const audited = new AuditingGhostLifecycle(
      new FailingGhostLifecycle("update"),
      new AuditLog(sink),
      clock,
      CTX,
    );

    await expect(audited.updateMember(PROFILE, { name: "New Name" })).rejects.toThrow(
      "ghost update failed",
    );
    // The failed push is recorded — the whole point, since Ghost-first gating (N65)
    // aborts the save before its own profile.* audit entry is ever written.
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ action: "ghost.push", op: "update", outcome: "error" });
  });

  it("emits ghost.push op=create on a create, with no diff fields", async () => {
    const { records, sink } = captureSink();
    const recording = new RecordingGhostLifecycle();
    const audited = new AuditingGhostLifecycle(recording, new AuditLog(sink), clock, CTX);

    const result = await audited.createMember(PROFILE);

    expect(result.ghostMemberId).toBe("recreated-5247"); // delegate's return is passed through
    expect(records[0]).toMatchObject({
      action: "ghost.push",
      op: "create",
      outcome: "ok",
      targetId: 5247,
    });
    expect(records[0]).not.toHaveProperty("fields");
  });

  it("emits ghost.push op=delete on a delete", async () => {
    const { records, sink } = captureSink();
    const audited = new AuditingGhostLifecycle(
      new RecordingGhostLifecycle(),
      new AuditLog(sink),
      clock,
      CTX,
    );

    await audited.deleteMember(PROFILE);

    expect(records[0]).toMatchObject({
      action: "ghost.push",
      op: "delete",
      outcome: "ok",
      targetId: 5247,
    });
  });

  it("records a FAILED delete then rethrows the original error", async () => {
    const { records, sink } = captureSink();
    const audited = new AuditingGhostLifecycle(
      new FailingGhostLifecycle("delete"),
      new AuditLog(sink),
      clock,
      CTX,
    );

    await expect(audited.deleteMember(PROFILE)).rejects.toThrow("ghost delete failed");
    expect(records[0]).toMatchObject({ action: "ghost.push", op: "delete", outcome: "error" });
  });
});
