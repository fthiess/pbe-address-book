import type { Role } from "@pbe/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import type { BackupData } from "../data/backup.js";
import { ProfileCache } from "../data/cache.js";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import type { IdentityProvider, Session } from "../identity/types.js";
import { buildServer } from "../server.js";
import {
  InMemoryAdminUserStore,
  InMemoryBackupSource,
  InMemoryBannerStore,
  InMemoryNonceStore,
  InMemoryProfileStore,
  InMemorySessionStore,
} from "../test-support/fakes.js";

/**
 * The whole-database backup download (`GET /api/admin/backup`, admin only; D63;
 * API-SPEC §7). Driven against the in-memory {@link InMemoryBackupSource} — the
 * effective-role admin guard (N31), the download-attachment framing, the envelope
 * shape, and the `backup.download` audit (D61, a whole-database action with no
 * single target).
 */

const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the backup test")),
};

const FIXED_NOW = new Date("2026-07-05T09:14:00.000Z");

const SAMPLE: BackupData = {
  profiles: [{ id: "5247", data: { id: 5247, lastName: "Smyth", classYear: 1984 } }],
  users: [{ id: "5001", data: { id: 5001, role: "admin", stars: [5247] } }],
  config: [{ id: "systemBanner", data: { active: false, message: "", severity: "info" } }],
};

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

async function buildBackupServer(data: BackupData = SAMPLE) {
  const cache = new ProfileCache();
  await cache.load([]);
  const sessionStore = new InMemorySessionStore();
  const audited: Record<string, unknown>[] = [];
  const app = await buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: new InMemoryProfileStore(),
    adminUsers: new InMemoryAdminUserStore(),
    bannerStore: new InMemoryBannerStore(),
    backupSource: new InMemoryBackupSource(data),
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

describe("GET /api/admin/backup", () => {
  let ctx: Awaited<ReturnType<typeof buildBackupServer>>;
  beforeEach(async () => {
    ctx = await buildBackupServer();
  });

  const get = (cookie?: string) =>
    ctx.app.inject({
      method: "GET",
      url: "/api/admin/backup",
      headers: cookie ? { cookie } : {},
    });

  it("401s without a session", async () => {
    expect((await get()).statusCode).toBe(401);
  });

  it("403s a brother and a manager (admin only)", async () => {
    for (const role of ["brother", "manager"] as const) {
      expect((await get(await ctx.cookieFor(5002, role))).statusCode).toBe(403);
    }
  });

  it("403s an admin viewing as a lower role (effective role, N31)", async () => {
    expect((await get(await ctx.viewingAsCookie("admin", "brother"))).statusCode).toBe(403);
  });

  it("returns the versioned envelope of the live collections for an admin", async () => {
    const response = await get(await ctx.cookieFor(5001, "admin"));
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      version: 1,
      generatedAt: FIXED_NOW.toISOString(),
      collections: SAMPLE,
    });
  });

  it("frames the response as a dated download attachment, no-store", async () => {
    const response = await get(await ctx.cookieFor(5001, "admin"));
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="book-backup-2026-07-05.json"',
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(String(response.headers["content-type"])).toContain("application/json");
  });

  it("audits the download as backup.download with the actor and no target", async () => {
    await get(await ctx.cookieFor(5001, "admin"));
    const entry = ctx.audited.find((e) => e.action === "backup.download");
    expect(entry).toMatchObject({ action: "backup.download", actorId: 5001, outcome: "ok" });
    expect(entry).not.toHaveProperty("targetId");
  });
});
