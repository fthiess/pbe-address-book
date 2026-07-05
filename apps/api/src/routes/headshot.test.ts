import { type Role, headshotObjectKey, thumbnailObjectKey } from "@pbe/shared";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { ProfileCache } from "../data/cache.js";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import type { IdentityProvider, Session } from "../identity/types.js";
import { buildServer } from "../server.js";
import {
  InMemoryAdminUserStore,
  InMemoryBackupSource,
  InMemoryBannerStore,
  InMemoryImageStore,
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
} from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";

/**
 * The headshot sub-resource + the hardened `/img/*` read (4c-1; API-SPEC §6;
 * DECISIONS D94/D98/N42/N43). Driven end-to-end against in-memory doubles (no GCS,
 * no emulator): the object-predicate auth, the magic-byte/`415`/`422` validation,
 * the objects-first/pointer-last ordering + D94 superseded-object purge, the fresh
 * `ETag`, the *absence* of a verification side-effect, and the per-record image
 * visibility at the effective role.
 */

const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the headshot test")),
};

const FIXED_NOW = new Date("2026-07-03T12:00:00.000Z");

function sessionFor(profileId: number, role: Role): Session {
  return {
    identity: {
      subject: String(profileId),
      profileId,
      email: "a@example.test",
      role,
      displayName: `Test ${role}`,
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

/** A solid-colour PNG to upload. */
function png(size = 400): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 10, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
}

async function buildHeadshotServer() {
  const cache = new ProfileCache();
  await cache.load([
    // 5001: a brother/owner with a prior verification stamp (to prove no coupling).
    makeProfile({ id: 5001, lastVerifiedDate: "2026-01-01", verifiedBy: 5001 }),
    // 5002: unlisted — hidden from brothers (the /img visibility case).
    makeProfile({ id: 5002, unlisted: true, hasHeadshot: true, headshotVersion: "u1" }),
    // 5003: already has a headshot (the DELETE + D94 superseded-purge case).
    makeProfile({ id: 5003, hasHeadshot: true, headshotVersion: "old" }),
  ]);
  const sessionStore = new InMemorySessionStore();
  const imageStore = new InMemoryImageStore();
  // Seed the objects the pre-existing versions point at.
  imageStore.seed(headshotObjectKey(5002, "u1"), Buffer.from("u1-h"));
  imageStore.seed(thumbnailObjectKey(5002, "u1"), Buffer.from("u1-t"));
  imageStore.seed(headshotObjectKey(5003, "old"), Buffer.from("old-h"));
  imageStore.seed(thumbnailObjectKey(5003, "old"), Buffer.from("old-t"));

  const store = new InMemoryProfileStore();
  const audited: Record<string, unknown>[] = [];
  let counter = 0;
  const app = await buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: store,
    adminUsers: new InMemoryAdminUserStore(),
    bannerStore: new InMemoryBannerStore(),
    backupSource: new InMemoryBackupSource(),
    imageStore,
    mintVersion: () => `v${++counter}`,
    sessionStore,
    nonceStore: new InMemoryNonceStore(),
    getStars: async () => [],
    addStar: async () => [],
    removeStar: async () => [],
    auditLog: new AuditLog({ write: (record) => audited.push(record) }),
    clock: () => FIXED_NOW,
    cookie: { secure: true },
  });
  const cookieFor = async (profileId: number, role: Role) =>
    `${SESSION_COOKIE}=${await sessionStore.create(sessionFor(profileId, role))}`;
  return { app, cache, store, imageStore, audited, cookieFor };
}

type Ctx = Awaited<ReturnType<typeof buildHeadshotServer>>;

describe("PUT /api/profiles/:id/headshot", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildHeadshotServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("rejects an unauthenticated upload with 401", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5001/headshot",
      headers: { "content-type": "image/png" },
      payload: await png(),
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a brother uploading to someone else's record with 403 (the IDOR guard)", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5003/headshot",
      headers: { "content-type": "image/png", cookie: await ctx.cookieFor(5001, "brother") },
      payload: await png(),
    });
    expect(response.statusCode).toBe(403);
    // No object was written on the denied path.
    expect(ctx.imageStore.keys().some((k) => k.includes("/5003/v"))).toBe(false);
    // The IDOR denial is audited (OFC-126), mirroring the PATCH route.
    expect(ctx.audited.at(-1)).toMatchObject({
      action: "headshot.update",
      actorId: 5001,
      targetId: 5003,
      outcome: "denied",
    });
  });

  it("rejects an unsupported declared content-type with 415 before reading the body", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5001/headshot",
      headers: { "content-type": "image/gif", cookie: await ctx.cookieFor(5001, "brother") },
      payload: Buffer.from("GIF89a"),
    });
    expect(response.statusCode).toBe(415);
  });

  it("rejects non-image bytes with 422 (magic-byte check, not the declared type)", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5001/headshot",
      headers: { "content-type": "image/png", cookie: await ctx.cookieFor(5001, "brother") },
      payload: Buffer.from("this is definitely not a PNG"),
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejects a body over the 8 MB limit with 413", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5001/headshot",
      headers: { "content-type": "image/png", cookie: await ctx.cookieFor(5001, "brother") },
      payload: Buffer.alloc(9 * 1024 * 1024),
    });
    expect(response.statusCode).toBe(413);
  });

  it("uploads the owner's headshot: writes both objects, advances the pointer, fresh ETag, audited", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5001/headshot",
      headers: { "content-type": "image/png", cookie: await ctx.cookieFor(5001, "brother") },
      payload: await png(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ hasHeadshot: true, headshotVersion: "v1" });
    // A fresh, quoted ETag (the pointer advance minted a new token).
    expect(response.headers.etag).toMatch(/^"token-\d+"$/);
    expect(response.headers["cache-control"]).toBe("no-store");

    // Both objects exist under the new version (objects-first, D98).
    expect(ctx.imageStore.has(headshotObjectKey(5001, "v1"))).toBe(true);
    expect(ctx.imageStore.has(thumbnailObjectKey(5001, "v1"))).toBe(true);
    // The stored WEBP is the real encoded 512²/96² output.
    const h = await sharp(
      (await ctx.imageStore.read(headshotObjectKey(5001, "v1")))?.body as Buffer,
    ).metadata();
    expect(h.format).toBe("webp");
    expect(h.width).toBe(512);

    // The cache reflects the pointer, and verification is UNTOUCHED (N42).
    const stored = ctx.cache.getById(5001);
    expect(stored?.hasHeadshot).toBe(true);
    expect(stored?.headshotVersion).toBe("v1");
    expect(stored?.lastVerifiedDate).toBe("2026-01-01");
    expect(stored?.verifiedBy).toBe(5001);

    const entry = ctx.audited.at(-1);
    expect(entry).toMatchObject({
      action: "headshot.update",
      actorId: 5001,
      targetId: 5001,
      outcome: "ok",
      fields: ["headshot"],
    });
  });

  it("lets a manager upload to another brother's record", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5001/headshot",
      headers: { "content-type": "image/png", cookie: await ctx.cookieFor(5002, "manager") },
      payload: await png(),
    });
    expect(response.statusCode).toBe(200);
  });

  it("purges the superseded prior version's objects on replace (D94)", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5003/headshot",
      headers: { "content-type": "image/png", cookie: await ctx.cookieFor(5003, "admin") },
      payload: await png(),
    });
    expect(response.statusCode).toBe(200);
    // New version present…
    expect(ctx.imageStore.has(headshotObjectKey(5003, "v1"))).toBe(true);
    // …and the old version's objects deleted.
    expect(ctx.imageStore.has(headshotObjectKey(5003, "old"))).toBe(false);
    expect(ctx.imageStore.has(thumbnailObjectKey(5003, "old"))).toBe(false);
  });

  it("undoes the just-written objects and 404s when the record vanished mid-write (OFC-129)", async () => {
    // The record exists in the cache (passes the authorize existence check) but is
    // gone in the store, so the pointer write throws MissingProfileError after the
    // objects were written — the route must purge them and 404, leaving no orphan.
    ctx.store.markMissing(5001);
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5001/headshot",
      headers: { "content-type": "image/png", cookie: await ctx.cookieFor(5001, "brother") },
      payload: await png(),
    });
    expect(response.statusCode).toBe(404);
    expect(ctx.imageStore.has(headshotObjectKey(5001, "v1"))).toBe(false);
    expect(ctx.imageStore.has(thumbnailObjectKey(5001, "v1"))).toBe(false);
  });
});

describe("DELETE /api/profiles/:id/headshot", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildHeadshotServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("removes the objects, flips hasHeadshot off, returns a fresh ETag, and audits", async () => {
    const response = await ctx.app.inject({
      method: "DELETE",
      url: "/api/profiles/5003/headshot",
      headers: { cookie: await ctx.cookieFor(5003, "admin") },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ hasHeadshot: false });
    expect(response.headers.etag).toMatch(/^"token-\d+"$/);

    expect(ctx.imageStore.has(headshotObjectKey(5003, "old"))).toBe(false);
    expect(ctx.imageStore.has(thumbnailObjectKey(5003, "old"))).toBe(false);
    const stored = ctx.cache.getById(5003);
    expect(stored?.hasHeadshot).toBe(false);
    expect(stored?.headshotVersion).toBeUndefined();
    expect(ctx.audited.at(-1)).toMatchObject({
      action: "headshot.remove",
      targetId: 5003,
      outcome: "ok",
    });
  });

  it("is a no-op (no write, no audit) when there is no headshot", async () => {
    const response = await ctx.app.inject({
      method: "DELETE",
      url: "/api/profiles/5001/headshot",
      headers: { cookie: await ctx.cookieFor(5001, "brother") },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ hasHeadshot: false });
    expect(ctx.audited.some((e) => e.action === "headshot.remove")).toBe(false);
  });

  it("rejects a brother deleting another brother's headshot with 403", async () => {
    const response = await ctx.app.inject({
      method: "DELETE",
      url: "/api/profiles/5003/headshot",
      headers: { cookie: await ctx.cookieFor(5001, "brother") },
    });
    expect(response.statusCode).toBe(403);
    expect(ctx.imageStore.has(headshotObjectKey(5003, "old"))).toBe(true);
  });
});

describe("GET /img/* — hardened visibility (N43)", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildHeadshotServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("serves a visible brother's image with immutable, private caching", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/img/${thumbnailObjectKey(5003, "old")}`,
      headers: { cookie: await ctx.cookieFor(5001, "brother") },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
  });

  it("withholds an UNLISTED brother's image from a brother-role caller (404)", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/img/${thumbnailObjectKey(5002, "u1")}`,
      headers: { cookie: await ctx.cookieFor(5001, "brother") },
    });
    expect(response.statusCode).toBe(404);
  });

  it("serves the same unlisted image to a manager (role sees the record)", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/img/${thumbnailObjectKey(5002, "u1")}`,
      headers: { cookie: await ctx.cookieFor(5001, "manager") },
    });
    expect(response.statusCode).toBe(200);
  });

  it("serves the unlisted brother their OWN image", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/img/${thumbnailObjectKey(5002, "u1")}`,
      headers: { cookie: await ctx.cookieFor(5002, "brother") },
    });
    expect(response.statusCode).toBe(200);
  });

  it("404s a path that is not a well-formed image key (forecloses reading other objects)", async () => {
    for (const path of ["/img/secret.csv", "/img/headshots/5001", "/img/other/5001/v.webp"]) {
      const response = await ctx.app.inject({
        method: "GET",
        url: path,
        headers: { cookie: await ctx.cookieFor(5001, "brother") },
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it("404s an image for a brother that does not exist", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/img/${thumbnailObjectKey(9999, "v1")}`,
      headers: { cookie: await ctx.cookieFor(5001, "brother") },
    });
    expect(response.statusCode).toBe(404);
  });
});
