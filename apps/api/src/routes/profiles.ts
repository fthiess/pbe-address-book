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
 * PHASE 1b: the read is now **session-gated** (the `gate` preHandler), closing
 * the 1a interim un-gated path. The role-from-session selection of the
 * manager/admin projections is still pending — all authenticated roles receive
 * the (most-restrictive) brother projection until the full per-role projection
 * lands in Phase 2; the caller's own full record arrives via `/api/me` (D82).
 */
export function registerProfileRoutes(
  app: FastifyInstance,
  cache: ProfileCache,
  gate: preHandlerHookHandler,
): void {
  app.get("/api/profiles", { preHandler: gate }, async (request, reply) => {
    const payload = cache.brotherPayload();
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
