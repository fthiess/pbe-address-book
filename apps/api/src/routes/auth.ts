import type { FastifyInstance } from "fastify";
import type { ProfileCache } from "../data/cache.js";
import type { NonceService } from "../identity/nonce-store.js";
import {
  type SessionCookieConfig,
  clearSessionCookie,
  readSessionId,
  requireSession,
  setSessionCookie,
} from "../identity/session-cookie.js";
import type { SessionService } from "../identity/session-store.js";
import { AuthError, type IdentityProvider } from "../identity/types.js";
import { projectSelf } from "../projection/projection.js";

/**
 * Where to send a user to start the Ghost handshake. The relay lives on the live
 * Ghost site and routes back to a **hardcoded allowlist** of callbacks keyed by
 * `target` (D104 — never a caller-parameterizable redirect), which is how the one
 * live relay serves both staging and production.
 */
export interface GhostBridgeConfig {
  /** The relay page URL, e.g. `https://pbe400.org/book`. */
  url: string;
  /** The allowlist key the relay uses to pick this environment's callback. */
  target: string;
}

export interface AuthRoutesConfig {
  provider: IdentityProvider;
  sessionStore: SessionService;
  nonceStore: NonceService;
  cache: ProfileCache;
  /** The caller's starred-brother ids (empty if they have no `users` doc yet). */
  getStars: (profileId: number) => Promise<number[]>;
  cookie: SessionCookieConfig;
  /** Undefined locally (the SPA uses the dev role switcher, not the Ghost bridge). */
  ghostBridge?: GhostBridgeConfig;
}

/**
 * The authentication & session endpoints (API-SPEC §2). These are registered in
 * every environment; the *provider* behind `POST /api/auth/session` differs
 * (Ghost in production, never reached locally where `/api/dev/session` is used).
 */
export function registerAuthRoutes(app: FastifyInstance, config: AuthRoutesConfig): void {
  const gate = requireSession(config.sessionStore);

  /**
   * Flow initiation: mint the single-use `state` nonce and hand back the relay
   * URL the SPA redirects to. The nonce ties the eventual callback to this
   * Book-initiated flow (D104).
   */
  app.post("/api/auth/start", async (_request, reply) => {
    if (!config.ghostBridge) {
      return reply.code(404).send({ error: "ghost_bridge_unconfigured" });
    }
    const state = await config.nonceStore.issue();
    const url = new URL(config.ghostBridge.url);
    url.searchParams.set("state", state);
    url.searchParams.set("target", config.ghostBridge.target);
    return { state, signInUrl: url.toString() };
  });

  /**
   * Completes the bridge: the `/auth/callback` SPA page POSTs the fragment-carried
   * Ghost JWT and the `state` nonce here. On success a Book session is persisted
   * and its opaque id set as the session cookie.
   */
  app.post("/api/auth/session", async (request, reply) => {
    const body = (request.body ?? {}) as { token?: unknown; state?: unknown };
    const token = typeof body.token === "string" ? body.token : undefined;
    const state = typeof body.state === "string" ? body.state : undefined;
    try {
      const session = await config.provider.createSession({ token, state });
      const id = await config.sessionStore.create(session);
      setSessionCookie(reply, id, config.cookie);
      const stars = await config.getStars(session.identity.profileId);
      return { profileId: session.identity.profileId, role: session.identity.role, stars };
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.status).send({ error: error.code });
      }
      throw error;
    }
  });

  /**
   * The caller's own private state and own full profile (API-SPEC §2 `/api/me`);
   * the SPA overlays this onto its own directory row (the split read, D82).
   * Served `no-store`: it carries the caller's own contact values (D95).
   *
   * The record is run through {@link projectSelf} even for its owner: the owner
   * sees their entire record **except** `adminNote` (staff-internal — the note
   * exists because the brother does not see it, §9) and `ghostMemberId` (never
   * sent to any client). `profile` is `null` if the session id has no loaded
   * record (e.g. a not-yet-hydrated new initiate).
   */
  app.get("/api/me", { preHandler: gate }, async (request, reply) => {
    const session = request.session;
    if (!session) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    const { profileId, role } = session.identity;
    const own = config.cache.getById(profileId);
    const profile = own ? projectSelf(own) : null;
    const stars = await config.getStars(profileId);
    reply.header("Cache-Control", "no-store");
    return { profileId, role, stars, profile };
  });

  /** Clears the Book session and the cookie (API-SPEC §2 `/api/auth/signout`). */
  app.post("/api/auth/signout", { preHandler: gate }, async (request, reply) => {
    const id = readSessionId(request);
    if (id) {
      await config.sessionStore.destroy(id);
    }
    clearSessionCookie(reply, config.cookie);
    return reply.code(204).send();
  });
}
