import { describe, expect, it } from "vitest";
import { ProfileCache } from "./data/cache.js";
import type { IdentityProvider } from "./identity/types.js";
import { buildServer } from "./server.js";
import {
  InMemoryAdminUserStore,
  InMemoryBackupSource,
  InMemoryBannerStore,
  InMemoryBugReportStore,
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
    bugReportStore: new InMemoryBugReportStore(),
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

  // ---------------------------------------------------------------------------
  // The `Cache-Control` floor (7b-1 / OFC-212).
  //
  // Firebase Hosting stamps its own default `Cache-Control: max-age=600` onto any
  // `/api/**` rewrite response that arrives WITHOUT one of its own — measured live
  // on staging, and the mechanism behind the 5.5c/OFC-192 "404 replayed from disk
  // cache" bug. Individual handlers set `no-store` one by one, so every branch
  // nobody remembered (Fastify's own not-found handler, a thrown 5xx) inherits the
  // ten-minute default. These lock in a floor rather than another per-route fix.
  // ---------------------------------------------------------------------------

  it("floors an API response that sets no Cache-Control to no-store (OFC-212/D95)", async () => {
    const app = await buildServer(baseOptions());
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("floors Fastify's own not-found 404 to no-store (OFC-212)", async () => {
    const app = await buildServer(baseOptions());
    const response = await app.inject({ method: "GET", url: "/api/no-such-route" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("floors a thrown 5xx to no-store (OFC-212)", async () => {
    const app = await buildServer(baseOptions());
    app.get("/api/kaboom", async () => {
      throw new Error("boom");
    });
    const response = await app.inject({ method: "GET", url: "/api/kaboom" });
    expect(response.statusCode).toBe(500);
    expect(response.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("leaves a handler's explicit Cache-Control alone — the floor only fills gaps", async () => {
    const app = await buildServer(baseOptions());
    // Two deliberate non-`no-store` values Book actually serves: the banner's
    // `no-cache` (revalidate, but cacheable) and the D126 immutable image header.
    app.get("/api/banner-like", async (_request, reply) =>
      reply.header("Cache-Control", "no-cache").send({ ok: true }),
    );
    app.get("/img/like", async (_request, reply) =>
      reply.header("Cache-Control", "private, max-age=31536000, immutable").send("bytes"),
    );
    const banner = await app.inject({ method: "GET", url: "/api/banner-like" });
    expect(banner.headers["cache-control"]).toBe("no-cache");
    const image = await app.inject({ method: "GET", url: "/img/like" });
    expect(image.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    await app.close();
  });
});
