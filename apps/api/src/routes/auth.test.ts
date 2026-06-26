import { describe, expect, it } from "vitest";
import { ProfileCache } from "../data/cache.js";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import { AuthError, type IdentityProvider, type Session } from "../identity/types.js";
import { buildServer } from "../server.js";
import {
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
} from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";

function sessionFor(profileId: number, role: "brother" | "manager" | "admin"): Session {
  return {
    identity: {
      subject: String(profileId),
      profileId,
      email: "x@example.test",
      role,
      displayName: "X",
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

// A stub Ghost provider: `good` succeeds, the others throw the spec's AuthErrors.
const provider: IdentityProvider = {
  name: "ghost-stub",
  async createSession(request) {
    if (request.token === "good" && request.state) {
      return sessionFor(5001, "brother");
    }
    if (request.token === "unlinked") {
      throw new AuthError(403, "unlinked_member");
    }
    throw new AuthError(401, "invalid_token");
  },
};

async function buildAuthServer(withBridge = true) {
  const cache = new ProfileCache();
  await cache.load([
    makeProfile({
      id: 5001,
      email: "x@example.test",
      // shareEmail off proves the owner still gets his OWN value back via /api/me…
      privacy: {
        shareEmail: false,
        sharePhone: true,
        shareAddress: true,
        shareEmergency: false,
        shareSpousePartner: false,
      },
      // …while these never reach any client, even their owner (§9).
      adminNote: "staff eyes only",
      ghostMemberId: "ghost-5001",
    }),
  ]);
  const sessionStore = new InMemorySessionStore();
  const app = buildServer({
    identityProvider: provider,
    profileCache: cache,
    profileStore: new InMemoryProfileStore(),
    sessionStore,
    nonceStore: new InMemoryNonceStore(),
    getStars: async () => [42],
    cookie: { secure: true },
    ghostBridge: withBridge ? { url: "https://pbe400.org/book", target: "staging" } : undefined,
  });
  return { app, sessionStore };
}

function cookieFromResponse(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (header ?? "").split(";")[0] ?? "";
}

describe("auth routes", () => {
  it("POST /api/auth/start mints a nonce and a relay URL carrying state + target", async () => {
    const { app } = await buildAuthServer();
    const response = await app.inject({ method: "POST", url: "/api/auth/start" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const url = new URL(body.signInUrl);
    expect(url.origin + url.pathname).toBe("https://pbe400.org/book");
    expect(url.searchParams.get("state")).toBe(body.state);
    expect(url.searchParams.get("target")).toBe("staging");
    await app.close();
  });

  it("POST /api/auth/start is 404 when no Ghost bridge is configured", async () => {
    const { app } = await buildAuthServer(false);
    const response = await app.inject({ method: "POST", url: "/api/auth/start" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("POST /api/auth/session completes the handshake, sets the cookie, returns identity", async () => {
    const { app } = await buildAuthServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "good", state: "s" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ profileId: 5001, role: "brother", stars: [42] });
    expect(response.headers["set-cookie"]).toContain(SESSION_COOKIE);
    await app.close();
  });

  it("POST /api/auth/session maps an AuthError to its status + code", async () => {
    const { app } = await buildAuthServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "unlinked", state: "s" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "unlinked_member" });
    await app.close();
  });

  it("GET /api/me requires a session, then returns own state no-store", async () => {
    const { app } = await buildAuthServer();
    const unauthed = await app.inject({ method: "GET", url: "/api/me" });
    expect(unauthed.statusCode).toBe(401);

    const signIn = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "good", state: "s" },
    });
    const cookie = cookieFromResponse(signIn.headers["set-cookie"]);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.headers["cache-control"]).toBe("no-store");
    const body = me.json();
    expect(body.profileId).toBe(5001);
    expect(body.role).toBe("brother");
    expect(body.stars).toEqual([42]);
    expect(body.profile.id).toBe(5001);
    // The owner gets his own value back even with the share toggle off (D82)…
    expect(body.profile.email).toBe("x@example.test");
    // …but never the staff-internal note or the system-internal Ghost id (§9).
    expect(body.profile).not.toHaveProperty("adminNote");
    expect(body.profile).not.toHaveProperty("ghostMemberId");
    await app.close();
  });

  it("POST /api/auth/signout clears the session so the next request is 401", async () => {
    const { app } = await buildAuthServer();
    const signIn = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "good", state: "s" },
    });
    const cookie = cookieFromResponse(signIn.headers["set-cookie"]);

    const out = await app.inject({ method: "POST", url: "/api/auth/signout", headers: { cookie } });
    expect(out.statusCode).toBe(204);

    const after = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(after.statusCode).toBe(401);
    await app.close();
  });
});
