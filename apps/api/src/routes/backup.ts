import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { BackupSource } from "../data/backup.js";
import { readRateLimit } from "../security/rate-limit.js";
import { requireEffectiveAdmin } from "./privileged-support.js";
import type { Clock } from "./profiles.js";
import { traceId } from "./trace.js";

/** The backup envelope wire version — bumped if the archive shape ever changes. */
const BACKUP_VERSION = 1;

export interface BackupRoutesConfig {
  gate: preHandlerHookHandler;
  backupSource: BackupSource;
  audit: AuditLog;
  clock: Clock;
}

/**
 * `GET /api/admin/backup` — download a complete database backup (D63; API-SPEC §7),
 * **admin only** at the caller's effective role (N31). The MVP export (Phase 5a-1)
 * is the JSON of the live Firestore collections, served as a download attachment;
 * the image-object bundle and the nightly automated job are Phase 7. The admin is
 * the **custodian** of the downloaded archive (D101; USER-MANUAL). Audited
 * (`backup.download`, D61) — a whole-database action, so no single `targetId`.
 */
export function registerBackupRoutes(app: FastifyInstance, config: BackupRoutesConfig): void {
  const { gate, backupSource, audit, clock } = config;

  app.get(
    "/api/admin/backup",
    { preHandler: gate, config: readRateLimit() },
    async (request, reply) => {
      const actorId = requireEffectiveAdmin(request, reply);
      if (actorId === null) {
        return reply;
      }
      const now = clock();
      const collections = await backupSource.export();
      audit.record(
        { action: "backup.download", actorId, outcome: "ok", trace: traceId(request) },
        now.toISOString(),
      );
      const filename = `book-backup-${now.toISOString().slice(0, 10)}.json`;
      return reply
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Cache-Control", "no-store")
        .send({ version: BACKUP_VERSION, generatedAt: now.toISOString(), collections });
    },
  );
}
