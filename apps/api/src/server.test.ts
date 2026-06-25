import { describe, expect, it } from "vitest";
import { GhostIdentityProvider } from "./identity/ghost-provider.js";
import { buildServer } from "./server.js";

describe("buildServer", () => {
  it("answers GET /api/health with the active provider name", async () => {
    const app = buildServer({ identityProvider: new GhostIdentityProvider() });
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", provider: "ghost" });
    await app.close();
  });
});
