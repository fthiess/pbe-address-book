import zlib from "node:zlib";
import type { Role } from "@pbe/shared";
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
  profiles: Array<{ id: number; email?: string } & Record<string, unknown>>;
  majors: unknown[];
}

function sessionFor(role: Role): Session {
  return {
    identity: {
      subject: "5001",
      profileId: 5001,
      email: "a@example.test",
      role,
      displayName: `Test ${role}`,
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

/** Decode whatever encoding the server chose for an injected response. */
function decode(response: { rawPayload: Buffer; headers: Record<string, unknown> }): DecodedBody {
  const enc = response.headers["content-encoding"];
  const raw =
    enc === "br"
      ? zlib.brotliDecompressSync(response.rawPayload)
      : enc === "gzip"
        ? zlib.gunzipSync(response.rawPayload)
        : response.rawPayload;
  return JSON.parse(raw.toString("utf-8")) as DecodedBody;
}

async function buildReadServer() {
  const cache = new ProfileCache();
  await cache.load([
    // 5001 shares email (default privacy); 5002 is unlisted (hidden from brothers);
    // 5003 has email on file but the share toggle off; 5004 is de-brothered (hidden).
    makeProfile({
      id: 5001,
      email: "a@example.test",
      adminNote: "staff eyes only",
      ghostMemberId: "ghost-5001",
    }),
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
  const cookieFor = async (role: Role) =>
    `${SESSION_COOKIE}=${await sessionStore.create(sessionFor(role))}`;
  return { app, cookie: await cookieFor("brother"), cookieFor };
}

describe("GET /api/profiles", () => {
  let app: Awaited<ReturnType<typeof buildReadServer>>["app"];
  let cookie: string;
  let cookieFor: Awaited<ReturnType<typeof buildReadServer>>["cookieFor"];

  beforeEach(async () => {
    ({ app, cookie, cookieFor } = await buildReadServer());
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

  it("gives a manager the whole roster (unlisted + de-brothered included) with restricted flags, but no off-toggle value", async () => {
    const cookieM = await cookieFor("manager");
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { "accept-encoding": "br", cookie: cookieM },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = decode(response);
    // The two whole-record-hidden records are visible to staff.
    expect(body.profiles.map((p) => p.id)).toEqual([5001, 5002, 5003, 5004]);
    expect(body.profiles.find((p) => p.id === 5002)?.unlisted).toBe(true);
    // The staff-internal note rides the manager projection (it does not for brothers).
    expect(body.profiles.find((p) => p.id === 5001)?.adminNote).toBe("staff eyes only");
    // Restricted flags are visible to a manager…
    expect(body.profiles.find((p) => p.id === 5003)).toHaveProperty("privacy");
    // …but the value behind 5003's off email-toggle is not (manager ≠ admin).
    expect(body.profiles.find((p) => p.id === 5003)).not.toHaveProperty("email");
  });

  it("lets an admin see through an off-toggle that a manager cannot", async () => {
    const cookieA = await cookieFor("admin");
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { "accept-encoding": "br", cookie: cookieA },
    });
    const body = decode(response);
    expect(body.profiles.map((p) => p.id)).toEqual([5001, 5002, 5003, 5004]);
    // 5003 hid its email; the admin override still sees it.
    expect(body.profiles.find((p) => p.id === 5003)?.email).toBe("b@example.test");
  });

  it("never ships ghostMemberId to any role", async () => {
    for (const role of ["brother", "manager", "admin"] as const) {
      const response = await app.inject({
        method: "GET",
        url: "/api/profiles",
        headers: { "accept-encoding": "br", cookie: await cookieFor(role) },
      });
      const body = decode(response);
      for (const p of body.profiles) {
        expect(p).not.toHaveProperty("ghostMemberId");
      }
    }
  });
});
