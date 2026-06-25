import Fastify, { type FastifyInstance } from "fastify";
import type { ProfileCache } from "./data/cache.js";
import type { IdentityProvider } from "./identity/types.js";
import { registerProfileRoutes } from "./routes/profiles.js";

export interface BuildServerOptions {
  identityProvider: IdentityProvider;
  /** The hydrated in-memory dataset cache the read path serves from. */
  profileCache: ProfileCache;
}

/**
 * Build the Book API as a Fastify instance. Provider-agnostic by design: the
 * active `IdentityProvider` and the `ProfileCache` are injected, so the same
 * server runs under the real Ghost provider in production and the
 * `DevIdentityProvider` locally. This file must never import a concrete provider
 * (keeping the dev provider out of the production bundle — D108).
 *
 * Phase 1a adds the bulk read path (`GET /api/profiles`). The auth wiring and
 * the full privacy projection arrive in Phases 1b–2.
 */
export function buildServer(options: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/api/health", async () => ({
    status: "ok",
    provider: options.identityProvider.name,
  }));

  registerProfileRoutes(app, options.profileCache);

  return app;
}
