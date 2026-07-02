/**
 * The audit stream (DECISIONS D61, P10; ENGINEERING-DESIGN §6.1). Book's durable
 * record of mutations and security-relevant events, written as **structured JSON
 * to `stdout`** — no logging SDK, captured by Cloud Logging for free, following
 * the project's "progress to stdout, errors to stderr" convention.
 *
 * THE DISCIPLINE — identifiers and field *names*, never field *values*. An entry
 * records *that* brother #5247's `email`/`phone` changed and *who* changed them,
 * never the address itself. Logs persist under different access controls than the
 * directory, so writing contact values or restricted fields into them would
 * quietly route protected data around the server-side privacy projection (§1.4).
 * The {@link AuditEntry} shape enforces this structurally: it carries a `fields`
 * **name list** and has nowhere to put a value. The one acknowledged edge is that
 * for some actions the *target identifier* is itself the changed value (a
 * `bigBrotherId` set, a brother starred) — those are IDs, not contact data, and
 * stay within the boundary as `targetId`.
 *
 * SCOPE. Phase 2c emits the `profile.update` action from the PATCH path. The
 * module is the **seam** the later privileged actions plug into as their phases
 * land — role change (with before/after, D106), delete, deceased-marking,
 * de-brother (D115), export (D92), banner set/clear (D117), bug reports (D121),
 * and Ghost pushes — each a new {@link AuditAction}, never a new way to log.
 */

/** The audited actions (ENGINEERING-DESIGN §6.1). Grown by later phases. */
export type AuditAction =
  | "profile.update"
  // "View as" impersonation start/stop — security-relevant because the actor's
  // effective powers change (DECISIONS N31).
  | "impersonate.start"
  | "impersonate.stop"
  // Reserved for the phases that build their dedicated server actions:
  | "profile.create"
  | "profile.delete"
  | "profile.verify"
  | "profile.deceased"
  | "profile.debrother"
  | "role.change"
  | "export"
  | "backup.download"
  | "banner.set"
  | "bug.report"
  | "ghost.push";

/** The outcome of an audited action. */
export type AuditOutcome = "ok" | "denied" | "error";

/**
 * One audit entry. There is **no field for a value** — only the changed field
 * *names* (D61). `actorId`/`targetId` are Constitution IDs; `trace` is the
 * Cloud Run request-correlation id when present (D99/R9), tying a save's log
 * lines together.
 */
export interface AuditEntry {
  action: AuditAction;
  /** The acting brother's Constitution ID (the session identity). */
  actorId: number;
  /**
   * The record or resource acted upon (a Constitution ID for profile actions).
   * Omitted for whole-collection actions with no single target — notably
   * `export` (D92), whose subject is the directory, not one brother.
   */
  targetId?: number;
  outcome: AuditOutcome;
  /** The names of the fields the write touched — never their values (D61). */
  fields?: readonly string[];
  /**
   * The egress scope of an `export` (D92) — e.g. `"selection"` or `"view"`. A
   * coarse, non-PII label, not a field value, so it stays within the §1.4 boundary.
   */
  scope?: string;
  /**
   * The role an `impersonate.start` steps down to (N31) — a role name, not a
   * field value, so it is within the §1.4 boundary (the same way `scope` is). The
   * actor's real role is `actorId`'s; this records which projection they assumed.
   */
  targetRole?: string;
  /** The row count of an `export` (D92) — a count, never the exported data. */
  count?: number;
  /**
   * The caller's effective role on an `export` (OFC-117) — a role name, within the
   * §1.4 boundary (like {@link targetRole}). Contextualizes the reported `count`.
   */
  role?: string;
  /**
   * The server-derived ceiling on exportable rows for an `export` (OFC-117): how
   * many records the caller's role can access. Because the CSV is generated
   * client-side (D41), the reported `count` is client-supplied; recording this
   * ceiling (and clamping `count` to it) makes a tampered over-report bounded and
   * a suspicious under-report visibly inconsistent against a known maximum.
   */
  available?: number;
  /** The request-correlation id (`X-Cloud-Trace-Context`), when available (D99). */
  trace?: string;
}

/**
 * Where audit entries go. The default writes structured JSON to stdout; tests
 * inject a capturing sink so they can assert on what was logged (and, crucially,
 * what was *not* — no values).
 */
export interface AuditSink {
  write(record: Record<string, unknown>): void;
}

/** The production sink: one structured-JSON line per entry on stdout (D61). */
export const stdoutAuditSink: AuditSink = {
  write(record) {
    // One line, structured — Cloud Logging parses `jsonPayload.*` for precise
    // queries (jsonPayload.action, jsonPayload.actorId, …). `logType: "audit"`
    // is the label that routes this stream to its longer-retention bucket.
    process.stdout.write(`${JSON.stringify(record)}\n`);
  },
};

/**
 * The audit logger. A thin, injectable wrapper over a {@link AuditSink} that
 * stamps each entry with the `audit` label and serializes it. It does **not**
 * read the wall clock itself — the timestamp is supplied so the same injected
 * clock the write path uses keeps entries deterministic under test.
 */
export class AuditLog {
  constructor(private readonly sink: AuditSink = stdoutAuditSink) {}

  /**
   * Record one audited event. `at` is the entry's ISO timestamp (passed in from
   * the route's injected clock). The serialized record carries only identifiers,
   * the action, the outcome, the field *names*, and the trace id — never a value.
   */
  record(entry: AuditEntry, at: string): void {
    this.sink.write({
      logType: "audit",
      severity: entry.outcome === "ok" ? "INFO" : "WARNING",
      timestamp: at,
      action: entry.action,
      actorId: entry.actorId,
      ...(entry.targetId !== undefined ? { targetId: entry.targetId } : {}),
      outcome: entry.outcome,
      ...(entry.fields !== undefined ? { fields: entry.fields } : {}),
      ...(entry.scope !== undefined ? { scope: entry.scope } : {}),
      ...(entry.targetRole !== undefined ? { targetRole: entry.targetRole } : {}),
      ...(entry.count !== undefined ? { count: entry.count } : {}),
      ...(entry.role !== undefined ? { role: entry.role } : {}),
      ...(entry.available !== undefined ? { available: entry.available } : {}),
      ...(entry.trace !== undefined ? { trace: entry.trace } : {}),
    });
  }
}
