import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";

/**
 * The caller's private star list (API-SPEC §4). A star is per-user state living
 * in the caller's own `users` document (DATABASE-SCHEMA §6.1, D12); both writes
 * act **only** on the caller's own list — there is no path to star on another
 * user's behalf — and are **scoped to the `stars` field exclusively**, so a
 * `role` (or any other) field can never ride in on the shared `users` doc (D106).
 *
 * The mutations are injected (not a direct Firestore dependency) so the route is
 * unit-testable with a fake; the real `arrayUnion`/`arrayRemove` implementation
 * (finding R17) and its create-if-absent fallback live in `data/users.ts` and are
 * proven against the emulator.
 */
export interface StarsRoutesConfig {
  gate: preHandlerHookHandler;
  /** Add a brother to the caller's stars; returns the resulting list. */
  addStar: (profileId: number, starId: number) => Promise<number[]>;
  /** Remove a brother from the caller's stars; returns the resulting list. */
  removeStar: (profileId: number, starId: number) => Promise<number[]>;
}

export function registerStarsRoutes(app: FastifyInstance, config: StarsRoutesConfig): void {
  /** `PUT /api/me/stars/{id}` — add brother `{id}` to the caller's list (idempotent). */
  app.put("/api/me/stars/:id", { preHandler: config.gate }, async (request, reply) => {
    const profileId = request.session?.identity.profileId;
    if (profileId === undefined) {
      return reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
    }
    const id = parseStarId(request);
    if (id === null) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid brother id." });
    }
    const stars = await config.addStar(profileId, id);
    reply.header("Cache-Control", "no-store");
    return { stars };
  });

  /** `DELETE /api/me/stars/{id}` — remove brother `{id}` from the caller's list (idempotent). */
  app.delete("/api/me/stars/:id", { preHandler: config.gate }, async (request, reply) => {
    const profileId = request.session?.identity.profileId;
    if (profileId === undefined) {
      return reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
    }
    const id = parseStarId(request);
    if (id === null) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid brother id." });
    }
    const stars = await config.removeStar(profileId, id);
    reply.header("Cache-Control", "no-store");
    return { stars };
  });
}

/** Parse the `:id` route param as a positive Constitution ID, else null. */
function parseStarId(request: FastifyRequest): number | null {
  const id = Number((request.params as { id?: string }).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}
