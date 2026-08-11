import { canExportCsv } from "@pbe/shared";
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
 * **The gate is per-scope, not per-endpoint (OFC-411).** The two CSV scopes stay
 * staff-only — export is a directory-maintenance action, and `canExportCsv` is the
 * *same* predicate the button consults, so the client and server cannot drift into
 * disagreeing about who may export. The `clipboard` scope is open to every role,
 * because Copy Emails now is: an ordinary brother's bulk copy is precisely the
 * egress this endpoint exists to make visible, and refusing his ping would leave
 * the newly-widest audience as the one with no trail at all.
 *
 * ⚠ **An unaudited copy is still possible and always was** — the addresses are in
 * the browser, the ping is fire-and-forget, and a client can simply not send it.
 * This records the honest client's egress, which is what makes *ordinary* use
 * measurable and *sustained* use conspicuous. It is not, and cannot be, a control.
 */
export interface ExportRoutesConfig {
  gate: preHandlerHookHandler;
  audit: AuditLog;
  clock: Clock;
  /** The in-memory dataset — the server-side source of the accessible-row ceiling (OFC-117). */
  cache: ProfileCache;
}

/**
 * The egress scopes the client reports — the selected rows, the whole current view,
 * or (D167) the **clipboard** copy of the selected brothers' email addresses.
 *
 * `clipboard` shares this endpoint rather than getting one of its own because it is
 * the same event in every way that matters to the audit: staff-gated, client-side,
 * bulk PII leaving the app with no other server-side trace. The alternative was a
 * silent second egress door beside the one D92 exists to close.
 */
const SCOPES = new Set(["selection", "view", "clipboard"]);

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

      const body = (request.body ?? {}) as { scope?: unknown; count?: unknown; columns?: unknown };
      const scope =
        typeof body.scope === "string" && SCOPES.has(body.scope) ? body.scope : undefined;
      const count =
        typeof body.count === "number" && Number.isInteger(body.count) && body.count >= 0
          ? body.count
          : undefined;
      // Which of the two CSVs ran (OFC-403). Optional, and meaningless on a
      // `clipboard` ping — a rejected value is dropped rather than 400-ing, because
      // the audit entry is worth more than the strictness: a ping that arrives with
      // a garbled variant should still record that an export happened.
      const columns =
        body.columns === "all" || body.columns === "displayed" ? body.columns : undefined;
      if (scope === undefined || count === undefined) {
        return reply.code(400).send({
          error: "bad_request",
          message:
            "An export ping needs a scope ('selection' | 'view' | 'clipboard') and a non-negative count.",
        });
      }

      // Validated *after* the body, so a malformed request from a brother is told
      // what is wrong with it rather than being refused as if the scope had been the
      // problem. The CSV scopes are staff-only; `clipboard` is open to every role.
      if (scope !== "clipboard" && !canExportCsv(role)) {
        return reply.code(403).send({ error: "forbidden", message: "Export is staff-only." });
      }

      // The CSV is generated client-side (D41), so the reported `count` is
      // attacker-/bug-influenced — the audit is the one server-side PII-egress
      // signal, so it must not simply trust it (OFC-117). Bound the count by the
      // dataset size and record that ceiling plus the caller's role: a tampered
      // over-report is capped, and a suspicious under-report is visibly
      // inconsistent against a known maximum.
      //
      // ⚠ For a brother (OFC-411) this ceiling is **loose** — the whole dataset,
      // not the subset he can see, and far above the 50 his Copy Emails will
      // actually yield. That is deliberate: the tighter bound would clamp a
      // tampered "1200 copied" down to a perfectly ordinary-looking 50 and erase
      // the very anomaly this field exists to expose. A count that dwarfs what his
      // role's cap allows should stay legible as the outlier it is.
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
          ...(columns === undefined ? {} : { columns }),
          trace: traceId(request),
        },
        config.clock().toISOString(),
      );

      return reply.code(204).send();
    },
  );
}
