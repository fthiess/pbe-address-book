import type { Role } from "@pbe/shared";
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

/**
 * The export-audit ping (API-SPEC §4; D92). The client generates the CSV; this
 * endpoint only records that an export happened. The tests pin the staff gate,
 * the request validation, and — crucially — that the audit entry carries a
 * scope/count/actor but **no exported data** (the names-not-values boundary).
 */

const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the exports test")),
};

const FIXED_NOW = new Date("2026-06-28T12:00:00.000Z");

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

async function buildExportServer() {
  const cache = new ProfileCache();
  // Three records loaded, so the server-side accessible-row ceiling (OFC-117) is a
  // meaningful non-zero number the export audit can bound the reported count by.
  await cache.load([
    makeProfile({ id: 5001 }),
    makeProfile({ id: 5002 }),
    makeProfile({ id: 5003 }),
  ]);
  const sessionStore = new InMemorySessionStore();
  const audited: Record<string, unknown>[] = [];
  const app = await buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: new InMemoryProfileStore(),
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
  return { app, audited, cookieFor };
}

describe("POST /api/exports", () => {
  let ctx: Awaited<ReturnType<typeof buildExportServer>>;

  beforeEach(async () => {
    ctx = await buildExportServer();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it("rejects an unauthenticated ping with 401", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/exports",
      payload: { scope: "view", count: 10 },
    });
    expect(response.statusCode).toBe(401);
    expect(ctx.audited).toHaveLength(0);
  });

  it("rejects a brother with 403 — export is staff-only (D41)", async () => {
    const cookie = await ctx.cookieFor(5247, "brother");
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/exports",
      headers: { cookie },
      payload: { scope: "view", count: 10 },
    });
    expect(response.statusCode).toBe(403);
    expect(ctx.audited).toHaveLength(0);
  });

  it("records a manager export with scope, count, role, ceiling, actor and timestamp — and no data", async () => {
    const cookie = await ctx.cookieFor(5247, "manager");
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/exports",
      headers: { cookie },
      payload: { scope: "selection", count: 2 },
    });
    expect(response.statusCode).toBe(204);
    expect(ctx.audited).toHaveLength(1);
    expect(ctx.audited[0]).toMatchObject({
      logType: "audit",
      action: "export",
      actorId: 5247,
      outcome: "ok",
      scope: "selection",
      count: 2,
      // The caller's role and the server-derived accessible-row ceiling now ride
      // the audit so an under-report is visibly inconsistent (OFC-117).
      role: "manager",
      available: 3,
      timestamp: FIXED_NOW.toISOString(),
    });
    // A whole-directory export has no single target.
    expect(ctx.audited[0]).not.toHaveProperty("targetId");
  });

  it("clamps a tampered over-reported count to the accessible ceiling (OFC-117)", async () => {
    const cookie = await ctx.cookieFor(5247, "admin");
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/exports",
      headers: { cookie },
      // A tampered client claims far more rows than exist; the server bounds it.
      payload: { scope: "view", count: 999999 },
    });
    expect(response.statusCode).toBe(204);
    expect(ctx.audited[0]).toMatchObject({
      action: "export",
      role: "admin",
      count: 3,
      available: 3,
    });
  });

  it("rejects a bad scope or count with 400 and writes nothing", async () => {
    const cookie = await ctx.cookieFor(5247, "admin");
    const bad = await ctx.app.inject({
      method: "POST",
      url: "/api/exports",
      headers: { cookie },
      payload: { scope: "everything", count: -1 },
    });
    expect(bad.statusCode).toBe(400);
    expect(ctx.audited).toHaveLength(0);
  });
});
