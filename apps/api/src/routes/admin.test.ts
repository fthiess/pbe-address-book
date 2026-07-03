import { type Role, headshotObjectKey, thumbnailObjectKey } from "@pbe/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { ProfileCache } from "../data/cache.js";
import { StubGhostLifecycle } from "../identity/ghost-lifecycle.js";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import type { IdentityProvider, Session } from "../identity/types.js";
import { buildServer } from "../server.js";
import {
  FailingGhostLifecycle,
  InMemoryAdminUserStore,
  InMemoryImageStore,
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
  RecordingGhostLifecycle,
} from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";

/**
 * The 4c-2 admin-only controls (API-SPEC §4/§5; DECISIONS N41/N44): `DELETE
 * /api/profiles/{id}` (Ghost-first, reference-scrubbing) and `PUT
 * /api/users/{id}/role` (last-admin invariant, create-if-absent). Driven against
 * the in-memory doubles.
 */

const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the admin test")),
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

async function buildAdminServer(ghostLifecycle = new StubGhostLifecycle()) {
  const cache = new ProfileCache();
  await cache.load([
    // 5001: the delete target — has a headshot and is someone's Big Brother.
    makeProfile({ id: 5001, hasHeadshot: true, headshotVersion: "hv" }),
    // 5002: names 5001 as Big Brother (the inbound-reference scrub case).
    makeProfile({ id: 5002, bigBrotherId: 5001 }),
    // 5010: an existing admin; 5011: a promotable brother.
    makeProfile({ id: 5010 }),
    makeProfile({ id: 5011 }),
  ]);
  const sessionStore = new InMemorySessionStore();
  const store = new InMemoryProfileStore();
  const imageStore = new InMemoryImageStore();
  imageStore.seed(headshotObjectKey(5001, "hv"), Buffer.from("h"));
  imageStore.seed(thumbnailObjectKey(5001, "hv"), Buffer.from("t"));
  const adminUsers = new InMemoryAdminUserStore();
  adminUsers.seedRole(5001, "manager"); // the delete target has a users doc
  adminUsers.seedRole(5010, "admin"); // the only admin (last-admin case)
  adminUsers.seedStars(5002, [5001]); // 5002 has starred the delete target
  const audited: Record<string, unknown>[] = [];
  const app = await buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: store,
    adminUsers,
    imageStore,
    ghostLifecycle,
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
  return { app, cache, store, imageStore, adminUsers, audited, cookieFor };
}

type Ctx = Awaited<ReturnType<typeof buildAdminServer>>;

describe("DELETE /api/profiles/:id", () => {
  let ctx: Ctx;
  let ghost: RecordingGhostLifecycle;
  beforeEach(async () => {
    ghost = new RecordingGhostLifecycle();
    ctx = await buildAdminServer(ghost);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("403s a manager (admin-only)", async () => {
    const response = await ctx.app.inject({
      method: "DELETE",
      url: "/api/profiles/5001",
      headers: { cookie: await ctx.cookieFor(9001, "manager") },
    });
    expect(response.statusCode).toBe(403);
  });

  it("deletes Ghost-first, scrubbing references and purging objects", async () => {
    const response = await ctx.app.inject({
      method: "DELETE",
      url: "/api/profiles/5001",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
    });
    expect(response.statusCode).toBe(204);
    // Ghost member deleted first.
    expect(ghost.deleted).toEqual([5001]);
    // The record is gone from the cache.
    expect(ctx.cache.getById(5001)).toBeNull();
    // The inbound Big-Brother reference on 5002 was scrubbed.
    expect(ctx.cache.getById(5002)?.bigBrotherId).toBeUndefined();
    // The star reference and the users doc were scrubbed/deleted.
    expect(ctx.adminUsers.stars.get(5002)?.has(5001)).toBe(false);
    expect(ctx.adminUsers.deleted.has(5001)).toBe(true);
    // The image objects were purged.
    expect(ctx.imageStore.has(headshotObjectKey(5001, "hv"))).toBe(false);
    expect(ctx.imageStore.has(thumbnailObjectKey(5001, "hv"))).toBe(false);
    expect(ctx.audited.at(-1)).toMatchObject({
      action: "profile.delete",
      actorId: 5010,
      targetId: 5001,
      outcome: "ok",
    });
  });

  it("aborts clean with 502 when the Ghost delete fails (nothing removed)", async () => {
    const failCtx = await buildAdminServer(new FailingGhostLifecycle("delete"));
    const response = await failCtx.app.inject({
      method: "DELETE",
      url: "/api/profiles/5001",
      headers: { cookie: await failCtx.cookieFor(5010, "admin") },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "ghost_delete_failed" });
    // The record still exists; no reference was scrubbed.
    expect(failCtx.cache.getById(5001)).not.toBeNull();
    expect(failCtx.cache.getById(5002)?.bigBrotherId).toBe(5001);
    await failCtx.app.close();
  });

  it("404s an unknown brother", async () => {
    const response = await ctx.app.inject({
      method: "DELETE",
      url: "/api/profiles/9999",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("PUT /api/users/:id/role", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildAdminServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("403s a manager (admin-only)", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/users/5011/role",
      headers: { cookie: await ctx.cookieFor(9001, "manager") },
      payload: { role: "manager" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("promotes a never-signed-in brother (create-if-absent), audited before/after", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/users/5011/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "manager" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 5011, role: "manager" });
    expect(ctx.adminUsers.roles.get(5011)).toBe("manager");
    expect(ctx.audited.at(-1)).toMatchObject({
      action: "role.change",
      targetId: 5011,
      fromRole: "brother",
      toRole: "manager",
    });
  });

  it("409s demoting the only remaining admin (last-admin invariant)", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/users/5010/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "brother" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "last_admin" });
    expect(ctx.adminUsers.roles.get(5010)).toBe("admin");
  });

  it("404s when no profile with that id exists (a missing users doc alone is not an error)", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/users/9999/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "manager" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("422s an invalid role value", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/users/5011/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "superuser" },
    });
    expect(response.statusCode).toBe(422);
  });
});
