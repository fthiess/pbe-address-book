import { type Profile, type Role, headshotObjectKey, thumbnailObjectKey } from "@pbe/shared";
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
  InMemoryBackupSource,
  InMemoryBannerStore,
  InMemoryBugReportStore,
  InMemoryImageStore,
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
  RecordingGhostLifecycle,
} from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";

/**
 * The 4c-2 admin-only controls (API-SPEC §4/§5; DECISIONS N41/D106): `DELETE
 * /api/profiles/{id}` (Ghost-first, reference-scrubbing) and `PUT
 * /api/profiles/{id}/role` (re-pathed by OFC-139; the last-admin invariant now
 * reads the ProfileCache's admin count, and `role` lives on the profile). Driven
 * against the in-memory doubles.
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
    // 5001: the delete target — has a headshot, a Ghost member, and is someone's Big Brother.
    makeProfile({
      id: 5001,
      role: "manager",
      hasHeadshot: true,
      headshotVersion: "hv",
      ghostMemberId: "ghost-5001",
    }),
    // 5002: names 5001 as Big Brother (the inbound-reference scrub case).
    makeProfile({ id: 5002, bigBrotherId: 5001 }),
    // 5010: the sole admin (last-admin cases); 5011: a promotable brother (with a
    // Ghost member); 5013: a manager (the role-change/revocation target). Role now
    // lives on the profile (OFC-139).
    makeProfile({ id: 5010, role: "admin" }),
    makeProfile({ id: 5011, ghostMemberId: "ghost-5011" }),
    // 5012: a Book-only brother — no email, so no Ghost member (C15/D20/D115).
    makeProfile({ id: 5012 }),
    makeProfile({ id: 5013, role: "manager" }),
  ]);
  const sessionStore = new InMemorySessionStore();
  const store = new InMemoryProfileStore();
  const imageStore = new InMemoryImageStore();
  imageStore.seed(headshotObjectKey(5001, "hv"), Buffer.from("h"));
  imageStore.seed(thumbnailObjectKey(5001, "hv"), Buffer.from("t"));
  const adminUsers = new InMemoryAdminUserStore();
  adminUsers.seedStars(5002, [5001]); // 5002 has starred the delete target
  const audited: Record<string, unknown>[] = [];
  const app = await buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: store,
    adminUsers,
    bannerStore: new InMemoryBannerStore(),
    backupSource: new InMemoryBackupSource(),
    bugReportStore: new InMemoryBugReportStore(),
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
  return { app, cache, store, imageStore, adminUsers, audited, sessionStore, cookieFor };
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

  it("deletes a Book-only (Ghost-less) brother with no Ghost call, even if Ghost would fail", async () => {
    // 5012 has no ghostMemberId. The Ghost step must be skipped entirely — a real
    // deleteMember without an id throws, which would otherwise 502 every email-less
    // brother (~1/3 of the real roster) into being undeletable (OFC-201 follow-up).
    const failCtx = await buildAdminServer(new FailingGhostLifecycle("delete"));
    const response = await failCtx.app.inject({
      method: "DELETE",
      url: "/api/profiles/5012",
      headers: { cookie: await failCtx.cookieFor(5010, "admin") },
    });
    expect(response.statusCode).toBe(204);
    expect(failCtx.cache.getById(5012)).toBeNull();
    await failCtx.app.close();
  });

  it("409s deleting the only remaining admin (last-admin invariant, no Ghost call) [OFC-134]", async () => {
    // 5010 is the sole admin; deleting it (here, itself) would leave zero admins.
    const response = await ctx.app.inject({
      method: "DELETE",
      url: "/api/profiles/5010",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "last_admin" });
    // Nothing was touched: the Ghost-first step never ran and the record survives.
    expect(ghost.deleted).toEqual([]);
    expect(ctx.cache.getById(5010)).not.toBeNull();
    expect(ctx.adminUsers.deleted.has(5010)).toBe(false);
    expect(ctx.audited.at(-1)).toMatchObject({
      action: "profile.delete",
      targetId: 5010,
      outcome: "denied",
    });
  });

  it("deletes a non-last admin normally (204) [OFC-134]", async () => {
    // Promote 5011 to admin via the role endpoint so 5010 is no longer the last one
    // (role now lives on the profile, OFC-139) — now two admins exist.
    await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5011/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "admin" },
    });
    const response = await ctx.app.inject({
      method: "DELETE",
      url: "/api/profiles/5011",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
    });
    expect(response.statusCode).toBe(204);
    expect(ghost.deleted).toEqual([5011]);
    expect(ctx.cache.getById(5011)).toBeNull();
  });

  it("revokes the deleted brother's live sessions, auditing the count (OFC-147)", async () => {
    const victimId = await ctx.sessionStore.create(sessionFor(5001, "brother"));
    const adminId = await ctx.sessionStore.create(sessionFor(5010, "admin"));
    const response = await ctx.app.inject({
      method: "DELETE",
      url: "/api/profiles/5001",
      headers: { cookie: `${SESSION_COOKIE}=${adminId}` },
    });
    expect(response.statusCode).toBe(204);
    expect(ctx.audited.at(-1)).toMatchObject({
      action: "profile.delete",
      targetId: 5001,
      sessionsRevoked: 1,
    });
    // The deleted brother's session is gone; the acting admin's survives.
    expect(await ctx.sessionStore.get(victimId)).toBeNull();
    expect((await ctx.sessionStore.get(adminId))?.identity.profileId).toBe(5010);
  });

  it("preserves a concurrent PATCH to a referrer committed during the scrub [OFC-135]", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5001 }),
      makeProfile({ id: 5002, bigBrotherId: 5001, lastModified: "2026-01-01T00:00:00.000Z" }),
    ]);
    // A store whose scrub write to 5002 simulates a PATCH landing in the cache
    // mid-flight: right after the scrub's Firestore write it commits a cache update
    // to 5002 (a field the scrub does not touch) — exactly the interleave the re-base
    // fix must survive. With the pre-await snapshot this update was clobbered.
    class ConcurrentPatchStore extends InMemoryProfileStore {
      override async updateUnconditional(id: number): Promise<string> {
        const token = await super.updateUnconditional(id);
        if (id === 5002) {
          const patched: Profile = {
            ...(cache.getById(5002) as Profile),
            lastModified: "2099-12-31T00:00:00.000Z",
          };
          await cache.applyUpdate(patched, "token-concurrent");
        }
        return token;
      }
    }
    const sessionStore = new InMemorySessionStore();
    const app = await buildServer({
      identityProvider: stubProvider,
      profileCache: cache,
      profileStore: new ConcurrentPatchStore(),
      adminUsers: new InMemoryAdminUserStore(),
      bannerStore: new InMemoryBannerStore(),
      backupSource: new InMemoryBackupSource(),
      bugReportStore: new InMemoryBugReportStore(),
      imageStore: new InMemoryImageStore(),
      ghostLifecycle: new RecordingGhostLifecycle(),
      sessionStore,
      nonceStore: new InMemoryNonceStore(),
      getStars: async () => [],
      addStar: async () => [],
      removeStar: async () => [],
      auditLog: new AuditLog({ write: () => {} }),
      clock: () => FIXED_NOW,
      cookie: { secure: true },
    });
    const cookie = `${SESSION_COOKIE}=${await sessionStore.create(sessionFor(5010, "admin"))}`;
    const response = await app.inject({
      method: "DELETE",
      url: "/api/profiles/5001",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(204);
    const scrubbed = cache.getById(5002);
    expect(scrubbed?.bigBrotherId).toBeUndefined(); // the scrub applied
    expect(scrubbed?.lastModified).toBe("2099-12-31T00:00:00.000Z"); // the concurrent PATCH survived
    await app.close();
  });
});

describe("PUT /api/profiles/:id/role", () => {
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
      url: "/api/profiles/5011/role",
      headers: { cookie: await ctx.cookieFor(9001, "manager") },
      payload: { role: "manager" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("writes the role onto the profile, audited before/after", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5011/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "manager" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 5011, role: "manager" });
    // Role is written onto the profile record in the cache (OFC-139), not a users doc.
    expect(ctx.cache.getById(5011)?.role).toBe("manager");
    expect(ctx.audited.at(-1)).toMatchObject({
      action: "role.change",
      targetId: 5011,
      fromRole: "brother",
      toRole: "manager",
    });
  });

  it("409s demoting the only remaining admin (last-admin invariant over the cache)", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5010/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "brother" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "last_admin" });
    // The sole admin's role is unchanged in the cache.
    expect(ctx.cache.getById(5010)?.role).toBe("admin");
  });

  it("allows demoting an admin once a second admin exists", async () => {
    // Promote 5011 to admin, so 5010 is no longer the last one (two admins → one).
    await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5011/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "admin" },
    });
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5010/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "brother" },
    });
    expect(response.statusCode).toBe(200);
    expect(ctx.cache.getById(5010)?.role).toBe("brother");
  });

  it("404s when no profile with that id exists", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/9999/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "manager" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("422s promoting a brother who can't sign in (emailless) to administrator (promote-guard, OFC-241)", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5010, role: "admin" }), // a usable acting admin
      makeProfile({ id: 5020, email: undefined }), // an email-less brother — can never sign in
    ]);
    const sessionStore = new InMemorySessionStore();
    const app = await buildServer({
      identityProvider: stubProvider,
      profileCache: cache,
      profileStore: new InMemoryProfileStore(),
      adminUsers: new InMemoryAdminUserStore(),
      bannerStore: new InMemoryBannerStore(),
      backupSource: new InMemoryBackupSource(),
      bugReportStore: new InMemoryBugReportStore(),
      imageStore: new InMemoryImageStore(),
      ghostLifecycle: new StubGhostLifecycle(),
      sessionStore,
      nonceStore: new InMemoryNonceStore(),
      getStars: async () => [],
      addStar: async () => [],
      removeStar: async () => [],
      auditLog: new AuditLog({ write: () => {} }),
      clock: () => FIXED_NOW,
      cookie: { secure: true },
    });
    const cookie = `${SESSION_COOKIE}=${await sessionStore.create(sessionFor(5010, "admin"))}`;
    const response = await app.inject({
      method: "PUT",
      url: "/api/profiles/5020/role",
      headers: { cookie },
      payload: { role: "admin" },
    });
    expect(response.statusCode).toBe(422);
    expect(cache.getById(5020)?.role).toBe("brother"); // unchanged
    await app.close();
  });

  it("blocks the LAST admin's self-demotion after the other admins are demoted in sequence [live repro]", async () => {
    const admin = await ctx.cookieFor(5010, "admin");
    const put = (id: number, role: Role) =>
      ctx.app.inject({
        method: "PUT",
        url: `/api/profiles/${id}/role`,
        headers: { cookie: admin },
        payload: { role },
      });

    // Promote two brothers so there are three admins: 5010, 5011, 5012.
    expect((await put(5011, "admin")).statusCode).toBe(200);
    expect((await put(5012, "admin")).statusCode).toBe(200);
    // Demote the two others in sequence — each is allowed (admins remain).
    expect((await put(5011, "brother")).statusCode).toBe(200);
    expect((await put(5012, "brother")).statusCode).toBe(200);
    // 5010 is now the only admin; demoting itself must be refused (org lockout).
    const selfDemote = await put(5010, "manager");
    expect(selfDemote.statusCode).toBe(409);
    expect(selfDemote.json()).toEqual({ error: "last_admin" });
    expect(ctx.cache.getById(5010)?.role).toBe("admin");
    expect(ctx.cache.adminCount()).toBe(1);
  });

  it("counts only USABLE admins — a deceased / emailless / de-brothered co-admin does not keep the last usable admin demotable [live bug: OFC-241]", async () => {
    // 5010 is the only admin who can actually sign in and administer. The other three
    // hold the `admin` role but can never exercise it — deceased (hidden from the
    // Directory too), no email (the Ghost bridge can't resolve them), de-brothered
    // (sign-in denied, D115). Counting them lets an admin demote themselves into a
    // zero-usable-admins lockout (the live failure Forrest hit).
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5010, role: "admin" }), // living, has email — the ONLY usable admin
      makeProfile({ id: 5020, role: "admin", deceased: { isDeceased: true } }),
      makeProfile({ id: 5021, role: "admin", email: undefined }),
      makeProfile({ id: 5022, role: "admin", debrothered: { isDebrothered: true } }),
    ]);
    expect(cache.adminCount()).toBe(1); // only 5010 is a usable admin

    const sessionStore = new InMemorySessionStore();
    const app = await buildServer({
      identityProvider: stubProvider,
      profileCache: cache,
      profileStore: new InMemoryProfileStore(),
      adminUsers: new InMemoryAdminUserStore(),
      bannerStore: new InMemoryBannerStore(),
      backupSource: new InMemoryBackupSource(),
      bugReportStore: new InMemoryBugReportStore(),
      imageStore: new InMemoryImageStore(),
      ghostLifecycle: new StubGhostLifecycle(),
      sessionStore,
      nonceStore: new InMemoryNonceStore(),
      getStars: async () => [],
      addStar: async () => [],
      removeStar: async () => [],
      auditLog: new AuditLog({ write: () => {} }),
      clock: () => FIXED_NOW,
      cookie: { secure: true },
    });
    const cookie = `${SESSION_COOKIE}=${await sessionStore.create(sessionFor(5010, "admin"))}`;
    const response = await app.inject({
      method: "PUT",
      url: "/api/profiles/5010/role",
      headers: { cookie },
      payload: { role: "manager" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "last_admin" });
    expect(cache.getById(5010)?.role).toBe("admin");
    await app.close();
  });

  it("422s an invalid role value", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5011/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "superuser" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("revokes the target's live sessions when the role changes, so a demoted manager loses power (OFC-147)", async () => {
    // 5013 is a manager with two live sessions; demote them to brother.
    const s1 = await ctx.sessionStore.create(sessionFor(5013, "manager"));
    const s2 = await ctx.sessionStore.create(sessionFor(5013, "manager"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5013/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "brother" },
    });
    expect(response.statusCode).toBe(200);
    expect(ctx.audited.at(-1)).toMatchObject({
      action: "role.change",
      targetId: 5013,
      fromRole: "manager",
      toRole: "brother",
      sessionsRevoked: 2,
    });
    // The stale-role sessions are gone — the next request re-auths at the new role.
    expect(await ctx.sessionStore.get(s1)).toBeNull();
    expect(await ctx.sessionStore.get(s2)).toBeNull();
  });

  it("revokes no sessions on a no-op role reassignment (same role) (OFC-147)", async () => {
    const s1 = await ctx.sessionStore.create(sessionFor(5013, "manager"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5013/role",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { role: "manager" }, // unchanged
    });
    expect(response.statusCode).toBe(200);
    expect(ctx.audited.at(-1)).toMatchObject({ action: "role.change", sessionsRevoked: 0 });
    // An unchanged role withdrew no trust, so the session stands, and the cache is untouched.
    expect((await ctx.sessionStore.get(s1))?.identity.profileId).toBe(5013);
    expect(ctx.cache.getById(5013)?.role).toBe("manager");
  });

  it("a transient revocation failure still completes the role change and audits it (sessionsRevoked: null) (OFC-146 review)", async () => {
    // A session store whose revocation throws — the role change has already
    // committed, so the request must NOT 500 or lose its audit entry; it degrades
    // to the D22 cap and records the failure as `sessionsRevoked: null`.
    class ThrowingRevokeStore extends InMemorySessionStore {
      override destroyAllForProfile(): Promise<number> {
        return Promise.reject(new Error("firestore unavailable"));
      }
    }
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5010, role: "admin" }),
      makeProfile({ id: 5011, role: "manager" }),
    ]);
    const sessionStore = new ThrowingRevokeStore();
    const audited: Record<string, unknown>[] = [];
    const app = await buildServer({
      identityProvider: stubProvider,
      profileCache: cache,
      profileStore: new InMemoryProfileStore(),
      adminUsers: new InMemoryAdminUserStore(),
      bannerStore: new InMemoryBannerStore(),
      backupSource: new InMemoryBackupSource(),
      bugReportStore: new InMemoryBugReportStore(),
      imageStore: new InMemoryImageStore(),
      ghostLifecycle: new StubGhostLifecycle(),
      sessionStore,
      nonceStore: new InMemoryNonceStore(),
      getStars: async () => [],
      addStar: async () => [],
      removeStar: async () => [],
      auditLog: new AuditLog({ write: (record) => audited.push(record) }),
      clock: () => FIXED_NOW,
      cookie: { secure: true },
    });
    const cookie = `${SESSION_COOKIE}=${await sessionStore.create(sessionFor(5010, "admin"))}`;
    const response = await app.inject({
      method: "PUT",
      url: "/api/profiles/5011/role",
      headers: { cookie },
      payload: { role: "brother" },
    });
    // The change succeeded despite revocation failing; the audit is preserved.
    expect(response.statusCode).toBe(200);
    expect(cache.getById(5011)?.role).toBe("brother");
    expect(audited.at(-1)).toMatchObject({
      action: "role.change",
      targetId: 5011,
      toRole: "brother",
      sessionsRevoked: null,
    });
    await app.close();
  });
});
