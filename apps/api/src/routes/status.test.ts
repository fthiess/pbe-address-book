import type { Profile, Role } from "@pbe/shared";
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
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
  RecordingGhostLifecycle,
} from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";

/**
 * The 4c-2 status actions (API-SPEC §3; DECISIONS N40/N41): `POST …/verify`,
 * `PUT …/deceased`, `PUT …/debrothered`. Driven end-to-end against the in-memory
 * doubles — the role-tier guard, the D80 consent snapshot/force-off/restore, the
 * verification freeze on deceased, and the Ghost-first abort-clean contract.
 */

const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the status test")),
};

const FIXED_NOW = new Date("2026-07-03T12:00:00.000Z");
const TODAY = "2026-07-03";

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

async function buildStatusServer(ghostLifecycle = new StubGhostLifecycle()) {
  const cache = new ProfileCache();
  await cache.load([
    // 5001: living, verified brother/owner.
    makeProfile({ id: 5001, lastVerifiedDate: "2026-01-01", verifiedBy: 5001 }),
    // 5002: a second living brother, linked to a Ghost member (consent-push cases).
    makeProfile({ id: 5002, ghostMemberId: "gm-5002" }),
    // 5003: already deceased (verify-freeze + re-PUT-edit cases).
    makeProfile({
      id: 5003,
      ghostMemberId: "gm-5003",
      deceased: { isDeceased: true, deathYear: 2020 },
      allowNewsletterEmail: false,
      allowCommentReplyEmail: false,
      deceasedConsentSnapshot: { allowNewsletterEmail: true, allowCommentReplyEmail: true },
    }),
    // 5004: already de-brothered (reverse case).
    makeProfile({
      id: 5004,
      debrothered: { isDebrothered: true, debrotheredAt: "2026-02-02T00:00:00.000Z" },
      debrotherConsentSnapshot: { allowNewsletterEmail: true, allowCommentReplyEmail: true },
    }),
  ]);
  const sessionStore = new InMemorySessionStore();
  const store = new InMemoryProfileStore();
  const audited: Record<string, unknown>[] = [];
  const app = await buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: store,
    adminUsers: new InMemoryAdminUserStore(),
    bannerStore: new InMemoryBannerStore(),
    backupSource: new InMemoryBackupSource(),
    bugReportStore: new InMemoryBugReportStore(),
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
  return { app, cache, audited, sessionStore, cookieFor };
}

type Ctx = Awaited<ReturnType<typeof buildStatusServer>>;

describe("POST /api/profiles/:id/verify", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildStatusServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("401s an unauthenticated caller", async () => {
    const response = await ctx.app.inject({ method: "POST", url: "/api/profiles/5001/verify" });
    expect(response.statusCode).toBe(401);
  });

  it("lets the owner verify their own record, stamping date + verifier", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/profiles/5001/verify",
      headers: { cookie: await ctx.cookieFor(5001, "brother") },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ lastVerifiedDate: TODAY, verifiedBy: 5001 });
    expect(response.headers.etag).toBeDefined();
    expect(ctx.cache.getById(5001)?.lastVerifiedDate).toBe(TODAY);
    expect(ctx.audited.at(-1)).toMatchObject({
      action: "profile.verify",
      actorId: 5001,
      targetId: 5001,
      outcome: "ok",
    });
  });

  it("records the manager as the verifier when they verify another brother", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/profiles/5001/verify",
      headers: { cookie: await ctx.cookieFor(9001, "manager") },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ lastVerifiedDate: TODAY, verifiedBy: 9001 });
  });

  it("403s (audited) a brother verifying someone else's record — the IDOR guard", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/profiles/5002/verify",
      headers: { cookie: await ctx.cookieFor(5001, "brother") },
    });
    expect(response.statusCode).toBe(403);
    expect(ctx.audited.at(-1)).toMatchObject({
      action: "profile.verify",
      actorId: 5001,
      targetId: 5002,
      outcome: "denied",
    });
  });

  it("404s an unknown brother", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/profiles/9999/verify",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
    });
    expect(response.statusCode).toBe(404);
  });

  it("is a no-op on a deceased record (verification is frozen, D48)", async () => {
    const before = ctx.audited.length;
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/profiles/5003/verify",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
    });
    expect(response.statusCode).toBe(200);
    // No verification was stamped, and no audit entry was written.
    expect(ctx.cache.getById(5003)?.lastVerifiedDate).toBeUndefined();
    expect(ctx.audited.length).toBe(before);
  });
});

describe("PUT /api/profiles/:id/deceased", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildStatusServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("403s a brother (staff-only action)", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/deceased",
      headers: { cookie: await ctx.cookieFor(5002, "brother") },
      payload: { deceased: true },
    });
    expect(response.statusCode).toBe(403);
  });

  it("raises deceased: forces consent off, snapshots it, stamps consent-changed", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "manager") },
      payload: { deceased: true, deathYear: 2026, birthYear: 1962 },
    });
    expect(response.statusCode).toBe(200);
    const stored = ctx.cache.getById(5002) as Profile;
    expect(stored.deceased).toEqual({ isDeceased: true, deathYear: 2026, birthYear: 1962 });
    expect(stored.allowNewsletterEmail).toBe(false);
    expect(stored.allowCommentReplyEmail).toBe(false);
    expect(stored.deceasedConsentSnapshot).toEqual({
      allowNewsletterEmail: true,
      allowCommentReplyEmail: true,
    });
    expect(stored.newsletterConsentChangedAt).toBe(FIXED_NOW.toISOString());
    expect(ctx.audited.at(-1)).toMatchObject({ action: "profile.deceased", targetId: 5002 });
  });

  it("422s an invalid deceased payload (both a full date and a year)", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: true, dateOfDeath: "2026-01-15", deathYear: 2026 },
    });
    expect(response.statusCode).toBe(422);
  });

  it("edits an already-deceased record without re-snapshotting or re-forcing", async () => {
    // 5003 is deceased with consent already off and a snapshot from the first raise.
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5003/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: true, obituaryUrl: "https://example.test/obit" },
    });
    expect(response.statusCode).toBe(200);
    const stored = ctx.cache.getById(5003) as Profile;
    expect(stored.deceased.obituaryUrl).toBe("https://example.test/obit");
    // The original snapshot is untouched (not re-captured from the forced-off state).
    expect(stored.deceasedConsentSnapshot).toEqual({
      allowNewsletterEmail: true,
      allowCommentReplyEmail: true,
    });
  });

  it("reverses deceased: restores the snapshotted consent and clears the block", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5003/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: false },
    });
    expect(response.statusCode).toBe(200);
    const stored = ctx.cache.getById(5003) as Profile;
    expect(stored.deceased).toEqual({ isDeceased: false });
    expect(stored.allowNewsletterEmail).toBe(true);
    expect(stored.allowCommentReplyEmail).toBe(true);
    expect(stored.deceasedConsentSnapshot).toBeUndefined();
    expect(stored.newsletterConsentChangedAt).toBe(FIXED_NOW.toISOString());
  });

  it("pushes the forced unsubscribes to Ghost first on a raise (N65)", async () => {
    const ghost = new RecordingGhostLifecycle();
    const ctx = await buildStatusServer(ghost);
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: true, deathYear: 2026 },
    });
    expect(response.statusCode).toBe(200);
    // Only the two consent flags are pushed (never email/name), by their new value.
    expect(ghost.updated).toEqual([
      {
        id: 5002,
        ghostMemberId: "gm-5002",
        diff: { allowNewsletterEmail: false, allowCommentReplyEmail: false },
      },
    ]);
    expect(ctx.cache.getById(5002)?.allowNewsletterEmail).toBe(false);
    await ctx.app.close();
  });

  it("fails the mark-deceased with 502 when Ghost rejects, leaving Book untouched (N65)", async () => {
    const ctx = await buildStatusServer(new FailingGhostLifecycle("update"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: true, deathYear: 2026 },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: "ghost_update_failed" });
    // Untouched: neither the deceased flag nor consent moved.
    const stored = ctx.cache.getById(5002) as Profile;
    expect(stored.deceased.isDeceased).toBe(false);
    expect(stored.allowNewsletterEmail).toBe(true);
    await ctx.app.close();
  });

  it("makes no Ghost call on a facts-only re-PUT that changes no consent flag (N65)", async () => {
    // 5003 is already deceased with consent already off → a re-PUT edits only the
    // obituary link, so there is no consent change to push.
    const ghost = new RecordingGhostLifecycle();
    const ctx = await buildStatusServer(ghost);
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5003/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: true, obituaryUrl: "https://example.test/obit" },
    });
    expect(response.statusCode).toBe(200);
    expect(ghost.updated).toHaveLength(0);
    await ctx.app.close();
  });
});

describe("PUT /api/profiles/:id/debrothered", () => {
  it("403s a manager (admin-only action)", async () => {
    const ctx = await buildStatusServer();
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/debrothered",
      headers: { cookie: await ctx.cookieFor(9001, "manager") },
      payload: { debrothered: true },
    });
    expect(response.statusCode).toBe(403);
    await ctx.app.close();
  });

  it("raises de-brother Ghost-first: deletes the member, snapshots, sets the flag", async () => {
    const ghost = new RecordingGhostLifecycle();
    const ctx = await buildStatusServer(ghost);
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/debrothered",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { debrothered: true },
    });
    expect(response.statusCode).toBe(200);
    expect(ghost.deleted).toEqual([5002]);
    const stored = ctx.cache.getById(5002) as Profile;
    expect(stored.debrothered.isDebrothered).toBe(true);
    expect(stored.debrothered.debrotheredAt).toBe(FIXED_NOW.toISOString());
    expect(stored.debrotherConsentSnapshot).toEqual({
      allowNewsletterEmail: true,
      allowCommentReplyEmail: true,
    });
    expect(ctx.audited.at(-1)).toMatchObject({ action: "profile.debrother", targetId: 5002 });
    await ctx.app.close();
  });

  it("aborts clean with 502 when the Ghost delete fails (nothing mutated)", async () => {
    const ctx = await buildStatusServer(new FailingGhostLifecycle("delete"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/debrothered",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { debrothered: true },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "ghost_delete_failed" });
    // Book is untouched: the flag never flipped.
    expect(ctx.cache.getById(5002)?.debrothered.isDebrothered).toBe(false);
    await ctx.app.close();
  });

  it("reverses de-brother Ghost-first: re-creates the member and restores the snapshot", async () => {
    const ghost = new RecordingGhostLifecycle();
    const ctx = await buildStatusServer(ghost);
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5004/debrothered",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { debrothered: false },
    });
    expect(response.statusCode).toBe(200);
    expect(ghost.created).toEqual([5004]);
    const stored = ctx.cache.getById(5004) as Profile;
    expect(stored.debrothered.isDebrothered).toBe(false);
    expect(stored.debrotherConsentSnapshot).toBeUndefined();
    // The re-created member's FRESH id is folded into the reinstating write (N65/N67).
    expect(stored.ghostMemberId).toBe("recreated-5004");
    await ctx.app.close();
  });

  it("aborts clean with 502 when the Ghost re-create fails on reverse", async () => {
    const ctx = await buildStatusServer(new FailingGhostLifecycle("create"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5004/debrothered",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { debrothered: false },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "ghost_create_failed" });
    expect(ctx.cache.getById(5004)?.debrothered.isDebrothered).toBe(true);
    await ctx.app.close();
  });

  it("revokes the de-brothered brother's live sessions on raise, auditing the count (OFC-147)", async () => {
    const ctx = await buildStatusServer(new RecordingGhostLifecycle());
    // Two live sessions for the target (e.g. two devices) plus a bystander's.
    const targetId = await ctx.sessionStore.create(sessionFor(5002, "brother"));
    await ctx.sessionStore.create(sessionFor(5002, "brother"));
    const bystanderId = await ctx.sessionStore.create(sessionFor(5001, "brother"));

    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/debrothered",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { debrothered: true },
    });
    expect(response.statusCode).toBe(200);
    expect(ctx.audited.at(-1)).toMatchObject({
      action: "profile.debrother",
      targetId: 5002,
      sessionsRevoked: 2,
    });
    // The target's sessions are gone; the bystander's survives.
    expect(await ctx.sessionStore.get(targetId)).toBeNull();
    expect((await ctx.sessionStore.get(bystanderId))?.identity.profileId).toBe(5001);
    await ctx.app.close();
  });

  it("does not revoke sessions on a de-brother reverse (access is being restored) (OFC-147)", async () => {
    const ctx = await buildStatusServer(new RecordingGhostLifecycle());
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5004/debrothered",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { debrothered: false },
    });
    expect(response.statusCode).toBe(200);
    // No `sessionsRevoked` key on a reverse — it is omitted, not zero.
    expect(ctx.audited.at(-1)).not.toHaveProperty("sessionsRevoked");
    await ctx.app.close();
  });
});
