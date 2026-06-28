import type { Role } from "@pbe/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfileCache } from "../data/cache.js";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import type { IdentityProvider, Session } from "../identity/types.js";
import { buildServer } from "../server.js";
import {
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
} from "../test-support/fakes.js";

/**
 * Route-level coverage for the star write path (API-SPEC §4). The `arrayUnion`/
 * `arrayRemove` mechanics live in `data/users.ts` (proven against the emulator);
 * here the injected mutations are recording fakes, so these tests pin the route's
 * contract: the gate, the caller-scoping (a star always acts on the *session's*
 * profile, never a body-supplied actor), id validation, and the `{ stars }` echo.
 */

const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the stars test")),
};

function sessionFor(profileId: number, role: Role): Session {
  return {
    identity: {
      subject: String(profileId),
      profileId,
      email: "a@example.test",
      role,
      displayName: `Test ${role}`,
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

async function buildStarsServer() {
  const cache = new ProfileCache();
  await cache.load([]);
  const sessionStore = new InMemorySessionStore();
  const calls: { op: "add" | "remove"; profileId: number; starId: number }[] = [];
  const lists = new Map<number, number[]>();

  const app = buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: new InMemoryProfileStore(),
    sessionStore,
    nonceStore: new InMemoryNonceStore(),
    getStars: async (profileId) => lists.get(profileId) ?? [],
    addStar: async (profileId, starId) => {
      calls.push({ op: "add", profileId, starId });
      const next = [...(lists.get(profileId) ?? []).filter((s) => s !== starId), starId];
      lists.set(profileId, next);
      return next;
    },
    removeStar: async (profileId, starId) => {
      calls.push({ op: "remove", profileId, starId });
      const next = (lists.get(profileId) ?? []).filter((s) => s !== starId);
      lists.set(profileId, next);
      return next;
    },
    cookie: { secure: true },
  });

  const cookieFor = async (profileId: number, role: Role = "brother") =>
    `${SESSION_COOKIE}=${await sessionStore.create(sessionFor(profileId, role))}`;
  return { app, calls, cookieFor };
}

describe("stars routes", () => {
  let ctx: Awaited<ReturnType<typeof buildStarsServer>>;

  beforeEach(async () => {
    ctx = await buildStarsServer();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it("rejects an unauthenticated PUT with 401", async () => {
    const response = await ctx.app.inject({ method: "PUT", url: "/api/me/stars/5012" });
    expect(response.statusCode).toBe(401);
    expect(ctx.calls).toHaveLength(0);
  });

  it("adds a star scoped to the session's own profile and echoes the list", async () => {
    const cookie = await ctx.cookieFor(5247);
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/me/stars/5012",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ stars: [5012] });
    expect(response.headers["cache-control"]).toBe("no-store");
    // The mutation always targets the caller's own profile (5247), never the path id.
    expect(ctx.calls).toEqual([{ op: "add", profileId: 5247, starId: 5012 }]);
  });

  it("removes a star and echoes the resulting list", async () => {
    const cookie = await ctx.cookieFor(5247);
    await ctx.app.inject({ method: "PUT", url: "/api/me/stars/5012", headers: { cookie } });
    await ctx.app.inject({ method: "PUT", url: "/api/me/stars/5305", headers: { cookie } });
    const response = await ctx.app.inject({
      method: "DELETE",
      url: "/api/me/stars/5012",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ stars: [5305] });
  });

  it("rejects a non-numeric id with 400 and never calls the mutation", async () => {
    const cookie = await ctx.cookieFor(5247);
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/me/stars/not-a-number",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(400);
    expect(ctx.calls).toHaveLength(0);
  });
});
