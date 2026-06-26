import { describe, expect, it } from "vitest";
import { ProfileCache } from "../data/cache.js";
import { buildServer } from "../server.js";
import { InMemoryNonceStore, InMemorySessionStore } from "../test-support/fakes.js";
import { DevIdentityProvider } from "./dev-provider.js";
import { registerDevRoutes } from "./dev-routes.js";
import { SESSION_COOKIE } from "./session-cookie.js";

const DEV_ENV: NodeJS.ProcessEnv = { NODE_ENV: "development" };

function buildDevServer() {
  const provider = new DevIdentityProvider(DEV_ENV);
  const sessionStore = new InMemorySessionStore();
  const cookie = { secure: false };
  const app = buildServer({
    identityProvider: provider,
    profileCache: new ProfileCache(),
    sessionStore,
    nonceStore: new InMemoryNonceStore(),
    getStars: async () => [],
    cookie,
  });
  registerDevRoutes(app, provider, { sessionStore, cookie });
  return app;
}

describe("dev session route", () => {
  it("mints a session for the requested role and sets the session cookie", async () => {
    const app = buildDevServer();
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
    const app = buildDevServer();
    const response = await app.inject({ method: "POST", url: "/api/dev/session", payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe("brother");
    await app.close();
  });

  it("rejects an unknown role with 400", async () => {
    const app = buildDevServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/session",
      payload: { role: "superuser" },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
