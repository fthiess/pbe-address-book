import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagnosticLog, type DiagnosticSink, defaultDiagnosticSink } from "./diagnostic-log.js";

/** A capturing sink so tests can assert on the exact serialized record. */
function captureSink(): { records: Record<string, unknown>[]; sink: DiagnosticSink } {
  const records: Record<string, unknown>[] = [];
  return { records, sink: { write: (record) => records.push(record) } };
}

const AT = "2026-07-21T15:00:00.000Z";
const fixedClock = () => new Date(AT);

describe("DiagnosticLog", () => {
  it("labels the stream `diagnostic`, tags severity, and stamps the injected clock", () => {
    const { records, sink } = captureSink();
    new DiagnosticLog(sink, fixedClock).info("cache hydrated");

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      logType: "diagnostic",
      severity: "INFO",
      timestamp: AT,
      message: "cache hydrated",
    });
  });

  it("routes each severity method to its severity tag", () => {
    const { records, sink } = captureSink();
    const log = new DiagnosticLog(sink, fixedClock);
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(records.map((r) => r.severity)).toEqual(["DEBUG", "INFO", "WARNING", "ERROR"]);
  });

  it("carries the structured labels when present and omits them when absent", () => {
    const { records, sink } = captureSink();
    new DiagnosticLog(sink, fixedClock).error("session revocation failed", {
      trace: "t1",
      actorId: 5001,
      targetId: 5247,
      action: "role.change",
      op: "update",
      fields: ["email", "name"],
    });

    expect(records[0]).toEqual({
      logType: "diagnostic",
      severity: "ERROR",
      timestamp: AT,
      message: "session revocation failed",
      trace: "t1",
      actorId: 5001,
      targetId: 5247,
      action: "role.change",
      op: "update",
      fields: ["email", "name"],
    });
  });

  it("omits every optional label when none are supplied", () => {
    const { records, sink } = captureSink();
    new DiagnosticLog(sink, fixedClock).warn("degraded read");
    const entry = records[0] as Record<string, unknown>;
    for (const key of [
      "trace",
      "actorId",
      "targetId",
      "action",
      "op",
      "fields",
      "detail",
      "stack",
    ]) {
      expect(entry).not.toHaveProperty(key);
    }
  });

  it("does not carry a `fields` name list as values — names-not-values (P10)", () => {
    const { records, sink } = captureSink();
    new DiagnosticLog(sink, fixedClock).debug("ghost-lifecycle(stub): would update member", {
      targetId: 5247,
      fields: ["email", "phone"],
    });
    const entry = records[0] as Record<string, unknown>;
    expect(entry.fields).toEqual(["email", "phone"]);
    // The names are present; no value-bearing key rides the entry.
    expect(JSON.stringify(entry)).not.toContain("@");
    expect(entry).not.toHaveProperty("values");
  });

  describe("P10 scrubbing", () => {
    it("scrubs an email out of the free-text message", () => {
      const { records, sink } = captureSink();
      new DiagnosticLog(sink, fixedClock).warn("ghost: member exists with email james@example.com");
      const entry = records[0] as Record<string, unknown>;
      expect(JSON.stringify(entry)).not.toContain("@");
      expect(entry.message).toContain("[email]");
    });

    it("scrubs the `detail` slot — where an upstream error.message lands", () => {
      const { records, sink } = captureSink();
      new DiagnosticLog(sink, fixedClock).error("ghost read failed", {
        detail: "422: a member already exists with email james@example.com",
      });
      const entry = records[0] as Record<string, unknown>;
      expect(entry.detail).not.toContain("@");
      expect(entry.detail).toContain("[email]");
    });

    it("scrubs the `stack` slot", () => {
      const { records, sink } = captureSink();
      new DiagnosticLog(sink, fixedClock).error("unhandled server error", {
        stack: "Error: lookup failed for +16175551234\n    at foo (bar.ts:1:1)",
      });
      expect(JSON.stringify(records[0])).not.toContain("6175551234");
    });
  });
});

describe("defaultDiagnosticSink severity routing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("routes WARNING/ERROR to stderr and INFO/DEBUG to stdout (progress vs errors)", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    defaultDiagnosticSink.write({ severity: "INFO" });
    defaultDiagnosticSink.write({ severity: "DEBUG" });
    defaultDiagnosticSink.write({ severity: "WARNING" });
    defaultDiagnosticSink.write({ severity: "ERROR" });

    expect(out).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalledTimes(2);
  });
});
