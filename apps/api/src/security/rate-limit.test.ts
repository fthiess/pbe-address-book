import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import { registerRateLimit, sessionKey } from "./rate-limit.js";

/**
 * Verifies the load-bearing half of the D86/OFC-73 rate limiting: session keying.
 * A tiny app mirrors buildServer's wiring (cookie → awaited rate-limit → route)
 * but uses `max: 2` so the limit is reached in three requests instead of sixty.
 */
async function buildLimitedApp() {
  const app = Fastify({ trustProxy: true });
  app.register(cookie);
  await registerRateLimit(app);
  app.get(
    "/limited",
    { config: { rateLimit: { max: 2, timeWindow: "1 minute", keyGenerator: sessionKey } } },
    async () => ({ ok: true }),
  );
  await app.ready();
  return app;
}

const withSession = (id: string) => ({ headers: { cookie: `${SESSION_COOKIE}=${id}` } });

describe("session-keyed rate limiting (OFC-73)", () => {
  it("limits repeated calls sharing one session id", async () => {
    const app = await buildLimitedApp();
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: "GET", url: "/limited", ...withSession("sess-A") });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 429]);
    await app.close();
  });

  it("keeps a different session in its own bucket", async () => {
    const app = await buildLimitedApp();
    // Exhaust session A.
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: "GET", url: "/limited", ...withSession("sess-A") });
    }
    // Session B is unaffected — one caller cannot starve another (or the instance).
    const res = await app.inject({ method: "GET", url: "/limited", ...withSession("sess-B") });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
