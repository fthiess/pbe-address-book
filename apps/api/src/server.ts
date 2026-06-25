import Fastify, { type FastifyInstance } from "fastify";
import type { IdentityProvider } from "./identity/types.js";

export interface BuildServerOptions {
  identityProvider: IdentityProvider;
}

/**
 * Build the Book API as a Fastify instance. Provider-agnostic by design: the
 * active `IdentityProvider` is injected, so the same server runs under the real
 * Ghost provider in production and the `DevIdentityProvider` locally. This file
 * must never import a concrete provider (keeping the dev provider out of the
 * production bundle — D108).
 *
 * Phase 0 exposes only `/api/health`. The read path, auth wiring, and the
 * privacy projection arrive in Phases 1–2.
 */
export function buildServer(options: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/api/health", async () => ({
    status: "ok",
    provider: options.identityProvider.name,
  }));

  return app;
}
