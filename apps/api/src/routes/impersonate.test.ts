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
 * "View as" role impersonation (DECISIONS N31). The contract under test is that
 * impersonation is **server-side**: an *effective* role is stored on the session
 * and every role-authorization site reads it, so the lower projection is genuinely
 * downloaded and the lower powers genuinely enforced — a client-only flag would
 * leave the admin holding the full dataset. The start/stop gate keys on the
 * **real** role so a caller can never escalate or lock themselves out, and both
 * transitions are audited.
 */

const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the impersonate test")),
};

const FIXED_NOW = new Date("2026-06-30T12:00:00.000Z");

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

async function buildImpersonateServer() {
  const cache = new ProfileCache();
  await cache.load([
    makeProfile({ id: 5001, email: "actor@example.test" }),
    // An unlisted record: visible in the manager/admin bulk read, hidden from the
    // brother bulk read — the crisp proof that the *effective* role selects the
    // projection actually downloaded (D124).
    makeProfile({ id: 5099, email: "hidden@example.test", unlisted: true }),
  ]);
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
    auditLog: new AuditLog({ write: (record) => audited.push(record) }),
    clock: () => FIXED_NOW,
    cookie: { secure: true },
  });
  // Identity is always profile 5001 (present in the cache); only the role varies.
  const cookieFor = async (role: Role) =>
    `${SESSION_COOKIE}=${await sessionStore.create(sessionFor(5001, role))}`;
  const me = async (cookie: string) =>
    (await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).json();
  const start = (cookie: string, role: string) =>
    app.inject({
      method: "POST",
      url: "/api/me/impersonate",
      headers: { cookie },
      payload: { role },
    });
  const stop = (cookie: string) =>
    app.inject({ method: "DELETE", url: "/api/me/impersonate", headers: { cookie } });
  const bulkIds = async (cookie: string): Promise<number[]> => {
    const res = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { cookie, "accept-encoding": "identity" },
    });
    return (res.json().profiles as { id: number }[]).map((p) => p.id);
  };
  return { app, audited, cookieFor, me, start, stop, bulkIds };
}

describe("View as impersonation (N31)", () => {
  let ctx: Awaited<ReturnType<typeof buildImpersonateServer>>;

  beforeEach(async () => {
    ctx = await buildImpersonateServer();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it("/api/me reports the effective role plus the un-spoofable real role", async () => {
    const cookie = await ctx.cookieFor("admin");
    expect(await ctx.me(cookie)).toMatchObject({
      role: "admin",
      realRole: "admin",
      impersonating: false,
    });

    expect((await ctx.start(cookie, "brother")).statusCode).toBe(204);

    expect(await ctx.me(cookie)).toMatchObject({
      role: "brother", // the effective projection the SPA gates its UI on
      realRole: "admin", // the immutable real role the masthead controls key on
      impersonating: true,
    });
  });

  it("makes the *effective* role select the bulk projection actually downloaded", async () => {
    const cookie = await ctx.cookieFor("admin");
    // As a real admin, the unlisted record is in the payload (badged in the UI).
    expect(await ctx.bulkIds(cookie)).toContain(5099);

    await ctx.start(cookie, "brother");
    // Viewing as a brother, it is genuinely gone from the downloaded bytes —
    // not merely hidden behind a client flag.
    expect(await ctx.bulkIds(cookie)).not.toContain(5099);
  });

  it("enforces the lower role's powers: a 'View as brother' admin cannot export", async () => {
    const cookie = await ctx.cookieFor("admin");
    const asAdmin = await ctx.app.inject({
      method: "POST",
      url: "/api/exports",
      headers: { cookie },
      payload: { scope: "view", count: 3 },
    });
    expect(asAdmin.statusCode).toBe(204); // admins export

    await ctx.start(cookie, "brother");
    const asBrother = await ctx.app.inject({
      method: "POST",
      url: "/api/exports",
      headers: { cookie },
      payload: { scope: "view", count: 3 },
    });
    expect(asBrother.statusCode).toBe(403); // …but not while viewing as a brother
  });

  it("audits start and stop with the target role, and never an escalation", async () => {
    const cookie = await ctx.cookieFor("admin");
    await ctx.start(cookie, "manager");
    await ctx.stop(cookie);

    const actions = ctx.audited.map((e) => e.action);
    expect(actions).toEqual(["impersonate.start", "impersonate.stop"]);
    expect(ctx.audited[0]).toMatchObject({
      action: "impersonate.start",
      actorId: 5001,
      outcome: "ok",
      targetRole: "manager",
      timestamp: FIXED_NOW.toISOString(),
    });
    expect(ctx.audited[1]).toMatchObject({ action: "impersonate.stop", outcome: "ok" });
    // The stop record carries no role — there is nothing to step down to.
    expect(ctx.audited[1]).not.toHaveProperty("targetRole");
  });

  it("refuses escalation and same-role, on the real role, audited as denied", async () => {
    // Manager may not step up to admin, nor sideways to manager.
    const manager = await ctx.cookieFor("manager");
    expect((await ctx.start(manager, "admin")).statusCode).toBe(403);
    expect((await ctx.start(manager, "manager")).statusCode).toBe(403);
    // A brother may not impersonate at all.
    const brother = await ctx.cookieFor("brother");
    expect((await ctx.start(brother, "manager")).statusCode).toBe(403);
    expect((await ctx.start(brother, "brother")).statusCode).toBe(403);

    // Every refusal is recorded as a denial, and none changed the effective role.
    expect(ctx.audited.every((e) => e.outcome === "denied")).toBe(true);
    expect(await ctx.me(manager)).toMatchObject({ impersonating: false });
    expect(await ctx.me(brother)).toMatchObject({ impersonating: false });
  });

  it("gates start/stop on the real role: an admin can re-target or stop while impersonating", async () => {
    const cookie = await ctx.cookieFor("admin");
    await ctx.start(cookie, "brother");
    // Already viewing as a brother (whose powers can't impersonate), yet the start
    // check reads the *real* admin role, so re-targeting to manager still works.
    expect((await ctx.start(cookie, "manager")).statusCode).toBe(204);
    expect(await ctx.me(cookie)).toMatchObject({ role: "manager", impersonating: true });
    // And stop always returns to the real role.
    expect((await ctx.stop(cookie)).statusCode).toBe(204);
    expect(await ctx.me(cookie)).toMatchObject({ role: "admin", impersonating: false });
  });

  it("rejects an unknown role with 400 and an unauthenticated caller with 401", async () => {
    const cookie = await ctx.cookieFor("admin");
    expect((await ctx.start(cookie, "wizard")).statusCode).toBe(400);
    const noCookie = await ctx.app.inject({
      method: "POST",
      url: "/api/me/impersonate",
      payload: { role: "brother" },
    });
    expect(noCookie.statusCode).toBe(401);
  });
});
