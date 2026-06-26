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
