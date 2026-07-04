import type { Profile } from "@pbe/shared";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { SessionService } from "./session-store.js";
import type { Session } from "./types.js";

/**
 * The sliver of the profile cache the gate consults for its liveness check
 * (OFC-147). Narrowed to one method so the gate is decoupled from the full
 * {@link import("../data/cache.js").ProfileCache} and trivially fakeable in
 * tests; `ProfileCache` satisfies it structurally.
 */
export interface SessionLivenessCache {
  getById(id: number): Profile | null;
}

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
 *
 * Beyond existence + expiry, the gate runs a **liveness check** against the
 * profile cache (OFC-147): a session whose own brother is present in the dataset
 * but **de-brothered** (D115) is rejected **and destroyed**, not merely 401'd.
 * This is the structural, defense-in-depth backstop to the active revocation the
 * de-brother route performs — a free `Map` lookup on every request that makes
 * "your trust was withdrawn ⇒ you lose access now" hold even if some future code
 * path de-brothers a record without revoking its sessions.
 *
 * The check keys on the **positive** de-brothered signal, not on record
 * *absence*: an absent record is ambiguous (a hard delete, a not-yet-hydrated
 * initiate, or a record the cache skipped as malformed — OFC-91), so 401'ing on
 * absence would risk locking out a live brother over a data-quality blip and
 * couple every request to cache completeness. The one case absence would guard —
 * a hard-deleted brother's session — is covered where it happens, by the delete
 * route's active revocation. The gate deliberately does **not** cover role
 * *demotion* either (the role lives in the `users` collection, not the profile
 * cache, and re-reading it per request would defeat D7/D83) — the role-change
 * route's active revocation handles that. Unlisting is not a withdrawal of the
 * owner's own access, so it is not checked here.
 */
/** The single 401 body the gate answers with, whichever check fails. */
function sendUnauthenticated(reply: FastifyReply): FastifyReply {
  reply.code(401).send({ error: "unauthenticated", message: "Sign in to continue." });
  return reply;
}

export function requireSession(
  store: SessionService,
  cache: SessionLivenessCache,
): preHandlerHookHandler {
  return async (request, reply) => {
    const id = readSessionId(request);
    const session = id ? await store.get(id) : null;
    if (!session) {
      return sendUnauthenticated(reply);
    }
    // Liveness: a caller whose own record is present-and-de-brothered has had
    // trust withdrawn; tear the session down so the stale cookie stops resolving.
    const own = cache.getById(session.identity.profileId);
    if (own?.debrothered.isDebrothered) {
      if (id) {
        await store.destroy(id);
      }
      return sendUnauthenticated(reply);
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
