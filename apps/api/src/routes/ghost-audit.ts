import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import { planBounceReport } from "../audit/bounce-report.js";
import { planGhostAudit } from "../audit/ghost-audit.js";
import type { ProfileCache } from "../data/cache.js";
import type { AdminUserStore } from "../data/users.js";
import type { GhostReader } from "../identity/ghost-reader.js";
import { readRateLimit } from "../security/rate-limit.js";
import { requireEffectiveAdmin } from "./privileged-support.js";
import type { Clock } from "./profiles.js";
import { traceId } from "./trace.js";

export interface GhostAuditRoutesConfig {
  gate: preHandlerHookHandler;
  cache: ProfileCache;
  adminUsers: AdminUserStore;
  /**
   * The read-only Ghost seam. **Optional**: when Ghost isn't configured (local dev,
   * or a deploy without the Admin key) there is nothing to reconcile against, so
   * both routes fail closed with `503` — mirroring the roster verifier, and unlike
   * the write lifecycle's succeed-and-log stub (a read has nothing to stub).
   */
  ghostReader?: GhostReader;
  audit: AuditLog;
  clock: Clock;
}

/**
 * The two admin-only, **read-only** Ghost report endpoints (Phase 5b-2), both
 * returning JSON the SPA formats into a download (the audit → Markdown, the bounce
 * report → CSV): nothing is rendered in Book's UI (D120 for the bounce report; the
 * 5b-2 decision extends the same download-only treatment to the audit).
 *
 *  - `GET /api/admin/ghost-audit` — the Book/Ghost alignment audit (D55/D99/D103),
 *    report-only in every category (the 5b-2 amendment to D103; it writes nothing
 *    into Book).
 *  - `GET /api/admin/bounce-report` — the email-bounce report (D120).
 *
 * Both are `GET` (read-only, like `GET /api/admin/backup`), admin-only at effective
 * role (N31, so a "View as" step-down loses the power), rate-limited, `no-store`,
 * and audited (whole-database actions, so no single `targetId`).
 */
export function registerGhostAuditRoutes(
  app: FastifyInstance,
  config: GhostAuditRoutesConfig,
): void {
  const { gate, cache, adminUsers, ghostReader, audit, clock } = config;

  app.get(
    "/api/admin/ghost-audit",
    { preHandler: gate, config: readRateLimit() },
    async (request, reply) => {
      const actorId = requireEffectiveAdmin(request, reply, {
        action: "ghost.audit",
        audit,
        clock,
      });
      if (actorId === null) {
        return reply;
      }
      if (!ghostReader) {
        return ghostUnconfigured(reply);
      }
      const now = clock();
      let report: ReturnType<typeof planGhostAudit>;
      try {
        const [members, newsletterEvents, userIds] = await Promise.all([
          ghostReader.listMembers(),
          ghostReader.listNewsletterEvents(),
          adminUsers.listUserIds(),
        ]);
        report = planGhostAudit({
          profiles: cache.allProfiles(),
          userIds,
          members,
          newsletterEvents,
          generatedAt: now.toISOString(),
        });
      } catch (error) {
        return ghostReadFailed(reply, request, error);
      }
      audit.record(
        {
          action: "ghost.audit",
          actorId,
          outcome: "ok",
          count: report.discrepancies.length,
          trace: traceId(request),
        },
        now.toISOString(),
      );
      return reply.header("Cache-Control", "no-store").send(report);
    },
  );

  app.get(
    "/api/admin/bounce-report",
    { preHandler: gate, config: readRateLimit() },
    async (request, reply) => {
      const actorId = requireEffectiveAdmin(request, reply, {
        action: "bounce.report",
        audit,
        clock,
      });
      if (actorId === null) {
        return reply;
      }
      if (!ghostReader) {
        return ghostUnconfigured(reply);
      }
      const now = clock();
      let report: ReturnType<typeof planBounceReport>;
      try {
        const [members, bounceEvents, newsletterEmails] = await Promise.all([
          ghostReader.listMembers(),
          ghostReader.listBounceEvents(),
          ghostReader.listNewsletterEmails(),
        ]);
        report = planBounceReport({
          members,
          bounceEvents,
          newsletterEmails,
          generatedAt: now.toISOString(),
        });
      } catch (error) {
        return ghostReadFailed(reply, request, error);
      }
      audit.record(
        {
          action: "bounce.report",
          actorId,
          outcome: "ok",
          count: report.rows.length,
          trace: traceId(request),
        },
        now.toISOString(),
      );
      return reply.header("Cache-Control", "no-store").send(report);
    },
  );
}

/** `503` — Ghost isn't configured, so there is nothing to reconcile/report against. */
function ghostUnconfigured(reply: FastifyReply): FastifyReply {
  return reply
    .code(503)
    .send({ error: "ghost_unconfigured", message: "The Ghost integration is not configured." });
}

/**
 * `502` — a Ghost read failed. Sent via `reply.code` (not thrown) so it carries this
 * specific body rather than being genericized to a 500 by the server error handler.
 * The underlying Ghost error is logged server-side (it may name internal detail), never returned.
 */
function ghostReadFailed(
  reply: FastifyReply,
  request: FastifyRequest,
  error: unknown,
): FastifyReply {
  const trace = traceId(request);
  process.stderr.write(
    `${JSON.stringify({
      logType: "error",
      severity: "ERROR",
      message: `ghost read failed: ${(error as Error).message}`,
      ...(trace !== undefined ? { trace } : {}),
    })}\n`,
  );
  return reply
    .code(502)
    .send({ error: "ghost_read_failed", message: "Could not reach the newsletter system." });
}
