import type { FastifyInstance } from "fastify";
import type { RosterVerifier } from "../identity/google-oidc.js";
import { readRateLimit } from "../security/rate-limit.js";

/**
 * `GET /api/roster` — the PBE News Linter's read-only roster feed (ENGINEERING-
 * DESIGN §5.2; D58/D78/D112).
 *
 * Phase 5b-1 ships the **stub**: the endpoint, its subject-pinned Google service-
 * account auth, and the contract-version envelope are real; the roster payload is
 * an empty array (the name/year projection lands with the Linter's own build). The
 * contract is stable from here — `contractVersion` (a field *and* the
 * `X-Contract-Version` header) is bumped only on a breaking shape change, letting
 * the independently-deployed, cross-language Linter pin a version (D112).
 *
 * Auth is deliberately **not** the session cookie: the Linter is a service, not a
 * browser, so the route verifies a Google-signed identity token in-code, requiring
 * `iss` = Google, `aud` = Book, **and `sub` = the pinned Linter service account**.
 * Unconfigured (no {@link RosterVerifier} wired) the route fails closed with `503`.
 */
export const ROSTER_CONTRACT_VERSION = 1;

export interface RosterRouteDeps {
  /** The Google-OIDC verifier; omitted when the Linter integration is not configured. */
  verifier?: RosterVerifier;
}

export function registerRosterRoutes(app: FastifyInstance, deps: RosterRouteDeps): void {
  app.get("/api/roster", { config: readRateLimit() }, async (request, reply) => {
    if (!deps.verifier) {
      // No Linter identity configured for this deployment — fail closed.
      return reply.code(503).send({ error: "roster_unavailable" });
    }

    const token = bearerToken(request.headers.authorization);
    if (!token) {
      return reply
        .code(401)
        .send({ error: "unauthenticated", message: "A Google identity token is required." });
    }
    try {
      await deps.verifier.verify(token);
    } catch {
      return reply.code(401).send({ error: "unauthenticated", message: "Invalid identity token." });
    }

    return reply
      .header("Cache-Control", "no-store")
      .header("X-Contract-Version", String(ROSTER_CONTRACT_VERSION))
      .header("Content-Type", "application/json; charset=utf-8")
      .send({ contractVersion: ROSTER_CONTRACT_VERSION, roster: [] });
  });
}

/** Extract the bearer token from an `Authorization: Bearer <token>` header. */
function bearerToken(header: string | undefined): string | null {
  if (typeof header !== "string") {
    return null;
  }
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match?.[1] ? match[1].trim() : null;
}
