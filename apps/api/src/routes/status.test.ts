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
    // 5003: already deceased and therefore Ghost-less (no ghostMemberId — the member
    // was deleted at mark-time, OFC-232), with an email so a reverse re-creates it.
    // Snapshot says subscribed, current flag forced off (D80).
    makeProfile({
      id: 5003,
      deceased: { isDeceased: true, deathYear: 2020 },
      allowNewsletterEmail: false,
      deceasedConsentSnapshot: { allowNewsletterEmail: true },
    }),
    // 5004: already de-brothered (reverse case).
    makeProfile({
      id: 5004,
      debrothered: { isDebrothered: true, debrotheredAt: "2026-02-02T00:00:00.000Z" },
      debrotherConsentSnapshot: { allowNewsletterEmail: true },
    }),
    // 5005: a living Book-only brother — no email, so no Ghost member (raise case).
    makeProfile({ id: 5005, email: undefined }),
    // 5007: deceased AND email-less — a reverse must reinstate it Book-only (no Ghost
    // re-create), even though it has a snapshot (OFC-232).
    makeProfile({
      id: 5007,
      email: undefined,
      deceased: { isDeceased: true, deathYear: 2019 },
      allowNewsletterEmail: false,
      deceasedConsentSnapshot: { allowNewsletterEmail: true },
    }),
    // 5006: a de-brothered Book-only brother — no email, no Ghost member (reverse case).
    makeProfile({
      id: 5006,
      email: undefined,
      debrothered: { isDebrothered: true, debrotheredAt: "2026-02-02T00:00:00.000Z" },
      debrotherConsentSnapshot: { allowNewsletterEmail: true },
    }),
    // 5010: the org's sole usable admin; 5011: a manager (last-admin guards, OFC-241).
    makeProfile({ id: 5010, role: "admin" }),
    makeProfile({ id: 5011, role: "manager" }),
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

  it("409s marking the sole usable admin deceased — even from a manager (last-admin, OFC-241)", async () => {
    // 5010 is the org's only usable admin; marking them deceased makes them unusable and
    // leaves zero. This route is manager-OR-admin tier, so a manager (5011) must be
    // blocked too — otherwise a non-admin could lock the org out.
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5010/deceased",
      headers: { cookie: await ctx.cookieFor(5011, "manager") },
      payload: { deceased: true },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "last_admin" });
    expect(ctx.cache.getById(5010)?.deceased.isDeceased).toBe(false);
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

  it("raises deceased: forces consent off, snapshots it, stamps consent-changed, drops the Ghost id", async () => {
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
    expect(stored.deceasedConsentSnapshot).toEqual({ allowNewsletterEmail: true });
    expect(stored.newsletterConsentChangedAt).toBe(FIXED_NOW.toISOString());
    // The Ghost member was deleted at mark-time (OFC-232), so its now-dangling id is
    // dropped — a deceased brother is Ghost-less.
    expect(stored.ghostMemberId).toBeUndefined();
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
    expect(stored.deceasedConsentSnapshot).toEqual({ allowNewsletterEmail: true });
  });

  it("reverses deceased: re-creates the Ghost member, restores consent, folds the fresh id", async () => {
    const ghost = new RecordingGhostLifecycle();
    const ctx = await buildStatusServer(ghost);
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
    expect(stored.deceasedConsentSnapshot).toBeUndefined();
    expect(stored.newsletterConsentChangedAt).toBe(FIXED_NOW.toISOString());
    // Ghost-first: the member is re-created and its FRESH id folded into the record.
    expect(ghost.created).toEqual([5003]);
    expect(stored.ghostMemberId).toBe("recreated-5003");
    // The desync guard: the member is re-created with the RESTORED consent (subscribed),
    // NOT the forced-off state the deceased record still held at re-create time.
    expect(ghost.createdProfiles[0]?.allowNewsletterEmail).toBe(true);
    await ctx.app.close();
  });

  it("surfaces a duplicate-email collision on deceased reverse as 422 on email, not a generic 502 (OFC-316)", async () => {
    // The reverse re-creates the Ghost member; when that email already exists in Ghost
    // under a member Book is not linked to (a Book↔Ghost drift), Ghost answers 422 and
    // createMember raises the typed GhostDuplicateEmailError. That must reach the client
    // as a 422 on `email` carrying the reconcile message — exactly as the PATCH email
    // path does (OFC-232/276) — not be flattened into a generic ghost_create_failed 502
    // that wrongly invites a retry. Book stays untouched (abort-clean, N65).
    const ctx = await buildStatusServer(new FailingGhostLifecycle("duplicate"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5003/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: false },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe("validation_failed");
    expect(body.issues?.[0]?.field).toBe("email");
    // Abort-clean: the deceased mark never cleared.
    expect(ctx.cache.getById(5003)?.deceased.isDeceased).toBe(true);
    await ctx.app.close();
  });

  it("deletes the Ghost member first on a raise, dropping the id (OFC-232)", async () => {
    const ghost = new RecordingGhostLifecycle();
    const ctx = await buildStatusServer(ghost);
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: true, deathYear: 2026 },
    });
    expect(response.statusCode).toBe(200);
    // The member is deleted (not merely unsubscribed) and no update is pushed.
    expect(ghost.deleted).toEqual([5002]);
    expect(ghost.updated).toHaveLength(0);
    expect(ctx.cache.getById(5002)?.ghostMemberId).toBeUndefined();
    await ctx.app.close();
  });

  it("fails the mark-deceased with 502 when the Ghost delete fails, leaving Book untouched (N65)", async () => {
    const ctx = await buildStatusServer(new FailingGhostLifecycle("delete"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: true, deathYear: 2026 },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: "ghost_delete_failed" });
    // Untouched: neither the deceased flag nor consent moved, and the id survives.
    const stored = ctx.cache.getById(5002) as Profile;
    expect(stored.deceased.isDeceased).toBe(false);
    expect(stored.allowNewsletterEmail).toBe(true);
    expect(stored.ghostMemberId).toBe("gm-5002");
    await ctx.app.close();
  });

  it("makes no Ghost call on a facts-only re-PUT of an already-deceased (Ghost-less) record", async () => {
    // 5003 is already deceased and Ghost-less → a re-PUT edits only the obituary link:
    // no member to delete, nothing to re-create.
    const ghost = new RecordingGhostLifecycle();
    const ctx = await buildStatusServer(ghost);
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5003/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: true, obituaryUrl: "https://example.test/obit" },
    });
    expect(response.statusCode).toBe(200);
    expect(ghost.deleted).toHaveLength(0);
    expect(ghost.created).toHaveLength(0);
    expect(ghost.updated).toHaveLength(0);
    await ctx.app.close();
  });

  it("raises deceased on an email-less Book-only brother with no Ghost call, even if Ghost would fail", async () => {
    // 5005 has no ghostMemberId; the delete must be skipped (a real deleteMember without
    // an id throws), mirroring the de-brother raise (OFC-201 follow-up).
    const ctx = await buildStatusServer(new FailingGhostLifecycle("delete"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5005/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: true, deathYear: 2026 },
    });
    expect(response.statusCode).toBe(200);
    expect(ctx.cache.getById(5005)?.deceased.isDeceased).toBe(true);
    await ctx.app.close();
  });

  it("reverses deceased on an email-less brother Book-only: no Ghost re-create", async () => {
    // 5007 is deceased with no email, so reinstating it must NOT mint a Ghost member.
    const ctx = await buildStatusServer(new FailingGhostLifecycle("create"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5007/deceased",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { deceased: false },
    });
    expect(response.statusCode).toBe(200);
    const stored = ctx.cache.getById(5007) as Profile;
    expect(stored.deceased.isDeceased).toBe(false);
    expect(stored.ghostMemberId).toBeUndefined();
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

  it("409s de-brothering the sole usable admin (last-admin, OFC-241)", async () => {
    const ctx = await buildStatusServer();
    // 5010 is the org's only usable admin; de-brothering them denies their sign-in
    // (D115) and leaves zero usable admins. (De-brother is admin-tier, so 5010 acts here.)
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5010/debrothered",
      headers: { cookie: await ctx.cookieFor(5010, "admin") },
      payload: { debrothered: true },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "last_admin" });
    expect(ctx.cache.getById(5010)?.debrothered.isDebrothered).toBe(false);
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
    expect(stored.debrotherConsentSnapshot).toEqual({ allowNewsletterEmail: true });
    // The now-dangling ghostMemberId is dropped (OFC-222): the Ghost member was just
    // deleted, so a later pushed-field PATCH must not push to a nonexistent member.
    expect(stored.ghostMemberId).toBeUndefined();
    expect(ctx.audited.at(-1)).toMatchObject({ action: "profile.debrother", targetId: 5002 });
    await ctx.app.close();
  });

  it("a pushed-field PATCH on a de-brothered record makes no Ghost call and saves (OFC-222)", async () => {
    const ghost = new RecordingGhostLifecycle();
    const ctx = await buildStatusServer(ghost);
    // Raise de-brother on 5002 (drops its ghostMemberId).
    await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5002/debrothered",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { debrothered: true },
    });
    // A staff PATCH of a pushed field (lastName) must not 502 on a deleted member.
    const etag = (
      await ctx.app.inject({
        method: "GET",
        url: "/api/profiles/5002",
        headers: { cookie: await ctx.cookieFor(9001, "admin") },
      })
    ).headers.etag as string;
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/profiles/5002",
      headers: { cookie: await ctx.cookieFor(9001, "admin"), "if-match": etag },
      payload: { lastName: "Renamed" },
    });
    expect(res.statusCode).toBe(200);
    expect(ghost.updated).toHaveLength(0); // no ghostMemberId → no push
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

  it("surfaces a duplicate-email collision on reinstate as 422 on email, not a generic 502 (OFC-316)", async () => {
    // Reinstate re-creates the Ghost member. When that email still exists in Ghost under
    // a member Book is not linked to (the Book↔Ghost drift that stranded reinstate on
    // staging), Ghost answers 422 and createMember raises GhostDuplicateEmailError. It
    // must surface as a 422 on `email` with the reconcile message — like the PATCH path
    // (OFC-232/276) — not be flattened into ghost_create_failed, which reads as a
    // transient outage and wrongly invites a retry. Book untouched: still de-brothered.
    const ctx = await buildStatusServer(new FailingGhostLifecycle("duplicate"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5004/debrothered",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { debrothered: false },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe("validation_failed");
    expect(body.issues?.[0]?.field).toBe("email");
    expect(ctx.cache.getById(5004)?.debrothered.isDebrothered).toBe(true);
    await ctx.app.close();
  });

  it("raises de-brother on a Book-only (Ghost-less) brother with no Ghost call, even if Ghost would fail", async () => {
    // 5005 has no ghostMemberId. The Ghost delete must be skipped — a real
    // deleteMember without an id throws, which would otherwise 502 every email-less
    // brother out of ever being de-brothered (OFC-201 follow-up).
    const ctx = await buildStatusServer(new FailingGhostLifecycle("delete"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5005/debrothered",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { debrothered: true },
    });
    expect(response.statusCode).toBe(200);
    expect(ctx.cache.getById(5005)?.debrothered.isDebrothered).toBe(true);
    await ctx.app.close();
  });

  it("reverses de-brother on an email-less brother Book-only: no Ghost re-create", async () => {
    // 5006 has no email, so reinstating it must NOT mint a Ghost member (mirroring
    // the create path); it stays Book-only with no ghostMemberId.
    const ctx = await buildStatusServer(new FailingGhostLifecycle("create"));
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/profiles/5006/debrothered",
      headers: { cookie: await ctx.cookieFor(9001, "admin") },
      payload: { debrothered: false },
    });
    expect(response.statusCode).toBe(200);
    const stored = ctx.cache.getById(5006) as Profile;
    expect(stored.debrothered.isDebrothered).toBe(false);
    expect(stored.ghostMemberId).toBeUndefined();
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
