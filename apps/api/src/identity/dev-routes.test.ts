import { describe, expect, it } from "vitest";
import { ProfileCache } from "../data/cache.js";
import { buildServer } from "../server.js";
import {
  InMemoryAdminUserStore,
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
} from "../test-support/fakes.js";
import { DevIdentityProvider } from "./dev-provider.js";
import { registerDevRoutes } from "./dev-routes.js";
import { SESSION_COOKIE } from "./session-cookie.js";

const DEV_ENV: NodeJS.ProcessEnv = { NODE_ENV: "development" };

async function buildDevServer(getStars: (profileId: number) => Promise<number[]> = async () => []) {
  const provider = new DevIdentityProvider(DEV_ENV);
  const sessionStore = new InMemorySessionStore();
  const cookie = { secure: false };
  const app = await buildServer({
    identityProvider: provider,
    profileCache: new ProfileCache(),
    profileStore: new InMemoryProfileStore(),
    adminUsers: new InMemoryAdminUserStore(),
    sessionStore,
    nonceStore: new InMemoryNonceStore(),
    getStars,
    addStar: async () => [],
    removeStar: async () => [],
    cookie,
  });
  registerDevRoutes(app, provider, { sessionStore, cookie, getStars });
  return app;
}

describe("dev session route", () => {
  it("mints a session for the requested role and sets the session cookie", async () => {
    const app = await buildDevServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/session",
      payload: { role: "admin" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe("admin");
    expect(response.json().profileId).toBe(5003);
    // The cookie is what lets the gate, /api/me, and sign-out work locally.
    expect(response.headers["set-cookie"]).toContain(SESSION_COOKIE);
    await app.close();
  });

  it("defaults to brother when no role is given", async () => {
    const app = await buildDevServer();
    const response = await app.inject({ method: "POST", url: "/api/dev/session", payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe("brother");
    await app.close();
  });

  it("rejects an unknown role with 400", async () => {
    const app = await buildDevServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/session",
      payload: { role: "superuser" },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("returns the caller's real starred ids, not a hardcoded [] (OFC-78)", async () => {
    const app = await buildDevServer(async () => [5010, 5020]);
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/session",
      payload: { role: "brother" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().stars).toEqual([5010, 5020]);
    await app.close();
  });
});
