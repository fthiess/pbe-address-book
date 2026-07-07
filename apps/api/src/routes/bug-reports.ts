import {
  type AdminBugReport,
  type BugReport,
  type BugReportClientContext,
  MAX_BUG_REPORT_DESCRIPTION,
  formatCanonicalName,
} from "@pbe/shared";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { BugReportStore } from "../data/bug-reports.js";
import type { ProfileCache } from "../data/cache.js";
import { bugReportRateLimit, readRateLimit, writeRateLimit } from "../security/rate-limit.js";
import { requireEffectiveAdmin } from "./privileged-support.js";
import type { Clock } from "./profiles.js";
import { traceId } from "./trace.js";

// Generous caps on the client-supplied context strings — long enough to never
// truncate a real value, short enough that a report cannot be used to store bulk
// data. `description` is capped by the shared MAX_BUG_REPORT_DESCRIPTION (D86).
const MAX_PAGE = 512;
const MAX_URL = 1024;
const MAX_USER_AGENT = 600;
const MAX_VIEWPORT = 32;
const MAX_APP_VERSION = 100;
/** Upper bound on the mark-reviewed batch — far above any real queue depth. */
const MAX_MARK_IDS = 1000;

/**
 * Trim a candidate string and cap its length; returns undefined for a
 * non-string or an empty-after-trim value, so an absent/blank field is simply
 * omitted rather than stored as `""`.
 */
function trimmedField(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed.slice(0, max);
}

/** Build the optional, non-PII client context from the request body, dropping empties. */
function readClientContext(raw: unknown): BugReportClientContext | undefined {
  if (raw === null || typeof raw !== "object") {
    return undefined;
  }
  const source = raw as Record<string, unknown>;
  const context: BugReportClientContext = {};
  const userAgent = trimmedField(source.userAgent, MAX_USER_AGENT);
  const viewport = trimmedField(source.viewport, MAX_VIEWPORT);
  const appVersion = trimmedField(source.appVersion, MAX_APP_VERSION);
  if (userAgent !== undefined) context.userAgent = userAgent;
  if (viewport !== undefined) context.viewport = viewport;
  if (appVersion !== undefined) context.appVersion = appVersion;
  return Object.keys(context).length > 0 ? context : undefined;
}

export interface BugReportRoutesConfig {
  gate: preHandlerHookHandler;
  bugReportStore: BugReportStore;
  /** The in-memory roster — resolves each submitter's canonical name for the admin queue. */
  cache: ProfileCache;
  audit: AuditLog;
  clock: Clock;
}

/**
 * The bug-report endpoints (D121; API-SPEC §10). **Book is a triage-and-clear
 * surface, not a bug tracker:** any authenticated brother can *file* a report,
 * and an admin can *view*, *copy* (client-side), and *delete* them. Real bug
 * management happens in the team's external tracker; Book exists as a viewer only
 * because it has no email and reading raw Firestore by hand would be cumbersome.
 *
 *  - `POST /api/bug-report` — file a report (**any authenticated user**),
 *    tightly rate-limited (5/min) and size-capped so it cannot be used to flood
 *    the queue. No outbound email (D121). Persists at status `new`.
 *  - `GET /api/admin/bug-reports` — the review queue (**admin only**), newest
 *    first, each report enriched with the submitter's canonical name from the
 *    cache. `no-store` (it names a submitter).
 *  - `POST /api/admin/bug-reports/mark-reviewed` — the one-way `new → reviewed`
 *    unread marker (**admin only**); the SPA fires it after rendering the queue.
 *  - `DELETE /api/admin/bug-reports/:id` — delete a report (**admin only**), the
 *    terminal act; audited (D61).
 */
export function registerBugReportRoutes(app: FastifyInstance, config: BugReportRoutesConfig): void {
  const { gate, bugReportStore, cache, audit, clock } = config;

  app.post(
    "/api/bug-report",
    { preHandler: gate, config: bugReportRateLimit() },
    async (request, reply) => {
      const session = request.session;
      if (!session) {
        return reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
      }

      const body = (request.body ?? {}) as {
        page?: unknown;
        url?: unknown;
        description?: unknown;
        clientContext?: unknown;
      };

      const description = typeof body.description === "string" ? body.description.trim() : "";
      if (description === "") {
        return reply
          .code(422)
          .send({ error: "validation_failed", message: "A bug description is required." });
      }
      if (description.length > MAX_BUG_REPORT_DESCRIPTION) {
        return reply.code(422).send({
          error: "validation_failed",
          message: `The description must be ${MAX_BUG_REPORT_DESCRIPTION} characters or fewer.`,
        });
      }

      const now = clock();
      // Build the record, omitting undefined optional fields (Firestore rejects an
      // explicit `undefined` value).
      const report: Omit<BugReport, "id"> = {
        submittedBy: session.identity.profileId,
        submittedAt: now.toISOString(),
        page: trimmedField(body.page, MAX_PAGE) ?? "",
        description,
        status: "new",
      };
      const url = trimmedField(body.url, MAX_URL);
      if (url !== undefined) {
        report.url = url;
      }
      const clientContext = readClientContext(body.clientContext);
      if (clientContext !== undefined) {
        report.clientContext = clientContext;
      }

      const created = await bugReportStore.create(report);

      // Names-not-values (D61): record only that a report was filed, by whom —
      // never the description text (which is untrusted user input).
      audit.record(
        {
          action: "bug.report",
          actorId: report.submittedBy,
          outcome: "ok",
          scope: "file",
          trace: traceId(request),
        },
        now.toISOString(),
      );

      return reply.code(201).send({ id: created.id, status: created.status });
    },
  );

  app.get(
    "/api/admin/bug-reports",
    { preHandler: gate, config: readRateLimit() },
    async (request, reply) => {
      // Reading the queue names its submitters, so a non-admin (or stepped-down
      // admin) probe is audited as a denial (OFC-190); the successful read is a
      // routine admin view and is not audited (mirrors the banner read).
      const actorId = requireEffectiveAdmin(request, reply, { action: "bug.report", audit, clock });
      if (actorId === null) {
        return reply;
      }

      const reports = await bugReportStore.list();
      const enriched: AdminBugReport[] = reports.map(({ submittedBy, ...rest }) => {
        const profile = cache.getById(submittedBy);
        return {
          ...rest,
          submitterId: submittedBy,
          // The **plain** canonical name (no `(#id)` disambiguator): the queue shows
          // the Constitution id alongside it, so ambiguity is already resolved and a
          // doubled id is avoided. A submitter whose profile is gone shows as a
          // former member (the id still identifies them).
          submitterName: profile ? formatCanonicalName(profile, false) : "(former member)",
        };
      });

      return reply.header("Cache-Control", "no-store").send({ reports: enriched });
    },
  );

  app.post(
    "/api/admin/bug-reports/mark-reviewed",
    { preHandler: gate, config: writeRateLimit() },
    async (request, reply) => {
      const actorId = requireEffectiveAdmin(request, reply, { action: "bug.report", audit, clock });
      if (actorId === null) {
        return reply;
      }

      const body = (request.body ?? {}) as { ids?: unknown };
      if (!Array.isArray(body.ids)) {
        return reply
          .code(422)
          .send({ error: "validation_failed", message: "ids must be an array of report ids." });
      }
      const ids = body.ids
        .filter((id): id is string => typeof id === "string")
        .slice(0, MAX_MARK_IDS);

      // The new→reviewed flip is a benign, automatic unread marker fired on every
      // Admin visit; it is not audited (that would flood the log), though a
      // non-admin probe already left a denial entry above.
      const reviewed = await bugReportStore.markReviewed(ids);
      return reply.header("Cache-Control", "no-store").send({ reviewed });
    },
  );

  app.delete(
    "/api/admin/bug-reports/:id",
    { preHandler: gate, config: writeRateLimit() },
    async (request, reply) => {
      const actorId = requireEffectiveAdmin(request, reply, { action: "bug.report", audit, clock });
      if (actorId === null) {
        return reply;
      }

      const id = (request.params as { id?: string }).id ?? "";
      const now = clock();
      await bugReportStore.delete(id);

      // Deletion is the terminal act on user-submitted data — audit it (D61), a
      // coarse `delete` scope, never the report content.
      audit.record(
        { action: "bug.report", actorId, outcome: "ok", scope: "delete", trace: traceId(request) },
        now.toISOString(),
      );

      return reply.code(204).send();
    },
  );
}
