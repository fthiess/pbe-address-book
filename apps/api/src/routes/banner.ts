import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { BannerStore, StoredBanner } from "../data/banner.js";
import { readRateLimit, writeRateLimit } from "../security/rate-limit.js";
import { requireEffectiveAdmin } from "./privileged-support.js";
import type { Clock } from "./profiles.js";
import { traceId } from "./trace.js";

/** A generous cap on the banner message (DATABASE-SCHEMA §6.3 "generous length cap"). */
const MAX_BANNER_MESSAGE = 500;
const SEVERITIES: ReadonlySet<string> = new Set<StoredBanner["severity"]>(["info", "warning"]);

export interface BannerRoutesConfig {
  gate: preHandlerHookHandler;
  bannerStore: BannerStore;
  audit: AuditLog;
  clock: Clock;
}

/**
 * The system-message banner endpoints (D117; API-SPEC §10):
 *
 *  - `GET /api/banner` — the current banner, read by **any authenticated user**
 *    (the SPA fetches it on load and renders it site-wide). Returns `{ active:
 *    false }` when none is set, so no message ever leaks a value to a client the
 *    banner is not active for.
 *  - `PUT /api/admin/banner` — set or clear the banner, **admin only** at the
 *    caller's effective role (N31). Persists to the `config/systemBanner`
 *    singleton, stamps `updatedBy`/`updatedAt`, and writes one `banner.set` audit
 *    entry (D61 — a coarse `set`/`clear` scope, never the message text).
 */
export function registerBannerRoutes(app: FastifyInstance, config: BannerRoutesConfig): void {
  const { gate, bannerStore, audit, clock } = config;

  app.get("/api/banner", { preHandler: gate, config: readRateLimit() }, async (_request, reply) => {
    const stored = await bannerStore.get();
    // Short-lived/revalidated (API-SPEC §10): the banner is global and carries no
    // PII, but must reflect an admin's set/clear promptly, so revalidate each load.
    reply.header("Cache-Control", "no-cache");
    if (!stored || !stored.active) {
      return { active: false };
    }
    return { active: true, message: stored.message, severity: stored.severity };
  });

  app.put(
    "/api/admin/banner",
    { preHandler: gate, config: writeRateLimit() },
    async (request, reply) => {
      const actorId = requireEffectiveAdmin(request, reply);
      if (actorId === null) {
        return reply;
      }
      const body = (request.body ?? {}) as {
        active?: unknown;
        message?: unknown;
        severity?: unknown;
      };
      if (typeof body.active !== "boolean") {
        return reply
          .code(422)
          .send({ error: "validation_failed", message: "active must be true or false." });
      }

      const now = clock();
      let banner: StoredBanner;
      if (body.active) {
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (message === "") {
          return reply
            .code(422)
            .send({ error: "validation_failed", message: "A banner message is required." });
        }
        if (message.length > MAX_BANNER_MESSAGE) {
          return reply.code(422).send({
            error: "validation_failed",
            message: `The message must be ${MAX_BANNER_MESSAGE} characters or fewer.`,
          });
        }
        // Severity defaults to 'info' when omitted (DATABASE-SCHEMA §6.3); a present
        // value must be one of the two allowed severities.
        const severity = body.severity === undefined ? "info" : body.severity;
        if (typeof severity !== "string" || !SEVERITIES.has(severity)) {
          return reply
            .code(422)
            .send({ error: "validation_failed", message: "severity must be info or warning." });
        }
        banner = {
          active: true,
          message,
          severity: severity as StoredBanner["severity"],
          updatedBy: actorId,
          updatedAt: now.toISOString(),
        };
      } else {
        // A clear: overwrite the prior message so nothing lingers under active:false.
        banner = {
          active: false,
          message: "",
          severity: "info",
          updatedBy: actorId,
          updatedAt: now.toISOString(),
        };
      }

      await bannerStore.set(banner);
      // Names-not-values (D61): record that the banner was set or cleared — a coarse,
      // non-PII scope label — never the message text.
      audit.record(
        {
          action: "banner.set",
          actorId,
          outcome: "ok",
          scope: body.active ? "set" : "clear",
          trace: traceId(request),
        },
        now.toISOString(),
      );
      return reply.header("Cache-Control", "no-store").send(banner);
    },
  );
}
