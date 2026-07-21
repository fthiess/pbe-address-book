import type { Profile } from "@pbe/shared";
import type { AuditLog } from "../audit/audit-log.js";
import type { GhostCreateResult, GhostLifecycle, GhostMemberDiff } from "./ghost-lifecycle.js";

/** The per-request actor context a `ghost.push` audit entry needs (7a-3a). */
export interface GhostPushContext {
  /** The acting brother's Constitution ID (the session identity). */
  actorId: number;
  /** The request-correlation id (`X-Cloud-Trace-Context`), when available (D99). */
  trace?: string;
}

/**
 * A {@link GhostLifecycle} decorator that emits a `ghost.push` audit entry (D61;
 * ENGINEERING-DESIGN §6.1; 7a-3a) for every create / update / delete it forwards to
 * the wrapped lifecycle — on success **and** on failure. It is constructed **per
 * request**, holding the acting brother's id and trace, so it is a drop-in for the
 * base lifecycle at each write path and needs no change to the {@link GhostLifecycle}
 * seam interface or any of its implementations (the real Admin-API client, the stub,
 * the test fakes) — the reason it holds the actor context as state rather than
 * threading it through every seam method.
 *
 * Recording at the seam is what makes a **failed** push auditable at all: the push is
 * Ghost-first-gated (N65), so a failure aborts the save before its own `profile.*`
 * audit entry is ever written — without this, the only trace of a failed external
 * Ghost mutation would be a bare `502`. The decorator records the attempt, then
 * rethrows the original error unchanged, so the abort-clean contract is untouched.
 *
 * Names-not-values holds (§1.4): an entry carries the target profile id, the
 * operation, and — on an update — the pushed field *names* (`email` / `name` /
 * `allowNewsletterEmail`), never their values.
 */
export class AuditingGhostLifecycle implements GhostLifecycle {
  constructor(
    private readonly inner: GhostLifecycle,
    private readonly audit: AuditLog,
    private readonly clock: () => Date,
    private readonly ctx: GhostPushContext,
  ) {}

  async deleteMember(profile: Profile): Promise<void> {
    try {
      await this.inner.deleteMember(profile);
    } catch (error) {
      this.record(profile.id, "delete", "error");
      throw error;
    }
    this.record(profile.id, "delete", "ok");
  }

  async createMember(profile: Profile): Promise<GhostCreateResult> {
    let result: GhostCreateResult;
    try {
      result = await this.inner.createMember(profile);
    } catch (error) {
      this.record(profile.id, "create", "error");
      throw error;
    }
    this.record(profile.id, "create", "ok");
    return result;
  }

  async updateMember(profile: Profile, diff: GhostMemberDiff): Promise<void> {
    // The pushed field *names* — never their values (D61). `diff` is the changed
    // subset of the three pushed fields (N65), so `Object.keys` is exactly the
    // names-not-values list the audit stream wants.
    const fields = Object.keys(diff);
    try {
      await this.inner.updateMember(profile, diff);
    } catch (error) {
      this.record(profile.id, "update", "error", fields);
      throw error;
    }
    this.record(profile.id, "update", "ok", fields);
  }

  private record(
    targetId: number,
    op: "create" | "update" | "delete",
    outcome: "ok" | "error",
    fields?: readonly string[],
  ): void {
    this.audit.record(
      {
        action: "ghost.push",
        actorId: this.ctx.actorId,
        targetId,
        outcome,
        op,
        ...(fields && fields.length > 0 ? { fields } : {}),
        ...(this.ctx.trace !== undefined ? { trace: this.ctx.trace } : {}),
      },
      this.clock().toISOString(),
    );
  }
}
