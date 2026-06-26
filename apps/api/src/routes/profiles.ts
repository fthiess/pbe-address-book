import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { ProfileCache } from "../data/cache.js";
import { negotiateEncoding } from "./encoding.js";

/**
 * `GET /api/profiles` — the bulk read, the cornerstone of the app (API-SPEC §3).
 *
 * Serves the precomputed brother-role projection straight from the in-memory
 * cache (D7/D83), content-encoding-negotiated (brotli/gzip/identity) and
 * `no-store`: the payload is real PII that must never persist to a shared
 * machine's disk, so it lives only in memory while the tab is open and is
 * re-fetched on the next fresh load (D95). The bytes are precompressed off the
 * request path (D84) — the handler does no compression and no Firestore read.
 *
 * PHASE 2b: the read is session-gated (the `gate` preHandler) **and per-role**.
 * The caller's role (from the session the gate attached) selects the projection
 * — the precomputed brother buffer for brothers, a freshly-computed manager or
 * admin projection otherwise (D82). The bulk payload is uniform per role and
 * caller-independent; the caller's own off-toggle/restricted values arrive
 * separately via `/api/me`, so no caller can receive another's owner-level view.
 */
export function registerProfileRoutes(
  app: FastifyInstance,
  cache: ProfileCache,
  gate: preHandlerHookHandler,
): void {
  app.get("/api/profiles", { preHandler: gate }, async (request, reply) => {
    // The gate guarantees a session on a 200 path; default to the most-restrictive
    // brother projection if it is somehow absent rather than over-disclosing.
    const role = request.session?.identity.role ?? "brother";
    const payload = await cache.payloadForRole(role);
    const encoding = negotiateEncoding(request.headers["accept-encoding"]);

    reply
      .header("Cache-Control", "no-store")
      .header("Vary", "Accept-Encoding")
      .header("Content-Type", "application/json; charset=utf-8");

    if (encoding === "br") {
      return reply.header("Content-Encoding", "br").send(payload.br);
    }
    if (encoding === "gzip") {
      return reply.header("Content-Encoding", "gzip").send(payload.gzip);
    }
    return reply.send(payload.json);
  });
}
