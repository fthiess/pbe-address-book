import cookie from "@fastify/cookie";
import type { Role } from "@pbe/shared";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { ProfileCache } from "../data/cache.js";
import { registerProfileRoutes } from "../routes/profiles.js";
import { InMemoryProfileStore, InMemorySessionStore } from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";
import { SESSION_COOKIE, requireSession } from "./session-cookie.js";
import type { Session } from "./types.js";

/**
 * The session gate's liveness check (OFC-147): a session whose own brother is
 * present-and-de-brothered is rejected AND destroyed; an absent record is NOT a
 * rejection (the delete route's active revocation is the control for that case);
 * a normal record passes. Driven through a minimal Fastify instance so the real
 * `requireSession` preHandler runs against the real `ProfileCache` and the
 * in-memory session store.
 */

function sessionFor(profileId: number, role: Role = "brother"): Session {
  return {
    identity: { subject: String(profileId), profileId, email: "a@b.test", role, displayName: "T" },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

async function buildGatedServer() {
  const cache = new ProfileCache();
  await cache.load([
    makeProfile({ id: 5001 }), // a normal, live brother
    makeProfile({
      id: 5099,
      debrothered: { isDebrothered: true, debrotheredAt: "2026-02-02T00:00:00.000Z" },
    }),
  ]);
  const sessionStore = new InMemorySessionStore();
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const gate = requireSession(sessionStore, cache);
  registerProfileRoutes(app, {
    cache,
    gate,
    store: new InMemoryProfileStore(),
    audit: new AuditLog({ write: () => {} }),
    clock: () => new Date(),
  });
  return { app, cache, sessionStore };
}

describe("requireSession liveness check (OFC-147)", () => {
  it("passes a live brother's session through the gate", async () => {
    const { app, sessionStore } = await buildGatedServer();
    const id = await sessionStore.create(sessionFor(5001));
    const res = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { cookie: `${SESSION_COOKIE}=${id}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("401s AND destroys the session of a de-brothered brother", async () => {
    const { app, sessionStore } = await buildGatedServer();
    const id = await sessionStore.create(sessionFor(5099));
    const res = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { cookie: `${SESSION_COOKIE}=${id}` },
    });
    expect(res.statusCode).toBe(401);
    // The stale cookie is torn down, not merely rejected — a second try still 401s
    // and the store no longer resolves it.
    expect(await sessionStore.get(id)).toBeNull();
    await app.close();
  });

  it("does NOT reject a session whose record is absent from the cache", async () => {
    // Absence is ambiguous (hard delete / not-yet-hydrated / skipped-malformed), so
    // the gate must not lock out a valid session on it — the deleted-brother case is
    // handled by the delete route's active revocation, not here.
    const { app, sessionStore } = await buildGatedServer();
    const id = await sessionStore.create(sessionFor(7777)); // 7777 not in the cache
    const res = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { cookie: `${SESSION_COOKIE}=${id}` },
    });
    expect(res.statusCode).toBe(200);
    expect(await sessionStore.get(id)).not.toBeNull();
    await app.close();
  });
});
