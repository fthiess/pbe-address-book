import { describe, expect, it } from "vitest";
import { ProfileCache } from "./data/cache.js";
import type { IdentityProvider } from "./identity/types.js";
import { buildServer } from "./server.js";
import {
  InMemoryAdminUserStore,
  InMemoryBackupSource,
  InMemoryBannerStore,
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
} from "./test-support/fakes.js";

// A stub provider standing in for the real Ghost one: the health route only
// reads the provider name, and buildServer must stay provider-agnostic.
const ghostLikeProvider: IdentityProvider = {
  name: "ghost",
  createSession: () => Promise.reject(new Error("not used in the health test")),
};

describe("buildServer", () => {
  const baseOptions = () => ({
    identityProvider: ghostLikeProvider,
    profileCache: new ProfileCache(),
    profileStore: new InMemoryProfileStore(),
    adminUsers: new InMemoryAdminUserStore(),
    bannerStore: new InMemoryBannerStore(),
    backupSource: new InMemoryBackupSource(),
    sessionStore: new InMemorySessionStore(),
    nonceStore: new InMemoryNonceStore(),
    getStars: async () => [],
    addStar: async () => [],
    removeStar: async () => [],
    cookie: { secure: true as const },
  });

  it("answers GET /api/health with the active provider name", async () => {
    const app = await buildServer(baseOptions());
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", provider: "ghost" });
    await app.close();
  });

  it("sets the D107 security headers on API responses (OFC-148)", async () => {
    const app = await buildServer(baseOptions());
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers["strict-transport-security"]).toContain("max-age=31536000");
    await app.close();
  });

  it("does not leak a thrown error's message in the 500 body (OFC-149)", async () => {
    const app = await buildServer(baseOptions());
    // A route that throws a detail-carrying error, like a raw Firestore failure.
    app.get("/api/boom", async () => {
      throw new Error("firestore: projects/pbe-book-staging/databases/(default) internal detail");
    });
    const response = await app.inject({ method: "GET", url: "/api/boom" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal", message: "Something went wrong." });
    // The internal detail is nowhere in the client-visible body.
    expect(response.body).not.toContain("firestore");
    expect(response.body).not.toContain("pbe-book-staging");
    await app.close();
  });
});
