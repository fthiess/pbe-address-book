import { describe, expect, it } from "vitest";
import { AuditLog, type AuditSink } from "./audit-log.js";

/** A capturing sink so tests can assert on the exact serialized record. */
function captureSink(): { records: Record<string, unknown>[]; sink: AuditSink } {
  const records: Record<string, unknown>[] = [];
  return { records, sink: { write: (record) => records.push(record) } };
}

const AT = "2026-06-26T15:00:00.000Z";

describe("AuditLog", () => {
  it("labels the stream `audit` and carries identifiers, action, outcome, and field names", () => {
    const { records, sink } = captureSink();
    new AuditLog(sink).record(
      {
        action: "profile.update",
        actorId: 5247,
        targetId: 5247,
        outcome: "ok",
        fields: ["email", "phone"],
      },
      AT,
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      logType: "audit",
      severity: "INFO",
      timestamp: AT,
      action: "profile.update",
      actorId: 5247,
      targetId: 5247,
      outcome: "ok",
      fields: ["email", "phone"],
    });
  });

  it("records names, never values — no contact value can reach the log", () => {
    const { records, sink } = captureSink();
    new AuditLog(sink).record(
      {
        action: "profile.update",
        actorId: 1,
        targetId: 5247,
        outcome: "ok",
        fields: ["email", "address"],
      },
      AT,
    );

    // The serialized record's values are only identifiers, names, and labels —
    // the names-not-values discipline (D61). Nothing resembling an email/address.
    const entry = records[0] as Record<string, unknown>;
    expect(JSON.stringify(entry)).not.toContain("@");
    expect(entry.fields).toEqual(["email", "address"]);
    // `fields` holds the *names*; there is no value-bearing key on the entry.
    expect(entry).not.toHaveProperty("values");
    expect(entry).not.toHaveProperty("before");
    expect(entry).not.toHaveProperty("after");
  });

  it("omits actorId for a pre-authentication event and carries the reason code (7a-3a)", () => {
    const { records, sink } = captureSink();
    new AuditLog(sink).record(
      // A denied sign-in: no established actor, a coarse reason code, no value.
      { action: "auth.signin", outcome: "denied", reason: "unlinked_member", trace: "t1" },
      AT,
    );

    const entry = records[0] as Record<string, unknown>;
    expect(entry).not.toHaveProperty("actorId");
    expect(entry.action).toBe("auth.signin");
    expect(entry.outcome).toBe("denied");
    expect(entry.reason).toBe("unlinked_member");
    expect(entry.severity).toBe("WARNING");
    // The reason is a machine code — nothing resembling an email or token.
    expect(JSON.stringify(entry)).not.toContain("@");
  });

  it("carries the ghost.push op and pushed field names, never values (7a-3a)", () => {
    const { records, sink } = captureSink();
    new AuditLog(sink).record(
      {
        action: "ghost.push",
        actorId: 5001,
        targetId: 5247,
        outcome: "ok",
        op: "update",
        fields: ["email", "name"],
        trace: "t2",
      },
      AT,
    );

    const entry = records[0] as Record<string, unknown>;
    expect(entry.action).toBe("ghost.push");
    expect(entry.op).toBe("update");
    expect(entry.fields).toEqual(["email", "name"]);
    expect(entry.actorId).toBe(5001);
    expect(entry.targetId).toBe(5247);
    // `fields` holds names; no value-bearing key rides the entry.
    expect(JSON.stringify(entry)).not.toContain("@");
    expect(entry).not.toHaveProperty("values");
  });

  it("tags a non-ok outcome at WARNING and carries the trace id when present", () => {
    const { records, sink } = captureSink();
    new AuditLog(sink).record(
      { action: "role.change", actorId: 1, targetId: 5247, outcome: "denied", trace: "abc123" },
      AT,
    );

    const entry = records[0] as Record<string, unknown>;
    expect(entry.severity).toBe("WARNING");
    expect(entry.outcome).toBe("denied");
    expect(entry.trace).toBe("abc123");
    // No `fields` key when none were supplied (a denied action changed nothing).
    expect(entry).not.toHaveProperty("fields");
  });
});
