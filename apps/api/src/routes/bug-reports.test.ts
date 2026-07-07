import { MAX_BUG_REPORT_DESCRIPTION, type Role } from "@pbe/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { ProfileCache } from "../data/cache.js";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import type { IdentityProvider, Session } from "../identity/types.js";
import { buildServer } from "../server.js";
import {
  InMemoryAdminUserStore,
  InMemoryBackupSource,
  InMemoryBannerStore,
  InMemoryBugReportStore,
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
} from "../test-support/fakes.js";
import { makeProfile } from "../test-support/make-profile.js";

/**
 * The bug-report endpoints (D121; API-SPEC §10). Driven end-to-end against the
 * in-memory doubles: the file POST (any authenticated user, validation, the
 * names-not-values audit), and the admin review queue (list with server-resolved
 * submitter names, the new→reviewed unread marker, and delete — each admin-only at
 * the effective role, with a denial audit on a probe).
 */

const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the bug-report test")),
};

const FIXED_NOW = new Date("2026-07-07T09:30:00.000Z");

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

async function buildBugReportServer() {
  const cache = new ProfileCache();
  // Two roster records so the admin queue can resolve a submitter's canonical name.
  await cache.load([
    makeProfile({ id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 }),
    makeProfile({ id: 5002, firstName: "Karen", lastName: "Nelson", classYear: 2005 }),
  ]);
  const bugReportStore = new InMemoryBugReportStore();
  const sessionStore = new InMemorySessionStore();
  const audited: Record<string, unknown>[] = [];
  const app = await buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: new InMemoryProfileStore(),
    adminUsers: new InMemoryAdminUserStore(),
    bannerStore: new InMemoryBannerStore(),
    backupSource: new InMemoryBackupSource(),
    bugReportStore,
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
  return { app, bugReportStore, audited, cookieFor, viewingAsCookie };
}

type Ctx = Awaited<ReturnType<typeof buildBugReportServer>>;

describe("POST /api/bug-report", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildBugReportServer();
  });

  const file = (cookie: string, body: Record<string, unknown>) =>
    ctx.app.inject({ method: "POST", url: "/api/bug-report", headers: { cookie }, payload: body });

  it("401s without a session", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/bug-report",
      payload: { description: "x" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("files a report for any authenticated brother, at status new", async () => {
    const cookie = await ctx.cookieFor(5247, "brother");
    const response = await file(cookie, {
      page: "/",
      url: "https://book.example.test/",
      description: "  The star column didn't update on my iPad.  ",
      clientContext: { userAgent: "UA", viewport: "390x844", appVersion: "abc" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: "new" });
    expect(response.json().id).toBeTruthy();
    const stored = await ctx.bugReportStore.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      submittedBy: 5247,
      submittedAt: FIXED_NOW.toISOString(),
      page: "/",
      url: "https://book.example.test/",
      description: "The star column didn't update on my iPad.", // trimmed
      status: "new",
      clientContext: { userAgent: "UA", viewport: "390x844", appVersion: "abc" },
    });
  });

  it("422s an empty/whitespace or oversized description", async () => {
    const cookie = await ctx.cookieFor(5247, "brother");
    expect((await file(cookie, { description: "   " })).statusCode).toBe(422);
    expect((await file(cookie, {})).statusCode).toBe(422);
    expect(
      (await file(cookie, { description: "x".repeat(MAX_BUG_REPORT_DESCRIPTION + 1) })).statusCode,
    ).toBe(422);
  });

  it("audits the filing by scope, never the description text (D61)", async () => {
    const cookie = await ctx.cookieFor(5247, "brother");
    await file(cookie, { description: "SECRET reproduction steps" });
    const entry = ctx.audited.find((e) => e.action === "bug.report" && e.outcome === "ok");
    expect(entry).toMatchObject({ action: "bug.report", actorId: 5247, scope: "file" });
    expect(JSON.stringify(ctx.audited)).not.toContain("SECRET");
  });

  it("omits absent optional fields rather than storing empties", async () => {
    const cookie = await ctx.cookieFor(5247, "brother");
    await file(cookie, { description: "Just the text." });
    const [stored] = await ctx.bugReportStore.list();
    expect(stored).toMatchObject({ page: "", description: "Just the text.", status: "new" });
    expect(stored).not.toHaveProperty("url");
    expect(stored).not.toHaveProperty("clientContext");
  });
});

describe("GET /api/admin/bug-reports", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildBugReportServer();
  });

  async function seedTwo() {
    await ctx.bugReportStore.create({
      submittedBy: 5247,
      submittedAt: "2026-06-12T14:02:00.000Z",
      page: "/",
      description: "First",
      status: "new",
    });
    await ctx.bugReportStore.create({
      submittedBy: 5002,
      submittedAt: "2026-06-13T10:00:00.000Z",
      page: "/brother/5002",
      description: "Second",
      status: "new",
    });
  }

  it("403s a brother/manager and audits the denial (OFC-190)", async () => {
    for (const role of ["brother", "manager"] as const) {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/bug-reports",
        headers: { cookie: await ctx.cookieFor(5002, role) },
      });
      expect(response.statusCode).toBe(403);
    }
    const denied = ctx.audited.find((e) => e.action === "bug.report" && e.outcome === "denied");
    expect(denied).toMatchObject({ action: "bug.report", outcome: "denied" });
    expect(denied).not.toHaveProperty("targetId");
  });

  it("403s an admin viewing as a lower role (effective role, N31)", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/bug-reports",
      headers: { cookie: await ctx.viewingAsCookie("admin", "brother") },
    });
    expect(response.statusCode).toBe(403);
  });

  it("returns reports newest-first, enriched with the submitter's canonical name, no-store", async () => {
    await seedTwo();
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/bug-reports",
      headers: { cookie: await ctx.cookieFor(5001, "admin") },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const { reports } = response.json();
    expect(reports.map((r: { description: string }) => r.description)).toEqual(["Second", "First"]);
    expect(reports[1]).toMatchObject({
      submitterId: 5247,
      submitterName: "James Smyth '84",
      description: "First",
      status: "new",
    });
    // The raw `submittedBy` is surfaced as `submitterId`, not both.
    expect(reports[1]).not.toHaveProperty("submittedBy");
  });

  it("falls back to the raw id for a submitter whose profile no longer exists", async () => {
    await ctx.bugReportStore.create({
      submittedBy: 9999,
      submittedAt: "2026-06-12T14:02:00.000Z",
      page: "/",
      description: "Ghost submitter",
      status: "new",
    });
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/bug-reports",
      headers: { cookie: await ctx.cookieFor(5001, "admin") },
    });
    expect(response.json().reports[0].submitterName).toBe("#9999");
  });
});

describe("POST /api/admin/bug-reports/mark-reviewed", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildBugReportServer();
  });

  it("flips only the named new reports to reviewed and returns the count", async () => {
    const a = await ctx.bugReportStore.create({
      submittedBy: 5247,
      submittedAt: "2026-06-12T14:02:00.000Z",
      page: "/",
      description: "A",
      status: "new",
    });
    await ctx.bugReportStore.create({
      submittedBy: 5247,
      submittedAt: "2026-06-12T14:03:00.000Z",
      page: "/",
      description: "B",
      status: "new",
    });
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/bug-reports/mark-reviewed",
      headers: { cookie: await ctx.cookieFor(5001, "admin") },
      payload: { ids: [a.id, "does-not-exist"] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reviewed: 1 });
    const stored = await ctx.bugReportStore.list();
    expect(stored.find((r) => r.id === a.id)?.status).toBe("reviewed");
    expect(stored.find((r) => r.description === "B")?.status).toBe("new");
  });

  it("422s a non-array ids and 403s a non-admin", async () => {
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/admin/bug-reports/mark-reviewed",
          headers: { cookie: await ctx.cookieFor(5001, "admin") },
          payload: { ids: "nope" },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/admin/bug-reports/mark-reviewed",
          headers: { cookie: await ctx.cookieFor(5002, "brother") },
          payload: { ids: [] },
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe("DELETE /api/admin/bug-reports/:id", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildBugReportServer();
  });

  it("deletes a report for an admin and audits it (scope delete, no PII)", async () => {
    const created = await ctx.bugReportStore.create({
      submittedBy: 5247,
      submittedAt: "2026-06-12T14:02:00.000Z",
      page: "/",
      description: "SECRET note",
      status: "new",
    });
    const response = await ctx.app.inject({
      method: "DELETE",
      url: `/api/admin/bug-reports/${created.id}`,
      headers: { cookie: await ctx.cookieFor(5001, "admin") },
    });
    expect(response.statusCode).toBe(204);
    expect(await ctx.bugReportStore.list()).toHaveLength(0);
    const entry = ctx.audited.find(
      (e) => e.action === "bug.report" && e.outcome === "ok" && e.scope === "delete",
    );
    expect(entry).toMatchObject({ action: "bug.report", actorId: 5001, scope: "delete" });
    expect(JSON.stringify(ctx.audited)).not.toContain("SECRET");
  });

  it("is idempotent (deleting an absent id still 204s) and 403s a non-admin", async () => {
    expect(
      (
        await ctx.app.inject({
          method: "DELETE",
          url: "/api/admin/bug-reports/nope",
          headers: { cookie: await ctx.cookieFor(5001, "admin") },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await ctx.app.inject({
          method: "DELETE",
          url: "/api/admin/bug-reports/whatever",
          headers: { cookie: await ctx.cookieFor(5002, "manager") },
        })
      ).statusCode,
    ).toBe(403);
  });
});
