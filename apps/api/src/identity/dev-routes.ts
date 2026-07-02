import type { Role } from "@pbe/shared";
import type { FastifyInstance } from "fastify";
import type { DevIdentityProvider } from "./dev-provider.js";
import { type SessionCookieConfig, setSessionCookie } from "./session-cookie.js";
import type { SessionService } from "./session-store.js";

const ROLES = new Set<Role>(["brother", "manager", "admin"]);

function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.has(value as Role);
}

export interface DevRoutesConfig {
  sessionStore: SessionService;
  cookie: SessionCookieConfig;
  /**
   * The caller's starred-brother ids (empty if they have no `users` doc yet) —
   * mirrors `AuthRoutesConfig.getStars` so the dev session route returns real
   * star state instead of a hardcoded `[]` (OFC-78), making the starred-profiles
   * feature testable through the dev-login path.
   */
  getStars: (profileId: number) => Promise<number[]>;
}

/**
 * Mount the dev-only auth routes. Registered ONLY from `index.dev.ts`, never
 * from the production entry — this is part of what keeps the dev provider out
 * of the production bundle (D108 layer 1).
 *
 * `POST /api/dev/session { role }` mints a session for the chosen role, persists
 * it through the same session store as production, and sets the same session
 * cookie — so the Phase 1b gate, `/api/me`, and sign-out all work identically
 * under the dev provider. This is what gives local dev and Playwright their
 * role-switchable login without Ghost.
 */
export function registerDevRoutes(
  app: FastifyInstance,
  provider: DevIdentityProvider,
  config: DevRoutesConfig,
): void {
  app.post("/api/dev/session", async (request, reply) => {
    const body = (request.body ?? {}) as { role?: unknown };
    if (body.role !== undefined && !isRole(body.role)) {
      return reply.code(400).send({ error: `unknown role: ${String(body.role)}` });
    }
    const session = await provider.createSession({ role: body.role as Role | undefined });
    const id = await config.sessionStore.create(session);
    setSessionCookie(reply, id, config.cookie);
    const stars = await config.getStars(session.identity.profileId);
    return { profileId: session.identity.profileId, role: session.identity.role, stars };
  });
}
