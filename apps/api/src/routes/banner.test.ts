import type { Role } from "@pbe/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { InMemoryBannerStore } from "../data/banner.js";
import { ProfileCache } from "../data/cache.js";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import type { IdentityProvider, Session } from "../identity/types.js";
import { buildServer } from "../server.js";
import {
  InMemoryAdminUserStore,
  InMemoryBackupSource,
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
} from "../test-support/fakes.js";

/**
 * The system-message banner endpoints (D117; API-SPEC §10): the public read
 * (`GET /api/banner`, any authenticated user) and the admin set/clear
 * (`PUT /api/admin/banner`). Driven end-to-end against the in-memory doubles — the
 * gate, the effective-role admin guard (N31), the validation, and the names-not-
 * values audit (D61 — a set/clear scope, never the message text).
 */

const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the banner test")),
};

const FIXED_NOW = new Date("2026-07-05T12:00:00.000Z");

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

async function buildBannerServer() {
  const cache = new ProfileCache();
  await cache.load([]);
  const bannerStore = new InMemoryBannerStore();
  const sessionStore = new InMemorySessionStore();
  const audited: Record<string, unknown>[] = [];
  const app = await buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: new InMemoryProfileStore(),
    adminUsers: new InMemoryAdminUserStore(),
    bannerStore,
    backupSource: new InMemoryBackupSource(),
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
  /** A cookie whose session is an admin currently "viewing as" a lower role (N31). */
  const viewingAsCookie = async (from: Role, as: Role) => {
    const id = await sessionStore.create(sessionFor(5001, from));
    await sessionStore.setEffectiveRole(id, as);
    return `${SESSION_COOKIE}=${id}`;
  };
  return { app, bannerStore, audited, cookieFor, viewingAsCookie };
}

type Ctx = Awaited<ReturnType<typeof buildBannerServer>>;

describe("GET /api/banner", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildBannerServer();
  });

  it("401s without a session (any authenticated user, but not the public)", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/banner" });
    expect(response.statusCode).toBe(401);
  });

  it("returns { active: false } when no banner is set", async () => {
    const cookie = await ctx.cookieFor(5002, "brother");
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/banner",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ active: false });
    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  it("returns the active banner's message + severity to any authenticated brother", async () => {
    ctx.bannerStore.set({
      active: true,
      message: "Scheduled maintenance Sunday 2–4am ET.",
      severity: "warning",
      updatedBy: 5001,
      updatedAt: FIXED_NOW.toISOString(),
    });
    const cookie = await ctx.cookieFor(5002, "brother");
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/banner",
      headers: { cookie },
    });
    expect(response.json()).toEqual({
      active: true,
      message: "Scheduled maintenance Sunday 2–4am ET.",
      severity: "warning",
    });
    // No internal fields leak to the read (updatedBy/updatedAt stay server-side).
    expect(response.json()).not.toHaveProperty("updatedBy");
  });

  it("reports a cleared banner as { active: false } (no lingering message)", async () => {
    ctx.bannerStore.set({
      active: false,
      message: "",
      severity: "info",
      updatedBy: 5001,
      updatedAt: FIXED_NOW.toISOString(),
    });
    const cookie = await ctx.cookieFor(5002, "brother");
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/banner",
      headers: { cookie },
    });
    expect(response.json()).toEqual({ active: false });
  });
});

describe("PUT /api/admin/banner", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildBannerServer();
  });

  const put = (cookie: string, body: Record<string, unknown>) =>
    ctx.app.inject({ method: "PUT", url: "/api/admin/banner", headers: { cookie }, payload: body });

  it("401s without a session", async () => {
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/api/admin/banner",
      payload: { active: false },
    });
    expect(response.statusCode).toBe(401);
  });

  it("403s a brother and a manager (admin only)", async () => {
    for (const role of ["brother", "manager"] as const) {
      const response = await put(await ctx.cookieFor(5002, role), { active: false });
      expect(response.statusCode).toBe(403);
    }
  });

  it("403s an admin who is viewing as a lower role (effective role, N31)", async () => {
    const cookie = await ctx.viewingAsCookie("admin", "brother");
    const response = await put(cookie, { active: true, message: "Hi", severity: "info" });
    expect(response.statusCode).toBe(403);
  });

  it("audits a 403 denial with no target (whole-database admin surface, OFC-190)", async () => {
    const response = await put(await ctx.cookieFor(5002, "manager"), { active: false });
    expect(response.statusCode).toBe(403);
    const denied = ctx.audited.find((e) => e.action === "banner.set" && e.outcome === "denied");
    expect(denied).toMatchObject({ action: "banner.set", actorId: 5002, outcome: "denied" });
    expect(denied).not.toHaveProperty("targetId");
  });

  it("sets a banner for an admin and the read reflects it", async () => {
    const cookie = await ctx.cookieFor(5001, "admin");
    const response = await put(cookie, {
      active: true,
      message: "  Welcome to the new directory.  ",
      severity: "info",
    });
    expect(response.statusCode).toBe(200);
    // The response is the PUBLIC projection only — trimmed message + severity, and
    // NO internal `updatedBy`/`updatedAt` (OFC-189), symmetric with GET /api/banner.
    expect(response.json()).toEqual({
      active: true,
      message: "Welcome to the new directory.",
      severity: "info",
    });
    expect(response.json()).not.toHaveProperty("updatedBy");
    expect(response.json()).not.toHaveProperty("updatedAt");
    const read = await ctx.app.inject({ method: "GET", url: "/api/banner", headers: { cookie } });
    expect(read.json()).toEqual({
      active: true,
      message: "Welcome to the new directory.",
      severity: "info",
    });
  });

  it("clears the banner (active:false) and the read goes empty", async () => {
    const cookie = await ctx.cookieFor(5001, "admin");
    await put(cookie, { active: true, message: "temp", severity: "warning" });
    const response = await put(cookie, { active: false });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ active: false, message: "" });
    const read = await ctx.app.inject({ method: "GET", url: "/api/banner", headers: { cookie } });
    expect(read.json()).toEqual({ active: false });
  });

  it("defaults severity to info when omitted on a set", async () => {
    const cookie = await ctx.cookieFor(5001, "admin");
    const response = await put(cookie, { active: true, message: "No severity given" });
    expect(response.json()).toMatchObject({ severity: "info" });
  });

  it("422s a non-boolean active, an empty message, an over-long message, and a bad severity", async () => {
    const cookie = await ctx.cookieFor(5001, "admin");
    expect((await put(cookie, { message: "x" })).statusCode).toBe(422); // active missing
    expect((await put(cookie, { active: true, message: "   " })).statusCode).toBe(422); // empty
    expect((await put(cookie, { active: true, message: "x".repeat(501) })).statusCode).toBe(422); // too long
    expect(
      (await put(cookie, { active: true, message: "ok", severity: "danger" })).statusCode,
    ).toBe(422); // bad severity
  });

  it("audits a set and a clear by scope, never the message text (D61)", async () => {
    const cookie = await ctx.cookieFor(5001, "admin");
    await put(cookie, { active: true, message: "SECRET maintenance note", severity: "warning" });
    await put(cookie, { active: false });
    const bannerEntries = ctx.audited.filter((e) => e.action === "banner.set");
    expect(bannerEntries).toHaveLength(2);
    expect(bannerEntries[0]).toMatchObject({ action: "banner.set", actorId: 5001, scope: "set" });
    expect(bannerEntries[1]).toMatchObject({ scope: "clear" });
    // The message text is never written into the audit stream (names-not-values).
    expect(JSON.stringify(ctx.audited)).not.toContain("SECRET");
  });
});
