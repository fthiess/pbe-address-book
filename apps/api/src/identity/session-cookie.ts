import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { SessionService } from "./session-store.js";
import type { Session } from "./types.js";

/**
 * Book's session cookie and the route gate that consumes it (API-SPEC §1.2;
 * ENGINEERING-DESIGN §2.3/§2.7).
 *
 * The cookie carries only the opaque session id; the session record itself lives
 * server-side (Firestore-persisted — D125). The cookie is `HttpOnly`, `Secure`,
 * `SameSite=Strict`, and **host-only** (no `Domain` attribute, so no sibling
 * `pbe400.org` subdomain — Ghost included — can read it; D107). It is a *session*
 * cookie (no `Max-Age`/`Expires`, so it clears on browser close); the 4-hour
 * absolute cap is enforced by the server-side record's `expiresAt`, not by the
 * cookie. The one cookie authenticates both `/api/*` and the same-origin `/img/*`
 * reads (D126).
 *
 * The cookie **must** be named `__session`: with Firebase Hosting fronting Cloud
 * Run (D126), Hosting strips every request cookie *except* `__session` before
 * forwarding to the backend (it is the one cookie Hosting's CDN allows through).
 * Any other name is silently dropped, so the backend would never see the session
 * — the constraint only surfaces behind Hosting, not in local dev. (Surfaced by
 * the Phase 1b live test; see DECISIONS N5.)
 */

export const SESSION_COOKIE = "__session";

export interface SessionCookieConfig {
  /**
   * `Secure` attribute. True everywhere real (HTTPS); false only for the local
   * dev server over plain `http://127.0.0.1`, where a Secure cookie would not be
   * sent. Never false in any deployed environment.
   */
  secure: boolean;
}

const BASE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/",
  // No `domain` → host-only (D107). No `maxAge`/`expires` → a session cookie.
};

/** Set the session cookie to the given opaque id. */
export function setSessionCookie(
  reply: FastifyReply,
  id: string,
  config: SessionCookieConfig,
): void {
  reply.setCookie(SESSION_COOKIE, id, { ...BASE_COOKIE_OPTS, secure: config.secure });
}

/** Clear the session cookie (sign-out). */
export function clearSessionCookie(reply: FastifyReply, config: SessionCookieConfig): void {
  reply.clearCookie(SESSION_COOKIE, { ...BASE_COOKIE_OPTS, secure: config.secure });
}

/** Read the raw session id from the request cookies, if present. */
export function readSessionId(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}

/**
 * Build the gate preHandler. It resolves the cookie to a live session via the
 * store (warm from memory, cold from Firestore — D125) and attaches it to the
 * request, or answers `401` so the SPA sends the user through the bridge
 * (API-SPEC §1.2). This is what closes the Phase 1a interim un-gated read path.
 */
export function requireSession(store: SessionService): preHandlerHookHandler {
  return async (request, reply) => {
    const id = readSessionId(request);
    const session = id ? await store.get(id) : null;
    if (!session) {
      reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
      return reply;
    }
    request.session = session;
  };
}

declare module "fastify" {
  interface FastifyRequest {
    /** The authenticated session, attached by {@link requireSession}. */
    session?: Session;
  }
}
