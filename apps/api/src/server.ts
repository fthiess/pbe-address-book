import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import type { ProfileCache } from "./data/cache.js";
import type { NonceService } from "./identity/nonce-store.js";
import { type SessionCookieConfig, requireSession } from "./identity/session-cookie.js";
import type { SessionService } from "./identity/session-store.js";
import type { IdentityProvider } from "./identity/types.js";
import { type GhostBridgeConfig, registerAuthRoutes } from "./routes/auth.js";
import { registerImageRoutes } from "./routes/images.js";
import { registerProfileRoutes } from "./routes/profiles.js";

export interface BuildServerOptions {
  identityProvider: IdentityProvider;
  /** The hydrated in-memory dataset cache the read path serves from. */
  profileCache: ProfileCache;
  /** Firestore-persisted session store (read-through cache; D125). */
  sessionStore: SessionService;
  /** Firestore-persisted single-use login nonce store (D104/D125). */
  nonceStore: NonceService;
  /** The caller's starred-brother ids — `[]` if they have no `users` doc yet. */
  getStars: (profileId: number) => Promise<number[]>;
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
export function buildServer(options: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cookie);

  app.get("/api/health", async () => ({
    status: "ok",
    provider: options.identityProvider.name,
  }));

  const gate = requireSession(options.sessionStore);

  registerAuthRoutes(app, {
    provider: options.identityProvider,
    sessionStore: options.sessionStore,
    nonceStore: options.nonceStore,
    cache: options.profileCache,
    getStars: options.getStars,
    cookie: options.cookie,
    ghostBridge: options.ghostBridge,
  });
  registerProfileRoutes(app, options.profileCache, gate);
  registerImageRoutes(app, gate);

  return app;
}
