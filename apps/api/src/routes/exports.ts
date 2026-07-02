import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { ProfileCache } from "../data/cache.js";
import { effectiveRole } from "../identity/types.js";
import { writeRateLimit } from "../security/rate-limit.js";
import type { Clock } from "./profiles.js";
import { traceId } from "./trace.js";

/**
 * The export-audit notify endpoint (API-SPEC §4; DECISIONS D92/D41). CSV export
 * is generated **client-side** from the already-projected in-memory dataset (D41)
 * — the highest-volume egress of real PII in Book — so it would otherwise leave
 * no server-side trail. This is the **thin fire-and-forget ping** that closes
 * that gap: the client, having generated the file, POSTs here and the server
 * writes one `export` audit entry (actor, scope, row-count, timestamp). It moves
 * **no profile data** — only a coarse scope label and a count — so it stays well
 * inside the audit's names-not-values boundary (§1.4/D61).
 *
 * Gated to managers/admins: export is a directory-maintenance action and the
 * action bar that triggers it is staff-only (D41). A brother has no export UI;
 * the server enforces the same boundary so the endpoint cannot be used to forge
 * an export record from an ordinary session.
 */
export interface ExportRoutesConfig {
  gate: preHandlerHookHandler;
  audit: AuditLog;
  clock: Clock;
  /** The in-memory dataset — the server-side source of the accessible-row ceiling (OFC-117). */
  cache: ProfileCache;
}

/** The egress scopes the client reports — the selected rows, or the whole current view. */
const SCOPES = new Set(["selection", "view"]);

export function registerExportRoutes(app: FastifyInstance, config: ExportRoutesConfig): void {
  app.post(
    "/api/exports",
    { preHandler: config.gate, config: writeRateLimit() },
    async (request, reply) => {
      const session = request.session;
      if (!session) {
        return reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
      }
      // The effective role gates export, so a "View as brother" admin is correctly
      // refused — they have no export UI in that projection and the server agrees (N31).
      const actor = session.identity;
      const role = effectiveRole(session);
      if (role !== "manager" && role !== "admin") {
        return reply.code(403).send({ error: "forbidden", message: "Export is staff-only." });
      }

      const body = (request.body ?? {}) as { scope?: unknown; count?: unknown };
      const scope =
        typeof body.scope === "string" && SCOPES.has(body.scope) ? body.scope : undefined;
      const count =
        typeof body.count === "number" && Number.isInteger(body.count) && body.count >= 0
          ? body.count
          : undefined;
      if (scope === undefined || count === undefined) {
        return reply.code(400).send({
          error: "bad_request",
          message: "An export ping needs a scope ('selection' | 'view') and a non-negative count.",
        });
      }

      // The CSV is generated client-side (D41), so the reported `count` is
      // attacker-/bug-influenced — the audit is the one server-side PII-egress
      // signal, so it must not simply trust it (OFC-117). Bound the count by the
      // server-side number of rows this role can actually export (staff project
      // every record), and record that ceiling plus the caller's role: a tampered
      // over-report is capped, and a suspicious under-report is now visibly
      // inconsistent against a known maximum.
      const available = config.cache.size;
      const boundedCount = Math.min(count, available);

      config.audit.record(
        {
          action: "export",
          actorId: actor.profileId,
          outcome: "ok",
          scope,
          count: boundedCount,
          role,
          available,
          trace: traceId(request),
        },
        config.clock().toISOString(),
      );

      return reply.code(204).send();
    },
  );
}
