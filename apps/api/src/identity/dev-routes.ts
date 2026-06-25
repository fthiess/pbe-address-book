import type { Role } from "@pbe/shared";
import type { FastifyInstance } from "fastify";
import type { DevIdentityProvider } from "./dev-provider.js";

const ROLES = new Set<Role>(["brother", "manager", "admin"]);

function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.has(value as Role);
}

/**
 * Mount the dev-only auth routes. Registered ONLY from `index.dev.ts`, never
 * from the production entry — this is part of what keeps the dev provider out
 * of the production bundle (D108 layer 1).
 *
 * `POST /api/dev/session { role }` mints a session for the chosen role, which
 * is what gives local dev and Playwright their role-switchable login.
 */
export function registerDevRoutes(app: FastifyInstance, provider: DevIdentityProvider): void {
  app.post("/api/dev/session", async (request, reply) => {
    const body = (request.body ?? {}) as { role?: unknown };
    if (body.role !== undefined && !isRole(body.role)) {
      return reply.code(400).send({ error: `unknown role: ${String(body.role)}` });
    }
    const session = await provider.createSession({ role: body.role as Role | undefined });
    return { session };
  });
}
