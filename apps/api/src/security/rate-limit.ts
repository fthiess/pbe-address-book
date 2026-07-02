import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from "fastify";
import { readSessionId } from "../identity/session-cookie.js";

/**
 * Rate limits / abuse controls (DECISIONS D86; finding OFC-73). Book runs as a
 * SINGLE Cloud Run instance (D83, `max-instances=1`, not autoscaled), so every
 * caller shares one CPU: an authenticated caller hammering the bulk read, or an
 * unauthenticated caller hammering the RSA-verify on `POST /api/auth/session`,
 * can starve everyone else. These per-route ceilings bound that.
 *
 * Two keying strategies (see {@link sessionKey}):
 *  - **Authenticated** routes key on the **session id**, so one signed-in caller
 *    cannot exhaust the instance — and, crucially, so the limit does NOT collapse
 *    every member into one bucket. Book sits behind Firebase Hosting → Cloud Run
 *    (D126), so without `trustProxy` the socket IP is the *proxy's*, identical for
 *    all users; keying on the session sidesteps that entirely for the routes that
 *    matter most.
 *  - **Unauthenticated** auth routes have no session, so they key on the client
 *    IP (`trustProxy` is enabled on the server so `request.ip` is the real client
 *    from `X-Forwarded-For`, not the shared proxy). This is a coarse, in-app bound
 *    on accidental and casual abuse — deliberately NOT a hard DoS shield, which at
 *    the IP layer would need the load balancer / Cloud Armor that D126 removed to
 *    floor cost. A determined attacker can rotate a spoofed leftmost XFF entry;
 *    the authenticated-route session keying is the load-bearing control.
 *
 * The plugin is registered `global: false` — a route is limited only when it opts
 * in via `config` — so unlisted routes (e.g. the health check) are never touched.
 * The compression-CPU amplifier D86 also names is handled separately: the staff
 * payloads are now memoized (`data/cache.ts`, OFC-73) and the brother payload is
 * precomputed off the request path (D84).
 */

/** The window every Book limit is measured over. */
const WINDOW = "1 minute";

/**
 * Per-instance, per-key request ceilings. Generous enough that no human — even
 * one reloading, re-sorting, or toggling stars quickly — trips them, so the only
 * thing they bound is a script. Tuned for the single instance (D83) and the ~700
 * living-brother audience, several of whom are on slow links, so the numbers err
 * toward never getting in a real member's way.
 */
export const RATE_LIMITS = {
  /** `POST /api/auth/start` + `POST /api/auth/session` — the unauthenticated crypto path. */
  auth: 30,
  /** `GET /api/profiles` — the bulk directory read (per session). */
  read: 60,
  /** Authenticated mutations: profile edits, stars, exports, "View as" (per session). */
  write: 120,
} as const;

/**
 * Key an authenticated route by session id, falling back to client IP for a
 * request with no (or an unreadable) session cookie — which the gate will 401
 * anyway, so those share one small bucket harmlessly.
 */
export function sessionKey(request: FastifyRequest): string {
  const id = readSessionId(request);
  return id ? `sess:${id}` : `ip:${request.ip}`;
}

/** Key an unauthenticated auth route by client IP, in its own keyspace. */
function authKey(request: FastifyRequest): string {
  return `auth:${request.ip}`;
}

/**
 * Register the rate-limit plugin in opt-in mode (routes limit themselves via
 * `config`). **Must be awaited before any rate-limited route is registered**: the
 * plugin enforces per-route limits through an `onRoute` hook, which only sees
 * routes added *after* the plugin has finished loading. A non-awaited
 * `app.register` loads during `listen()`, i.e. after buildServer's synchronous
 * route registration — so the limits would silently not apply (verified: without
 * the await, a per-route `max` is ignored). Hence buildServer awaits this first.
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  // `global: false`: no route is limited unless it sets `config.rateLimit`.
  await app.register(rateLimit, { global: false });
}

/** Route `config` fragment for the unauthenticated auth endpoints (IP-keyed). */
export function authRateLimit(): RouteShorthandOptions["config"] {
  return { rateLimit: { max: RATE_LIMITS.auth, timeWindow: WINDOW, keyGenerator: authKey } };
}

/** Route `config` fragment for the bulk read (session-keyed). */
export function readRateLimit(): RouteShorthandOptions["config"] {
  return { rateLimit: { max: RATE_LIMITS.read, timeWindow: WINDOW, keyGenerator: sessionKey } };
}

/** Route `config` fragment for authenticated mutations (session-keyed). */
export function writeRateLimit(): RouteShorthandOptions["config"] {
  return { rateLimit: { max: RATE_LIMITS.write, timeWindow: WINDOW, keyGenerator: sessionKey } };
}
