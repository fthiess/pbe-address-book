import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfileCache } from "../data/cache.js";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import type { IdentityProvider, Session } from "../identity/types.js";
import { buildServer } from "../server.js";
import { InMemoryNonceStore, InMemorySessionStore } from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";

// A no-op provider: these tests exercise the read path, not the handshake.
const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the read-path test")),
};

interface DecodedBody {
  profiles: Array<{ id: number; email?: string }>;
  majors: unknown[];
}

function brotherSession(): Session {
  return {
    identity: {
      subject: "5001",
      profileId: 5001,
      email: "a@example.test",
      role: "brother",
      displayName: "Test Brother",
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

async function buildReadServer() {
  const cache = new ProfileCache();
  await cache.load([
    // 5001 shares email (default privacy); 5002 is unlisted (hidden); 5003 has
    // email on file but the share toggle off; 5004 is de-brothered (hidden).
    makeProfile({ id: 5001, email: "a@example.test" }),
    makeProfile({ id: 5002, unlisted: true }),
    makeProfile({
      id: 5003,
      email: "b@example.test",
      privacy: {
        shareEmail: false,
        sharePhone: true,
        shareAddress: true,
        shareEmergency: false,
        shareSpousePartner: false,
      },
    }),
    makeProfile({ id: 5004, debrothered: { isDebrothered: true } }),
  ]);
  const sessionStore = new InMemorySessionStore();
  const app = buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    sessionStore,
    nonceStore: new InMemoryNonceStore(),
    getStars: async () => [],
    cookie: { secure: true },
  });
  const sessionId = await sessionStore.create(brotherSession());
  return { app, cookie: `${SESSION_COOKIE}=${sessionId}` };
}

describe("GET /api/profiles", () => {
  let app: Awaited<ReturnType<typeof buildReadServer>>["app"];
  let cookie: string;

  beforeEach(async () => {
    ({ app, cookie } = await buildReadServer());
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects an unauthenticated request with 401 (the Phase 1b gate)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("serves brotli with no-store and the right headers when br is accepted", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { "accept-encoding": "br, gzip", cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.vary).toBe("Accept-Encoding");
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");

    const body = JSON.parse(
      zlib.brotliDecompressSync(response.rawPayload).toString("utf-8"),
    ) as DecodedBody;
    // The unlisted (5002) and de-brothered (5004) records are projected away.
    expect(body.profiles.map((p) => p.id)).toEqual([5001, 5003]);
    // Email rides the consent toggle: present for 5001, absent for 5003.
    expect(body.profiles.find((p) => p.id === 5001)?.email).toBe("a@example.test");
    expect(body.profiles.find((p) => p.id === 5003)).not.toHaveProperty("email");
    expect(body.majors).toEqual([]);
  });

  it("serves gzip when br is not accepted but gzip is", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { "accept-encoding": "gzip, deflate", cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    const body = JSON.parse(zlib.gunzipSync(response.rawPayload).toString("utf-8")) as DecodedBody;
    expect(body.profiles).toHaveLength(2);
  });

  it("serves uncompressed JSON when no encoding is accepted", async () => {
    const response = await app.inject({ method: "GET", url: "/api/profiles", headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = JSON.parse(response.payload) as DecodedBody;
    expect(body.profiles).toHaveLength(2);
  });
});
