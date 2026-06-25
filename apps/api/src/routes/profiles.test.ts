import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfileCache } from "../data/cache.js";
import type { IdentityProvider } from "../identity/types.js";
import { buildServer } from "../server.js";
import { makeProfile } from "../test-support/make-profile.js";

// A no-op provider: the read path does not touch auth in Phase 1a, so a stub
// keeps this test off the DevIdentityProvider's environment guard.
const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the read-path test")),
};

interface DecodedBody {
  profiles: Array<{ constitutionId: number; email?: string }>;
  majors: unknown[];
}

async function buildReadServer() {
  const cache = new ProfileCache();
  await cache.load([
    makeProfile({ constitutionId: 5001, allowDirectoryEmail: true, email: "a@example.test" }),
    makeProfile({ constitutionId: 5002, unlisted: true }),
    makeProfile({ constitutionId: 5003, allowDirectoryEmail: false, email: "b@example.test" }),
  ]);
  return buildServer({ identityProvider: stubProvider, profileCache: cache });
}

describe("GET /api/profiles", () => {
  let app: Awaited<ReturnType<typeof buildReadServer>>;

  beforeEach(async () => {
    app = await buildReadServer();
  });

  afterEach(async () => {
    await app.close();
  });

  it("serves brotli with no-store and the right headers when br is accepted", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { "accept-encoding": "br, gzip" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.vary).toBe("Accept-Encoding");
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");

    const body = JSON.parse(
      zlib.brotliDecompressSync(response.rawPayload).toString("utf-8"),
    ) as DecodedBody;
    // The unlisted record (5002) is projected away; the others remain.
    expect(body.profiles.map((p) => p.constitutionId)).toEqual([5001, 5003]);
    // Email rides the consent toggle: present for 5001, absent for 5003.
    expect(body.profiles.find((p) => p.constitutionId === 5001)?.email).toBe("a@example.test");
    expect(body.profiles.find((p) => p.constitutionId === 5003)).not.toHaveProperty("email");
    expect(body.majors).toEqual([]);
  });

  it("serves gzip when br is not accepted but gzip is", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { "accept-encoding": "gzip, deflate" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    const body = JSON.parse(zlib.gunzipSync(response.rawPayload).toString("utf-8")) as DecodedBody;
    expect(body.profiles).toHaveLength(2);
  });

  it("serves uncompressed JSON when no encoding is accepted", async () => {
    const response = await app.inject({ method: "GET", url: "/api/profiles" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = JSON.parse(response.payload) as DecodedBody;
    expect(body.profiles).toHaveLength(2);
  });
});
