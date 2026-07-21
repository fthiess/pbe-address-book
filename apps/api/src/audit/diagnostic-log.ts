/**
 * The diagnostic stream (DECISIONS D61, P10, N127; ENGINEERING-DESIGN §6.1). The
 * second of Book's three log streams — the platform request log is the access
 * stream (D142, no app-side reimplementation) and {@link AuditLog} is the durable
 * audit stream. This is the severity-tagged **application** log for
 * troubleshooting: cache hydration, degraded-but-successful Ghost reads, Ghost
 * push/stub activity, unexpected states, and the genericized 500's real error.
 *
 * SHAPE — deliberately the sibling of `audit-log.ts`: structured JSON, no logging
 * SDK (D61), an injectable {@link DiagnosticSink} for tests, and an injected clock
 * so entries are deterministic under test. One `logType: "diagnostic"` spans every
 * severity; `severity` (`DEBUG`…`ERROR`) is the discriminator a 7a-3c metric or
 * retention rule keys on, so an ERROR is `severity: "ERROR"`, never a second
 * `logType` to union.
 *
 * THE P10 DISCIPLINE, HERE. Unlike an {@link AuditEntry} — which has nowhere to
 * put a value — a diagnostic entry carries free text, so names-not-values is
 * enforced in two layers. First, by shape: identifiers and field names ride the
 * structured {@link DiagnosticLabels} slots (`actorId`, `targetId`, `fields`),
 * and `message` is meant to be a **constant**. Second, by a safety net: every
 * free-text field (`message`, `detail`, `stack`) passes through {@link scrub}
 * before it reaches the sink, so an upstream error echoing a member email cannot
 * carry it into a log that persists under different access controls than the
 * directory (§1.4). Request/response bodies and Ghost payloads are never passed
 * in at all.
 */

import { scrub } from "./scrub.js";

/** Severity tags for the diagnostic stream (ENGINEERING-DESIGN §6.1). */
export type DiagnosticSeverity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

/** "Now", injectable for deterministic tests (mirrors the routes' `Clock`). */
export type Clock = () => Date;

/**
 * The structured, value-free context a diagnostic entry may carry. Every field is
 * an identifier, a name, a coarse label, or a bounded free-text detail — never a
 * record value. The free-text `detail`/`stack` are scrubbed before write; the
 * identifier and name slots need no scrubbing (they are IDs and field names).
 */
export interface DiagnosticLabels {
  /** The request-correlation id (`X-Cloud-Trace-Context`), when available (D99). */
  trace?: string;
  /** The acting brother's Constitution ID, when the site has one. */
  actorId?: number;
  /** The record or resource acted upon (a Constitution ID). */
  targetId?: number;
  /** A coarse action label (an {@link AuditAction} string, when the site has one). */
  action?: string;
  /** A coarse operation label (e.g. a Ghost `create`/`update`/`delete`). */
  op?: string;
  /** The field *names* a diagnostic touched — never their values (P10). */
  fields?: readonly string[];
  /** Bounded upstream detail (e.g. `error.message`) — **scrubbed** before write. */
  detail?: string;
  /** A stack trace on an ERROR — **scrubbed** before write. */
  stack?: string;
}

/**
 * Where diagnostic entries go. The default routes by severity; tests inject a
 * capturing sink to assert on what was written (and, crucially, that a PII shape
 * was scrubbed out of it).
 */
export interface DiagnosticSink {
  write(record: Record<string, unknown>): void;
}

/**
 * The production sink: one structured-JSON line per entry, routed by severity to
 * honor the project convention — **progress to `stdout`, errors to `stderr`**.
 * `INFO`/`DEBUG` go to stdout; `WARNING`/`ERROR` to stderr. Cloud Logging keys on
 * the explicit `severity` field regardless of stream, so the split is purely
 * convention-fidelity; it also preserves each migrated site's original stream.
 */
export const defaultDiagnosticSink: DiagnosticSink = {
  write(record) {
    const line = `${JSON.stringify(record)}\n`;
    const severity = record.severity;
    if (severity === "ERROR" || severity === "WARNING") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  },
};

/**
 * The diagnostic logger — a thin, injectable wrapper over a {@link DiagnosticSink}
 * that stamps each entry with the `diagnostic` label and its severity, scrubs the
 * free-text fields, and serializes. Mirrors {@link AuditLog}; the four severity
 * methods are the ergonomic surface over one private `emit`.
 */
export class DiagnosticLog {
  constructor(
    private readonly sink: DiagnosticSink = defaultDiagnosticSink,
    private readonly clock: Clock = () => new Date(),
  ) {}

  debug(message: string, labels?: DiagnosticLabels): void {
    this.emit("DEBUG", message, labels);
  }

  info(message: string, labels?: DiagnosticLabels): void {
    this.emit("INFO", message, labels);
  }

  warn(message: string, labels?: DiagnosticLabels): void {
    this.emit("WARNING", message, labels);
  }

  error(message: string, labels?: DiagnosticLabels): void {
    this.emit("ERROR", message, labels);
  }

  private emit(severity: DiagnosticSeverity, message: string, labels: DiagnosticLabels = {}): void {
    this.sink.write({
      logType: "diagnostic",
      severity,
      timestamp: this.clock().toISOString(),
      // Scrubbed even though `message` is meant to be constant — uniform, cheap,
      // and a constant passes through unchanged. Belt and braces (P10).
      message: scrub(message),
      ...(labels.trace !== undefined ? { trace: labels.trace } : {}),
      ...(labels.actorId !== undefined ? { actorId: labels.actorId } : {}),
      ...(labels.targetId !== undefined ? { targetId: labels.targetId } : {}),
      ...(labels.action !== undefined ? { action: labels.action } : {}),
      ...(labels.op !== undefined ? { op: labels.op } : {}),
      ...(labels.fields !== undefined ? { fields: labels.fields } : {}),
      // The two vectors that can actually carry an interpolated value — scrubbed.
      ...(labels.detail !== undefined ? { detail: scrub(labels.detail) } : {}),
      ...(labels.stack !== undefined ? { stack: scrub(labels.stack) } : {}),
    });
  }
}

/**
 * The default diagnostic logger — one shared instance the clock-less deep modules
 * (cache hydration, the Ghost provider/reader, the stub lifecycle, the dev-guard
 * alert, the entry-point banner) import and use directly, the counterpart to the
 * per-request `AuditLog` the routes thread. Request-scoped sites still pass a
 * `trace` label so their lines correlate. Tests construct their own
 * {@link DiagnosticLog} with a capturing sink rather than reaching for this.
 */
export const diagnosticLog = new DiagnosticLog();
