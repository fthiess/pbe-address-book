import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { BackupSource } from "../data/backup.js";
import { buildBackupSnapshot } from "../data/backup.js";
import { readRateLimit } from "../security/rate-limit.js";
import { requireEffectiveAdmin } from "./privileged-support.js";
import type { Clock } from "./profiles.js";
import { traceId } from "./trace.js";

export interface BackupRoutesConfig {
  gate: preHandlerHookHandler;
  backupSource: BackupSource;
  audit: AuditLog;
  clock: Clock;
}

/**
 * `GET /api/admin/backup` — download a complete database backup (D63; API-SPEC §7),
 * **admin only** at the caller's effective role (N31). The JSON of the live
 * Firestore collections, served as a download attachment. The admin is the
 * **custodian** of the downloaded archive (D101; USER-MANUAL). Audited
 * (`backup.download`, D61) — a whole-database action, so no single `targetId`.
 *
 * ENVELOPE VERSION 2 (7b-3). This download emitted envelope **1** (`collections`
 * alone) while the automated job emitted **2** (`collections` + the derived image
 * manifest); D147 parked the divergence for 7b-3, the session that first reads
 * both. It is closed here in the direction of one envelope: the download now shares
 * `buildBackupSnapshot`, so both producers emit the same shape and everything
 * downstream — the restore, and D102's integrity job next — reads one thing. The
 * manifest costs nothing to add, being pure derivation from the profiles already in
 * hand, and it makes the manual archive a *complete* statement of what to restore
 * rather than one that silently omits which image versions belong with it. The
 * restore still reads version 1, so archives downloaded before this change remain
 * restorable — the custodian of an off-platform copy does not have to know a wire
 * version changed. Nothing client-side parses the body (the SPA streams it to
 * disk), so the change is invisible in the UI.
 */
export function registerBackupRoutes(app: FastifyInstance, config: BackupRoutesConfig): void {
  const { gate, backupSource, audit, clock } = config;

  app.get(
    "/api/admin/backup",
    { preHandler: gate, config: readRateLimit() },
    async (request, reply) => {
      // Audit a 403 denial (OFC-190): the backup is every brother's data, so a probe
      // by a non-admin / stepped-down admin belongs in the forensic stream.
      const actorId = requireEffectiveAdmin(request, reply, {
        action: "backup.download",
        audit,
        clock,
      });
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
        .send(buildBackupSnapshot(collections, now));
    },
  );
}
