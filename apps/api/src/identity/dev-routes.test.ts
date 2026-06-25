import { describe, expect, it } from "vitest";
import { ProfileCache } from "../data/cache.js";
import { buildServer } from "../server.js";
import { DevIdentityProvider } from "./dev-provider.js";
import { registerDevRoutes } from "./dev-routes.js";

const DEV_ENV: NodeJS.ProcessEnv = { NODE_ENV: "development" };

function buildDevServer() {
  const provider = new DevIdentityProvider(DEV_ENV);
  const app = buildServer({ identityProvider: provider, profileCache: new ProfileCache() });
  registerDevRoutes(app, provider);
  return app;
}

describe("dev session route", () => {
  it("mints a session for the requested role", async () => {
    const app = buildDevServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/session",
      payload: { role: "admin" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().session.identity.role).toBe("admin");
    await app.close();
  });

  it("defaults to brother when no role is given", async () => {
    const app = buildDevServer();
    const response = await app.inject({ method: "POST", url: "/api/dev/session", payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json().session.identity.role).toBe("brother");
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
