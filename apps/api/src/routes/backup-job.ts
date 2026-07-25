import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuditLog } from "../audit/audit-log.js";
import type { DiagnosticLog } from "../audit/diagnostic-log.js";
import { type BackupStore, backupObjectName } from "../data/backup-store.js";
import { type BackupSource, buildBackupSnapshot } from "../data/backup.js";
import {
  ServiceIdentityUnavailableError,
  type ServiceIdentityVerifier,
} from "../identity/google-oidc.js";
import { readRateLimit } from "../security/rate-limit.js";
import { bearerToken } from "./bearer.js";
import type { Clock } from "./profiles.js";
import { traceId } from "./trace.js";

/**
 * `POST /api/internal/backup` — the **automated** daily backup (D63; API-SPEC §7;
 * 7b-2). Cloud Scheduler calls this once a day; the handler exports the three
 * durable collections, derives the image-version manifest, and writes one
 * timestamped JSON snapshot into the ACL-restricted backup bucket (D101). This job
 * *is* D102's ≈24-hour RPO.
 *
 * WHY AN ENDPOINT AND NOT AN IN-PROCESS CRON. Book runs `max-instances=1` with
 * scale-to-zero (D83), so there is usually no process alive to hold a timer — an
 * in-process schedule would simply never fire. Something external has to wake Book,
 * and Cloud Scheduler over HTTP is that, on the service that already exists.
 *
 * AUTH is deliberately **not** the session cookie: the caller is a service, not a
 * browser. It carries a Google-signed identity token, verified in-code by the
 * shared subject-pinned verifier (`identity/google-oidc.ts`) — `iss` = Google,
 * `aud` = Book, **`sub` = the pinned scheduler service account** — the same D58/D78
 * pattern the Linter roster established. Unconfigured (no verifier, or no bucket)
 * the route fails closed with `503`. A rejected call is **audited**: this endpoint
 * triggers a read of every brother's data, so a probe of it belongs in the forensic
 * stream for the same reason OFC-190 put the admin download's denials there.
 *
 * THE PRE-FLIGHT STALENESS CHECK (Forrest's design, 7b-2) is the first thing the
 * handler does after auth, **before** the export. A post-hoc "backup failed" record
 * only exists if the failure path gets to run, and the modes that matter most — an
 * OOM, a request timeout, the container killed mid-export — write nothing at all,
 * so an after-the-fact detector goes silent exactly when the thing it watches is
 * dying. Checking *first* means the alert survives the run that is about to die,
 * and it stays accurate either way: succeeding now does not undo the days nothing
 * was written. It **never aborts the backup** — a stale history is a reason to take
 * today's snapshot, not to skip it.
 *
 * It cannot see everything, and is not meant to: it only runs if Book runs. A
 * paused or deleted Scheduler job, lapsed billing, or a missing service leaves it
 * unexecuted — that "the schedule quietly stopped" case is D102's R21 failure, and
 * it is caught by the external metric-absence alert policy provisioned alongside
 * this route (`infra/provision-observability.sh`). The two detectors are
 * complementary: this one watches the job, that one watches for the job.
 */

/**
 * How old the newest snapshot may be before the pre-flight check raises the alarm.
 *
 * The schedule runs **twice daily** (D149), so the normal age at check time is
 * ~12h and **20h means one scheduled run was missed**, with 8 hours of slack for
 * clock drift, a shifted schedule, and Scheduler's own retries. Tightening this
 * below ~13h would alert on an ordinary run; loosening it past 24h would need two
 * consecutive misses before saying anything.
 *
 * Deliberately the same 20h the external absence policy uses
 * (`infra/provision-observability.sh`), so the two detectors agree on what
 * "overdue" means — they watch different failures, and it would be confusing for
 * them to disagree about the threshold as well as the mechanism.
 */
export const BACKUP_STALE_AFTER_MS = 20 * 60 * 60 * 1000;

/** The constant `message` of the alertable staleness line (the alert filter keys on it). */
export const BACKUP_STALE_MESSAGE = "backup staleness threshold exceeded";

/** The constant `message` of the first-ever-run line — informational, NOT the alert. */
export const BACKUP_BOOTSTRAP_MESSAGE = "no prior backup snapshot (bootstrap run)";

export interface BackupJobRoutesConfig {
  /**
   * The subject-pinned Google-OIDC verifier for the scheduler identity. Omitted
   * when the automated backup is not configured for this deployment — the route
   * then fails closed with `503`.
   */
  verifier?: ServiceIdentityVerifier;
  /** The snapshot object store; omitted when `BACKUP_BUCKET` is unset (→ `503`). */
  backupStore?: BackupStore;
  /** The same whole-database read seam the D52 download uses. */
  backupSource: BackupSource;
  audit: AuditLog;
  diagnostics: DiagnosticLog;
  clock: Clock;
  /** Overridable for tests; defaults to {@link BACKUP_STALE_AFTER_MS}. */
  staleAfterMs?: number;
}

export function registerBackupJobRoutes(app: FastifyInstance, config: BackupJobRoutesConfig): void {
  const { verifier, backupStore, backupSource, audit, diagnostics, clock } = config;
  const staleAfterMs = config.staleAfterMs ?? BACKUP_STALE_AFTER_MS;

  app.post(
    "/api/internal/backup",
    { config: readRateLimit() },
    async (request: FastifyRequest, reply) => {
      const trace = traceId(request);

      // A refused call is audited before the 401 (see the module note on OFC-190).
      // `reason` is a coarse code, never the offered token — the same shape an
      // `auth.signin` denial uses (P10).
      const denied = (reason: string) => {
        audit.record(
          { action: "backup.auto", outcome: "denied", reason, trace },
          clock().toISOString(),
        );
        return reply.code(401).send({ error: "unauthenticated" });
      };

      // Fail closed when the automated backup is not configured for this
      // deployment (no scheduler identity, or no bucket). Both are required; a
      // verifier without a bucket would authenticate a caller and then have
      // nowhere to write.
      if (!verifier || !backupStore) {
        return reply.code(503).send({ error: "backup_unavailable" });
      }

      const token = bearerToken(request.headers.authorization);
      if (!token) {
        return denied("missing_token");
      }
      try {
        await verifier.verify(token);
      } catch (error) {
        // A transient JWKS/key-resolution failure is an availability problem, not a
        // bad token — a retryable 503 so Scheduler backs off and retries rather than
        // treating a valid credential as permanently rejected (OFC-223). It is NOT
        // audited as a denial: nobody was refused, Google was unreachable.
        if (error instanceof ServiceIdentityUnavailableError) {
          diagnostics.warn("scheduler identity verification unavailable", {
            trace,
            action: "backup.auto",
            detail: error instanceof Error ? error.message : undefined,
          });
          return reply.code(503).send({ error: "verification_unavailable" });
        }
        return denied("invalid_token");
      }

      const now = clock();

      // ---- Pre-flight staleness check (see the module note) ----------------
      // Wrapped so that a failure to READ the bucket can never stop us WRITING to
      // it: the check is a detector, not a precondition.
      try {
        const latest = await backupStore.latest();
        if (latest === null) {
          diagnostics.info(BACKUP_BOOTSTRAP_MESSAGE, { trace, action: "backup.auto" });
        } else {
          const ageMs = now.getTime() - latest.takenAt.getTime();
          if (ageMs > staleAfterMs) {
            // The alertable line. ERROR, not WARNING: the ≈24h RPO D102 promises
            // has already been missed, and it should surface in the default
            // error view rather than only in a metric. `detail` carries whole
            // hours — a duration, not a record value, so it is within the P10
            // boundary (the same way an audit `count` is).
            diagnostics.error(BACKUP_STALE_MESSAGE, {
              trace,
              action: "backup.auto",
              detail: `age=${Math.floor(ageMs / 3_600_000)}h threshold=${Math.floor(
                staleAfterMs / 3_600_000,
              )}h`,
            });
          }
        }
      } catch (error) {
        diagnostics.warn("backup staleness check failed", {
          trace,
          action: "backup.auto",
          detail: error instanceof Error ? error.message : undefined,
        });
      }

      // ---- The backup itself -----------------------------------------------
      const objectName = backupObjectName(now);
      try {
        const collections = await backupSource.export();
        const snapshot = buildBackupSnapshot(collections, now);
        await backupStore.write(objectName, JSON.stringify(snapshot));
        audit.record(
          {
            action: "backup.auto",
            outcome: "ok",
            count: snapshot.collections.profiles.length,
            trace,
          },
          now.toISOString(),
        );
        return reply.send({
          object: objectName,
          generatedAt: snapshot.generatedAt,
          profiles: snapshot.collections.profiles.length,
          images: snapshot.images.length,
        });
      } catch (error) {
        // Audit the failure as well as logging it: "the backup ran and did not
        // produce a snapshot" is a continuity fact, not just a server error, and
        // the audit stream is the one with the 3-month retention (P16).
        audit.record({ action: "backup.auto", outcome: "error", trace }, now.toISOString());
        diagnostics.error("automated backup failed", {
          trace,
          action: "backup.auto",
          detail: error instanceof Error ? error.message : undefined,
          stack: error instanceof Error ? error.stack : undefined,
        });
        // `reply.code(...).send(...)`, not a throw: a thrown 5xx is genericized by
        // the server's error handler, and Scheduler's retry wants a real status.
        return reply.code(500).send({ error: "backup_failed" });
      }
    },
  );
}
