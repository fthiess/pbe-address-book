import type { Role } from "@pbe/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { ProfileCache } from "../data/cache.js";
import type { GhostReader } from "../identity/ghost-reader.js";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import type { IdentityProvider, Session } from "../identity/types.js";
import { buildServer } from "../server.js";
import {
  InMemoryAdminUserStore,
  InMemoryBackupSource,
  InMemoryBannerStore,
  InMemoryBugReportStore,
  InMemoryGhostReader,
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
} from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";

/**
 * The two admin read-report routes (5b-2): `GET /api/admin/ghost-audit` and
 * `GET /api/admin/bounce-report`. The effective-role admin guard + denial audit,
 * the `503` when Ghost is unconfigured, the `502` on a Ghost read failure, and the
 * `ok` audit entry with the row/discrepancy count.
 */

const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used")),
};
const FIXED_NOW = new Date("2026-07-09T09:14:00.000Z");

function sessionFor(profileId: number, role: Role): Session {
  return {
    identity: {
      subject: String(profileId),
      profileId,
      email: "a@example.test",
      role,
      displayName: "T",
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

async function buildAuditServer(reader?: GhostReader) {
  const cache = new ProfileCache();
  await cache.load([makeProfile({ id: 5247, ghostMemberId: "g1" })]);
  const sessionStore = new InMemorySessionStore();
  const audited: Record<string, unknown>[] = [];
  const app = await buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: new InMemoryProfileStore(),
    adminUsers: new InMemoryAdminUserStore(),
    bannerStore: new InMemoryBannerStore(),
    backupSource: new InMemoryBackupSource(),
    bugReportStore: new InMemoryBugReportStore(),
    ghostReader: reader,
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
  const viewingAsCookie = async (from: Role, as: Role) => {
    const id = await sessionStore.create(sessionFor(5001, from));
    await sessionStore.setEffectiveRole(id, as);
    return `${SESSION_COOKIE}=${id}`;
  };
  return { app, audited, cookieFor, viewingAsCookie };
}

const ROUTES = ["/api/admin/ghost-audit", "/api/admin/bounce-report"] as const;

describe.each(ROUTES)("GET %s — access control", (url) => {
  let ctx: Awaited<ReturnType<typeof buildAuditServer>>;
  beforeEach(async () => {
    ctx = await buildAuditServer(new InMemoryGhostReader());
  });
  const get = (cookie?: string) =>
    ctx.app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });

  it("401s without a session", async () => {
    expect((await get()).statusCode).toBe(401);
  });

  it("403s a brother and a manager", async () => {
    for (const role of ["brother", "manager"] as const) {
      expect((await get(await ctx.cookieFor(5002, role))).statusCode).toBe(403);
    }
  });

  it("403s an admin viewing as a lower role (effective role, N31)", async () => {
    expect((await get(await ctx.viewingAsCookie("admin", "brother"))).statusCode).toBe(403);
  });

  it("audits the 403 denial with the actor and no target", async () => {
    await get(await ctx.cookieFor(5002, "manager"));
    const denied = ctx.audited.find((e) => e.outcome === "denied");
    expect(denied).toMatchObject({ actorId: 5002, outcome: "denied" });
    expect(denied).not.toHaveProperty("targetId");
  });

  it("503s when no Ghost reader is configured", async () => {
    const bare = await buildAuditServer(undefined);
    const res = await bare.app.inject({
      method: "GET",
      url,
      headers: { cookie: await bare.cookieFor(5001, "admin") },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "ghost_unconfigured" });
  });

  it("502s (not a generic 500) when a Ghost read fails", async () => {
    const failing = await buildAuditServer(new InMemoryGhostReader({}, true));
    const res = await failing.app.inject({
      method: "GET",
      url,
      headers: { cookie: await failing.cookieFor(5001, "admin") },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: "ghost_read_failed" });
  });
});

describe("GET /api/admin/ghost-audit — report", () => {
  it("returns the discrepancy report (no-store) and audits the count", async () => {
    const reader = new InMemoryGhostReader({
      // g1 matches profile 5247; g2 is an unmatched Ghost member → 1 discrepancy.
      members: [
        { id: "g1", email: "james.smyth@example.test", name: "James Smyth '84", subscribed: true },
        { id: "g2", email: "stranger@example.test", name: "S", subscribed: true },
      ],
    });
    const ctx = await buildAuditServer(reader);
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/ghost-audit",
      headers: { cookie: await ctx.cookieFor(5001, "admin") },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body.generatedAt).toBe(FIXED_NOW.toISOString());
    expect(body.discrepancies).toEqual([
      {
        category: "unmatchedGhostMember",
        ghostMemberId: "g2",
        ghostValue: "stranger@example.test",
      },
    ]);
    const entry = ctx.audited.find((e) => e.action === "ghost.audit" && e.outcome === "ok");
    expect(entry).toMatchObject({ action: "ghost.audit", actorId: 5001, outcome: "ok", count: 1 });
  });
});

describe("GET /api/admin/bounce-report — report", () => {
  it("returns aggregated bounce rows (no-store) and audits the count", async () => {
    const reader = new InMemoryGhostReader({
      members: [
        { id: "g1", email: "james.smyth@example.test", name: "James Smyth '84", subscribed: true },
      ],
      bounceEvents: [{ memberId: "g1", emailId: "e1", at: "2026-06-01T00:00:00.000Z" }],
      newsletterEmails: [{ emailId: "e1", title: "Summer Issue" }],
    });
    const ctx = await buildAuditServer(reader);
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/bounce-report",
      headers: { cookie: await ctx.cookieFor(5001, "admin") },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body.rows).toEqual([
      {
        email: "james.smyth@example.test",
        bounce_count: 1,
        last_bounce_at: "2026-06-01T00:00:00.000Z",
        last_bounce_newsletter: "Summer Issue",
      },
    ]);
    const entry = ctx.audited.find((e) => e.action === "bounce.report" && e.outcome === "ok");
    expect(entry).toMatchObject({
      action: "bounce.report",
      actorId: 5001,
      outcome: "ok",
      count: 1,
    });
  });
});
