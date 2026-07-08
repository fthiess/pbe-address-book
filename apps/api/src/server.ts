import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { AuditLog } from "./audit/audit-log.js";
import type { BackupSource } from "./data/backup.js";
import type { BannerStore } from "./data/banner.js";
import type { BugReportStore } from "./data/bug-reports.js";
import type { ProfileCache } from "./data/cache.js";
import { GcsImageStore, type ImageStore } from "./data/images.js";
import type { ProfileStore } from "./data/profiles.js";
import type { AdminUserStore } from "./data/users.js";
import { type GhostLifecycle, StubGhostLifecycle } from "./identity/ghost-lifecycle.js";
import type { RosterVerifier } from "./identity/google-oidc.js";
import type { NonceService } from "./identity/nonce-store.js";
import { type SessionCookieConfig, requireSession } from "./identity/session-cookie.js";
import type { SessionService } from "./identity/session-store.js";
import type { IdentityProvider } from "./identity/types.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { type GhostBridgeConfig, registerAuthRoutes } from "./routes/auth.js";
import { registerBackupRoutes } from "./routes/backup.js";
import { registerBannerRoutes } from "./routes/banner.js";
import { registerBugReportRoutes } from "./routes/bug-reports.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerHeadshotRoutes } from "./routes/headshot.js";
import { registerImageRoutes } from "./routes/images.js";
import { type Clock, registerProfileRoutes } from "./routes/profiles.js";
import { RecordLock } from "./routes/record-lock.js";
import { registerRosterRoutes } from "./routes/roster.js";
import { registerStarsRoutes } from "./routes/stars.js";
import { registerStatusRoutes } from "./routes/status.js";
import { traceId } from "./routes/trace.js";
import { registerRateLimit } from "./security/rate-limit.js";

export interface BuildServerOptions {
  identityProvider: IdentityProvider;
  /** The hydrated in-memory dataset cache the read path serves from. */
  profileCache: ProfileCache;
  /** The conditional Firestore write path for profile edits (D25). */
  profileStore: ProfileStore;
  /**
   * The private-bucket image store (D126) the `/img/*` read and the headshot
   * pipeline go through. Defaults to a {@link GcsImageStore} over `IMAGE_BUCKET`;
   * tests inject an in-memory double.
   */
  imageStore?: ImageStore;
  /**
   * Mints the opaque `headshotVersion` token (N42/R16). Defaults to
   * `crypto.randomUUID`; tests inject a deterministic generator.
   */
  mintVersion?: () => string;
  /** The admin `users` operations (Change-role invariant + delete reference scrubs). */
  adminUsers: AdminUserStore;
  /** The system-banner singleton store (D117) behind `GET /api/banner` + the admin set/clear. */
  bannerStore: BannerStore;
  /** The whole-database backup read seam (D63) behind `GET /api/admin/backup`. */
  backupSource: BackupSource;
  /** The bug-report store (D121) behind the file POST and the admin review queue. */
  bugReportStore: BugReportStore;
  /** The API build id (commit SHA) stamped onto filed bug reports; defaults to "dev". */
  apiVersion?: string;
  /**
   * The Ghost member-lifecycle seam behind Delete and De-brother (N41). Defaults
   * to {@link StubGhostLifecycle} (succeed-and-log) — the intended behavior until
   * the Phase-5 Ghost write path swaps in the real client; tests inject a failing
   * fake to prove the abort-clean contract.
   */
  ghostLifecycle?: GhostLifecycle;
  /** The audit stream sink (D61); defaults to structured JSON on stdout. */
  auditLog?: AuditLog;
  /** "Now" for write timestamps and audit entries; defaults to the wall clock. */
  clock?: Clock;
  /** Firestore-persisted session store (read-through cache; D125). */
  sessionStore: SessionService;
  /** Firestore-persisted single-use login nonce store (D104/D125). */
  nonceStore: NonceService;
  /** The caller's starred-brother ids — `[]` if they have no `users` doc yet. */
  getStars: (profileId: number) => Promise<number[]>;
  /** Add a brother to the caller's stars (arrayUnion); returns the new list (R17). */
  addStar: (profileId: number, starId: number) => Promise<number[]>;
  /** Remove a brother from the caller's stars (arrayRemove); returns the new list (R17). */
  removeStar: (profileId: number, starId: number) => Promise<number[]>;
  /** Session-cookie attributes (notably `Secure`, off only for local http dev). */
  cookie: SessionCookieConfig;
  /** The Ghost relay redirect target; omitted locally (dev uses the role switcher). */
  ghostBridge?: GhostBridgeConfig;
  /**
   * The subject-pinned Google-OIDC verifier behind `GET /api/roster` (D58/D78).
   * Omitted when the Linter integration is not configured — the route then fails
   * closed with `503`.
   */
  rosterVerifier?: RosterVerifier;
}

/**
 * Build the Book API as a Fastify instance. Provider-agnostic by design: the
 * active `IdentityProvider`, the session/nonce stores, and the `ProfileCache`
 * are injected, so the same server runs under the real Ghost provider in
 * production and the `DevIdentityProvider` locally. This file must never import a
 * concrete provider (keeping the dev provider out of the production bundle —
 * D108).
 *
 * Phase 1b wires the auth & session layer: the session cookie plugin, the
 * `/api/auth/*` and `/api/me` endpoints, and the session `gate` that protects
 * the bulk read and image reads — closing the 1a interim un-gated path.
 */
export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  // `trustProxy`: Book runs behind Firebase Hosting → Cloud Run (D126), so the
  // real client IP is in `X-Forwarded-For`, not the socket. The rate limiter's
  // IP keying (security/rate-limit.ts) depends on `request.ip` being the client,
  // not the shared proxy; nothing else in the server reads `request.ip`.
  const app = Fastify({ logger: false, trustProxy: true });
  app.register(cookie);

  // Error handler (OFC-149): the Fastify default echoes the thrown error's raw
  // `message` into the 500 body, which for a Firestore/GCS/`firebase-admin`
  // failure can leak project ids, database paths, and internal state to the
  // client. This replaces that for **server** errors only: the real error is
  // logged server-side (to stderr, per the project convention, carrying the trace
  // id so it ties to the request's audit lines) and the client gets a generic
  // body. Client errors (4xx — schema validation, an unsupported upload type, a
  // rate-limit trip) keep their standard Fastify shape and message, which are
  // caller-controlled inputs and safe to return.
  // NOTE: any *intentional* 5xx that must carry a body or header (e.g. a future
  // D118 maintenance `503` with `Retry-After`) must be sent via
  // `reply.code(...).send(...)`, NOT thrown — a thrown 5xx is genericized below
  // (that is the point: it masks unexpected exceptions). The existing `/img` 503
  // already uses `reply.code`, so it is unaffected.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      const trace = traceId(request);
      process.stderr.write(
        `${JSON.stringify({
          logType: "error",
          severity: "ERROR",
          message: error.message,
          stack: error.stack,
          ...(trace !== undefined ? { trace } : {}),
        })}\n`,
      );
      return reply.code(500).send({ error: "internal", message: "Something went wrong." });
    }
    // Preserve the standard 4xx representation (statusCode / error / message).
    return reply.code(statusCode).send({
      statusCode,
      error: STATUS_CODES[statusCode] ?? "Error",
      message: error.message,
    });
  });

  // Security headers on every API + `/img` response (OFC-148, D107).
  //
  // NOTE (corrected against the live staging deploy — OFC-146 follow-up): Firebase
  // Hosting DOES apply its `**` header rules (firebase.json) to the `/api/**` and
  // `/img/**` rewrite responses, and those TAKE PRECEDENCE over what Cloud Run
  // sets — so in production the API/img responses actually carry the SPA's CSP and
  // Hosting's own HSTS, not the values below. This hook is therefore **defense in
  // depth**: it guarantees the headers on any path that reaches Cloud Run WITHOUT
  // going through Hosting (a direct run.app URL), and is harmlessly overridden on
  // the Hosting-fronted path. A CSP on a JSON/image response is inert regardless
  // (it governs document contexts, not the response's own bytes), so the floor
  // `default-src 'none'` here is a safe default for the direct-access case.
  //
  // The four non-CSP values mirror the SPA copies in `firebase.json`; keep them in
  // sync (no shared source is practical across JSON config and TS).
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    return payload;
  });
  // Awaited before the routes register so the plugin's onRoute hook is in place to
  // see each route's `config.rateLimit`; `global: false`, so only routes that opt
  // in are limited. (A non-awaited register loads too late — the limits silently
  // would not apply; see registerRateLimit's note.)
  await registerRateLimit(app);

  app.get("/api/health", async () => ({
    status: "ok",
    provider: options.identityProvider.name,
  }));

  const gate = requireSession(options.sessionStore, options.profileCache);
  // One audit stream and one clock shared by every mutating route, so their
  // entries interleave on one timeline and stay deterministic under test.
  const audit = options.auditLog ?? new AuditLog();
  const clock = options.clock ?? (() => new Date());
  // One image store shared by the `/img/*` read and the headshot write path; the
  // version minter defaults to a UUID (opaque, non-enumerable — R16/N42).
  const imageStore = options.imageStore ?? new GcsImageStore(process.env.IMAGE_BUCKET);
  const mintVersion = options.mintVersion ?? (() => randomUUID());
  // The Ghost lifecycle is the real Admin-API client when an Admin key is
  // configured (wired in index.ts), else a succeed-and-log stub (N41/N65).
  const ghostLifecycle = options.ghostLifecycle ?? new StubGhostLifecycle();
  // One per-record write serializer shared by every pushed-field write path (N65),
  // so PATCH, deceased, and de-brother on the same record serialize with each other.
  const recordLock = new RecordLock();

  registerAuthRoutes(app, {
    provider: options.identityProvider,
    sessionStore: options.sessionStore,
    nonceStore: options.nonceStore,
    cache: options.profileCache,
    getStars: options.getStars,
    cookie: options.cookie,
    ghostBridge: options.ghostBridge,
    audit,
    clock,
  });
  registerProfileRoutes(app, {
    cache: options.profileCache,
    gate,
    store: options.profileStore,
    audit,
    clock,
    ghostLifecycle,
    recordLock,
  });
  registerHeadshotRoutes(app, {
    cache: options.profileCache,
    gate,
    store: options.profileStore,
    imageStore,
    audit,
    clock,
    mintVersion,
  });
  registerStatusRoutes(app, {
    cache: options.profileCache,
    gate,
    store: options.profileStore,
    sessionStore: options.sessionStore,
    audit,
    clock,
    ghostLifecycle,
    recordLock,
  });
  registerAdminRoutes(app, {
    cache: options.profileCache,
    gate,
    store: options.profileStore,
    sessionStore: options.sessionStore,
    imageStore,
    adminUsers: options.adminUsers,
    ghostLifecycle,
    audit,
    clock,
  });
  registerStarsRoutes(app, {
    gate,
    addStar: options.addStar,
    removeStar: options.removeStar,
  });
  registerExportRoutes(app, { gate, audit, clock, cache: options.profileCache });
  registerRosterRoutes(app, { verifier: options.rosterVerifier });
  registerImageRoutes(app, { cache: options.profileCache, gate, imageStore });
  registerBannerRoutes(app, { gate, bannerStore: options.bannerStore, audit, clock });
  registerBackupRoutes(app, { gate, backupSource: options.backupSource, audit, clock });
  registerBugReportRoutes(app, {
    gate,
    bugReportStore: options.bugReportStore,
    apiVersion: options.apiVersion ?? "dev",
    audit,
    clock,
  });

  return app;
}
