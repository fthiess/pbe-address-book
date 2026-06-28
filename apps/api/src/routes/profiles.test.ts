import zlib from "node:zlib";
import type { Profile, Role } from "@pbe/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { ProfileCache } from "../data/cache.js";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import type { IdentityProvider, Session } from "../identity/types.js";
import { buildServer } from "../server.js";
import {
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
} from "../test-support/fakes.js";
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
    profileStore: new InMemoryProfileStore(),
    sessionStore,
    nonceStore: new InMemoryNonceStore(),
    getStars: async () => [],
    addStar: async () => [],
    removeStar: async () => [],
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

// --- Phase 2c: the single-record read and the PATCH write path ---

/** A fixed clock so `lastModified`, the verification date, and audit stamps are deterministic. */
const FIXED_NOW = new Date("2026-06-26T12:00:00.000Z");

function sessionAs(profileId: number, role: Role): Session {
  return {
    identity: {
      subject: String(profileId),
      profileId,
      email: `u${profileId}@example.test`,
      role,
      displayName: `Test ${role} ${profileId}`,
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

async function buildWriteServer(profiles: Profile[]) {
  const cache = new ProfileCache();
  await cache.load(profiles);
  const sessionStore = new InMemorySessionStore();
  const audited: Record<string, unknown>[] = [];
  const app = buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: new InMemoryProfileStore(),
    sessionStore,
    nonceStore: new InMemoryNonceStore(),
    getStars: async () => [],
    addStar: async () => [],
    removeStar: async () => [],
    cookie: { secure: true },
    auditLog: new AuditLog({ write: (record) => audited.push(record) }),
    clock: () => FIXED_NOW,
  });
  const cookieAs = async (profileId: number, role: Role) =>
    `${SESSION_COOKIE}=${await sessionStore.create(sessionAs(profileId, role))}`;
  const etagOf = async (id: number, cookie: string) =>
    (await app.inject({ method: "GET", url: `/api/profiles/${id}`, headers: { cookie } })).headers
      .etag as string;
  return { app, cache, audited, cookieAs, etagOf };
}

describe("GET /api/profiles/:id", () => {
  it("returns the owner's own full record with an ETag, no-store", async () => {
    const { app, cookieAs } = await buildWriteServer([makeProfile({ id: 5001, phone: "555" })]);
    const cookie = await cookieAs(5001, "brother");
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/5001",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.etag).toBeTruthy();
    expect(response.json()).toMatchObject({ id: 5001, phone: "555" });
    await app.close();
  });

  it("404s a brother asking for an unlisted record (the whole-record hide)", async () => {
    const { app, cookieAs } = await buildWriteServer([
      makeProfile({ id: 5001 }),
      makeProfile({ id: 5002, unlisted: true }),
    ]);
    const cookie = await cookieAs(5001, "brother");
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/5002",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("lets a manager read an unlisted record", async () => {
    const { app, cookieAs } = await buildWriteServer([makeProfile({ id: 5002, unlisted: true })]);
    const cookie = await cookieAs(9001, "manager");
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/5002",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 5002, unlisted: true });
    await app.close();
  });
});

describe("PATCH /api/profiles/:id — concurrency, authorization, audit", () => {
  it("applies an owner edit, stamps verification, advances the ETag, and audits names not values", async () => {
    const { app, cache, audited, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({ id: 5001, phone: "555-0001" }),
    ]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag, "x-cloud-trace-context": "trace-abc/1;o=1" },
      payload: { phone: "555-0002" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBeTruthy();
    expect(response.headers.etag).not.toBe(etag);
    expect(response.json()).toMatchObject({ phone: "555-0002" });

    // Read-your-writes: the cache reflects the edit, plus the D28 owner auto-verify.
    const stored = cache.getById(5001);
    expect(stored?.phone).toBe("555-0002");
    expect(stored?.lastVerifiedDate).toBe("2026-06-26");
    expect(stored?.verifiedBy).toBe(5001);
    expect(stored?.lastModified).toBe(FIXED_NOW.toISOString());

    // Audit: one entry, names not values, with the trace id.
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      logType: "audit",
      action: "profile.update",
      actorId: 5001,
      targetId: 5001,
      outcome: "ok",
      fields: ["phone"],
      trace: "trace-abc",
    });
    expect(JSON.stringify(audited[0])).not.toContain("555-0002");
    await app.close();
  });

  it("requires If-Match (428) and rejects a stale token (412)", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(5001, "brother");

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie },
      payload: { phone: "555-0100" },
    });
    expect(missing.statusCode).toBe(428);

    const stale = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": "not-the-current-token" },
      payload: { phone: "555-0100" },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ error: "stale_write" });

    // A second writer moves the record on; the first caller's now-stale token 412s.
    const etag = await etagOf(5001, cookie);
    await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { phone: "555-0001" },
    });
    const second = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { phone: "555-0002" },
    });
    expect(second.statusCode).toBe(412);
    await app.close();
  });

  it("blocks a brother editing another record (403, object-level) and audits the denial", async () => {
    const { app, audited, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({ id: 5001 }),
      makeProfile({ id: 5003 }),
    ]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5003, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5003",
      headers: { cookie, "if-match": etag },
      payload: { phone: "x" },
    });
    expect(response.statusCode).toBe(403);
    expect(audited.at(-1)).toMatchObject({ outcome: "denied", actorId: 5001, targetId: 5003 });
    await app.close();
  });

  it("rejects a field outside the caller's powers (403) rather than dropping it", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    // adminNote is staff-only; a brother may not write it on his own record.
    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { adminNote: "let me in" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ fields: ["adminNote"] });
    await app.close();
  });

  it("forbids a manager setting another brother's consent field (owner-only)", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5003 })]);
    const cookie = await cookieAs(9001, "manager");
    const etag = await etagOf(5003, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5003",
      headers: { cookie, "if-match": etag },
      payload: { unlisted: true },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("clears verification when a manager edits another brother (D28)", async () => {
    const { app, cache, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({
        id: 5003,
        lastVerifiedDate: "2026-01-01",
        verifiedBy: 5003,
        phone: "555-0001",
      }),
    ]);
    const cookie = await cookieAs(9001, "manager");
    const etag = await etagOf(5003, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5003",
      headers: { cookie, "if-match": etag },
      payload: { phone: "555-0007" },
    });
    expect(response.statusCode).toBe(200);
    const stored = cache.getById(5003);
    expect(stored?.phone).toBe("555-0007");
    expect(stored?.lastVerifiedDate).toBeUndefined();
    expect(stored?.verifiedBy).toBeUndefined();
    await app.close();
  });

  it("returns 422 with field names on a validation failure", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { email: "not-an-email" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().issues).toContainEqual(expect.objectContaining({ field: "email" }));
    await app.close();
  });

  it("rejects a duplicate email via the dataset-level uniqueness check (422)", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({ id: 5001, email: "taken@example.test" }),
      makeProfile({ id: 5003, email: "mine@example.test" }),
    ]);
    const cookie = await cookieAs(5003, "brother");
    const etag = await etagOf(5003, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5003",
      headers: { cookie, "if-match": etag },
      payload: { email: "taken@example.test" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().issues).toContainEqual(expect.objectContaining({ field: "email" }));
    await app.close();
  });

  it("404s a PATCH to a non-existent record", async () => {
    const { app, cookieAs } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(9001, "admin");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/9999",
      headers: { cookie, "if-match": "anything" },
      payload: { phone: "x" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
