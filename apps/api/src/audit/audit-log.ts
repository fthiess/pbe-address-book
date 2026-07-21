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

/** The Ghost-push operation an {@link AuditEntry.op} labels on a `ghost.push` (7a-3a). */
export type GhostPushOp = "create" | "update" | "delete";

/** The audited actions (ENGINEERING-DESIGN §6.1). Grown by later phases. */
export type AuditAction =
  | "profile.update"
  // Authentication events (7a-3a, closing D61's event list). `auth.signin` records
  // a sign-in *attempt* — `ok` carries the authenticated actor, `denied` carries a
  // coarse `reason` code (the API-SPEC §2 AuthError code, never the email or token)
  // and no actor, because a denied sign-in has no established identity. `auth.jwks`
  // is a *distinct* infrastructure fault — Ghost's JWKS key endpoint failed to yield
  // the signing key (a transient availability problem, OFC-223) — kept separate from
  // `auth.signin denied` so a Ghost-side outage never inflates the sign-in-denial
  // metric a burst alert (7a-3c) watches, and vice versa.
  | "auth.signin"
  | "auth.jwks"
  // Headshot sub-resource writes (4c-1; API-SPEC §6). Audited names-not-values as
  // the field name `headshot`; no verification coupling (DECISIONS N42).
  | "headshot.update"
  | "headshot.remove"
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
  // A push of a Book mutation to the external Ghost member record (7a-3a). Emitted
  // at the {@link GhostLifecycle} seam by the AuditingGhostLifecycle decorator, so
  // every create/update/delete — from any call site — is recorded exactly once,
  // **including a failed push**, which the Ghost-first gating (N65) otherwise leaves
  // unaudited because the aborted save never reaches its own `profile.*` entry. The
  // `op` labels the operation; on an update `fields` carries the pushed field *names*.
  | "ghost.push"
  // Admin-triggered read reports over Ghost (5b-2): the Book/Ghost alignment audit
  // (D99/D103) and the email-bounce report (D120). Both read-only; audited as a
  // whole-database action with the discrepancy/row count in `count`.
  | "ghost.audit"
  | "bounce.report";

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
  /**
   * The acting brother's Constitution ID (the session identity). **Optional**
   * because some security events precede identity resolution: a denied or
   * JWKS-failed sign-in (`auth.*`) has no established actor. Every mutation action
   * carries it; only pre-authentication events omit it.
   */
  actorId?: number;
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
  /**
   * The before and after roles of a `role.change` (D106; API-SPEC §5) — role
   * names, not field values, so within the §1.4 boundary. `fromRole` is `brother`
   * for a created-if-absent `users` doc (the role a first sign-in would have
   * given, N44). These feed the D101 forensic privileged-roster log.
   */
  fromRole?: string;
  toRole?: string;
  /**
   * How many of the target's live sessions were revoked as a side effect of this
   * action (OFC-147) — a count, never session contents, so within the §1.4
   * boundary. Present on `profile.debrother` (raise), `profile.delete`, and
   * `role.change`, which actively tear down the target's now-stale sessions.
   * `null` records that revocation was attempted but **failed** (a transient
   * error), so the action fell back to the D22 session cap — a forensic signal,
   * not a count.
   */
  sessionsRevoked?: number | null;
  /**
   * The coarse, machine-readable reason a security event failed — the API-SPEC §2
   * `AuthError` code on an `auth.signin` **denial** (`unlinked_member`,
   * `ambiguous_member`, `debrothered`, `invalid_token`, `invalid_state`). A label,
   * never a value: it is the same code already returned to the client, and carries
   * no email, token, or record content, so it stays within the §1.4 boundary (7a-3a).
   */
  reason?: string;
  /**
   * The operation a `ghost.push` performed against the external Ghost member record
   * (7a-3a) — `create` / `update` / `delete`. A label, not a value. On an `update`
   * the pushed field *names* ride `fields` alongside it (`email`, `name`,
   * `allowNewsletterEmail`); create/delete carry no diff.
   */
  op?: GhostPushOp;
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
      // Omitted for pre-authentication events (a denied/JWKS-failed sign-in has no
      // established actor); present on every mutation action. `0` is not a real
      // Constitution ID, so the `!== undefined` guard never drops a genuine actor.
      ...(entry.actorId !== undefined ? { actorId: entry.actorId } : {}),
      ...(entry.targetId !== undefined ? { targetId: entry.targetId } : {}),
      outcome: entry.outcome,
      ...(entry.fields !== undefined ? { fields: entry.fields } : {}),
      ...(entry.scope !== undefined ? { scope: entry.scope } : {}),
      ...(entry.targetRole !== undefined ? { targetRole: entry.targetRole } : {}),
      ...(entry.count !== undefined ? { count: entry.count } : {}),
      ...(entry.role !== undefined ? { role: entry.role } : {}),
      ...(entry.available !== undefined ? { available: entry.available } : {}),
      ...(entry.fromRole !== undefined ? { fromRole: entry.fromRole } : {}),
      ...(entry.toRole !== undefined ? { toRole: entry.toRole } : {}),
      ...(entry.sessionsRevoked !== undefined ? { sessionsRevoked: entry.sessionsRevoked } : {}),
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      ...(entry.op !== undefined ? { op: entry.op } : {}),
      ...(entry.trace !== undefined ? { trace: entry.trace } : {}),
    });
  }
}
