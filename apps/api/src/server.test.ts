import { describe, expect, it } from "vitest";
import { ProfileCache } from "./data/cache.js";
import type { IdentityProvider } from "./identity/types.js";
import { buildServer } from "./server.js";
import { InMemoryNonceStore, InMemorySessionStore } from "./test-support/fakes.js";

// A stub provider standing in for the real Ghost one: the health route only
// reads the provider name, and buildServer must stay provider-agnostic.
const ghostLikeProvider: IdentityProvider = {
  name: "ghost",
  createSession: () => Promise.reject(new Error("not used in the health test")),
};

describe("buildServer", () => {
  it("answers GET /api/health with the active provider name", async () => {
    const app = buildServer({
      identityProvider: ghostLikeProvider,
      profileCache: new ProfileCache(),
      sessionStore: new InMemorySessionStore(),
      nonceStore: new InMemoryNonceStore(),
      getStars: async () => [],
      cookie: { secure: true },
    });
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", provider: "ghost" });
    await app.close();
  });
});
