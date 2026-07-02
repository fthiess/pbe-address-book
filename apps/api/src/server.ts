import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { AuditLog } from "./audit/audit-log.js";
import type { ProfileCache } from "./data/cache.js";
import type { ProfileStore } from "./data/profiles.js";
import type { NonceService } from "./identity/nonce-store.js";
import { type SessionCookieConfig, requireSession } from "./identity/session-cookie.js";
import type { SessionService } from "./identity/session-store.js";
import type { IdentityProvider } from "./identity/types.js";
import { type GhostBridgeConfig, registerAuthRoutes } from "./routes/auth.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerImageRoutes } from "./routes/images.js";
import { type Clock, registerProfileRoutes } from "./routes/profiles.js";
import { registerStarsRoutes } from "./routes/stars.js";
import { registerRateLimit } from "./security/rate-limit.js";

export interface BuildServerOptions {
  identityProvider: IdentityProvider;
  /** The hydrated in-memory dataset cache the read path serves from. */
  profileCache: ProfileCache;
  /** The conditional Firestore write path for profile edits (D25). */
  profileStore: ProfileStore;
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
  // Awaited before the routes register so the plugin's onRoute hook is in place to
  // see each route's `config.rateLimit`; `global: false`, so only routes that opt
  // in are limited. (A non-awaited register loads too late — the limits silently
  // would not apply; see registerRateLimit's note.)
  await registerRateLimit(app);

  app.get("/api/health", async () => ({
    status: "ok",
    provider: options.identityProvider.name,
  }));

  const gate = requireSession(options.sessionStore);
  // One audit stream and one clock shared by every mutating route, so their
  // entries interleave on one timeline and stay deterministic under test.
  const audit = options.auditLog ?? new AuditLog();
  const clock = options.clock ?? (() => new Date());

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
  });
  registerStarsRoutes(app, {
    gate,
    addStar: options.addStar,
    removeStar: options.removeStar,
  });
  registerExportRoutes(app, { gate, audit, clock });
  registerImageRoutes(app, gate);

  return app;
}
