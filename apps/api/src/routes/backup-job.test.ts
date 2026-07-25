import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { DiagnosticLog } from "../audit/diagnostic-log.js";
import { InMemoryBackupStore, backupObjectName } from "../data/backup-store.js";
import { type BackupData, InMemoryBackupSource } from "../data/backup.js";
import {
  ServiceIdentityUnavailableError,
  type ServiceIdentityVerifier,
} from "../identity/google-oidc.js";
import {
  BACKUP_BOOTSTRAP_MESSAGE,
  BACKUP_STALE_AFTER_MS,
  BACKUP_STALE_MESSAGE,
  registerBackupJobRoutes,
} from "./backup-job.js";

/**
 * The nightly automated backup (`POST /api/internal/backup`; D63/D101/D102, 7b-2).
 *
 * Two behaviors carry most of the weight here and are tested hardest. **The
 * pre-flight staleness check must never be able to stop the backup** — it is a
 * detector, and a detector that can veto the thing it watches is worse than none.
 * And **the job must fail closed**: it triggers a read of every brother's data, so
 * an unconfigured or unauthenticated call must never produce a snapshot.
 */

const NOW = new Date("2026-07-25T03:00:00.000Z");

const acceptAll: ServiceIdentityVerifier = { verify: async () => {} };
const rejectAll: ServiceIdentityVerifier = {
  verify: async () => {
    throw new Error("bad token");
  },
};
const jwksDown: ServiceIdentityVerifier = {
  verify: async () => {
    throw new ServiceIdentityUnavailableError("jwks unreachable");
  },
};

const SAMPLE: BackupData = {
  profiles: [
    { id: "5247", data: { id: 5247, lastName: "Smyth", hasHeadshot: true, headshotVersion: "v3" } },
    { id: "5001", data: { id: 5001, lastName: "Doe" } },
  ],
  users: [{ id: "5001", data: { id: 5001, stars: [5247] } }],
  config: [{ id: "systemBanner", data: { active: false } }],
};

interface Options {
  verifier?: ServiceIdentityVerifier;
  store?: InMemoryBackupStore | null;
  source?: { export(): Promise<BackupData> };
  now?: Date;
}

async function build(options: Options = {}) {
  const audited: Record<string, unknown>[] = [];
  const logged: Record<string, unknown>[] = [];
  const store = options.store === null ? undefined : (options.store ?? new InMemoryBackupStore());
  const app = Fastify({ logger: false });
  registerBackupJobRoutes(app, {
    verifier: "verifier" in options ? options.verifier : acceptAll,
    backupStore: store,
    backupSource: options.source ?? new InMemoryBackupSource(SAMPLE),
    audit: new AuditLog({ write: (record) => audited.push(record) }),
    diagnostics: new DiagnosticLog({ write: (record) => logged.push(record) }, () => NOW),
    clock: () => options.now ?? NOW,
  });
  await app.ready();
  return { app, audited, logged, store };
}

const run = (app: FastifyInstance, token: string | null = "good-token") =>
  app.inject({
    method: "POST",
    url: "/api/internal/backup",
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });

describe("POST /api/internal/backup — configuration and auth", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("fails closed with 503 when no scheduler identity is configured", async () => {
    const ctx = await build({ verifier: undefined });
    app = ctx.app;
    const res = await run(app);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "backup_unavailable" });
    expect(ctx.store?.objects.size ?? 0).toBe(0);
  });

  it("fails closed with 503 when no backup bucket is configured", async () => {
    const ctx = await build({ store: null });
    app = ctx.app;
    expect((await run(app)).statusCode).toBe(503);
  });

  it("401s and audits a call with no bearer token", async () => {
    const ctx = await build();
    app = ctx.app;
    expect((await run(app, null)).statusCode).toBe(401);
    expect(ctx.audited).toContainEqual(
      expect.objectContaining({
        action: "backup.auto",
        outcome: "denied",
        reason: "missing_token",
      }),
    );
    expect(ctx.store?.objects.size).toBe(0);
  });

  it("401s and audits an invalid token", async () => {
    const ctx = await build({ verifier: rejectAll });
    app = ctx.app;
    expect((await run(app)).statusCode).toBe(401);
    expect(ctx.audited).toContainEqual(
      expect.objectContaining({ outcome: "denied", reason: "invalid_token" }),
    );
    expect(ctx.store?.objects.size).toBe(0);
  });

  it("audits a denial with no actor — the caller is a service, not a brother", async () => {
    const ctx = await build({ verifier: rejectAll });
    app = ctx.app;
    await run(app);
    const denied = ctx.audited.find((entry) => entry.outcome === "denied");
    expect(denied).not.toHaveProperty("actorId");
    expect(denied).not.toHaveProperty("targetId");
  });

  it("503s (retryable) on a JWKS outage, and does NOT audit it as a denial", async () => {
    const ctx = await build({ verifier: jwksDown });
    app = ctx.app;
    const res = await run(app);
    // Nobody was refused — Google was unreachable. Auditing it as a denial would
    // inflate the very signal a probe-detection metric watches (OFC-223/N126).
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "verification_unavailable" });
    expect(ctx.audited.filter((entry) => entry.outcome === "denied")).toEqual([]);
  });
});

describe("POST /api/internal/backup — taking the snapshot", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("writes one timestamped snapshot and reports it", async () => {
    const ctx = await build();
    app = ctx.app;
    const res = await run(app);
    expect(res.statusCode).toBe(200);
    const expectedName = backupObjectName(NOW);
    expect(res.json()).toEqual({
      object: expectedName,
      generatedAt: NOW.toISOString(),
      profiles: 2,
      images: 1,
    });
    expect([...(ctx.store?.objects.keys() ?? [])]).toEqual([expectedName]);
  });

  it("stores the full envelope — collections plus the derived image manifest", async () => {
    const ctx = await build();
    app = ctx.app;
    await run(app);
    const body = JSON.parse(ctx.store?.objects.get(backupObjectName(NOW)) ?? "{}");
    expect(body).toMatchObject({
      version: 2,
      generatedAt: NOW.toISOString(),
      collections: SAMPLE,
    });
    expect(body.images).toEqual([
      {
        id: 5247,
        version: "v3",
        headshotKey: "headshots/5247/v3.webp",
        thumbnailKey: "thumbnails/5247/v3.webp",
      },
    ]);
  });

  it("audits the run as backup.auto ok with the profile count and no actor", async () => {
    const ctx = await build();
    app = ctx.app;
    await run(app);
    const entry = ctx.audited.find((e) => e.action === "backup.auto" && e.outcome === "ok");
    expect(entry).toMatchObject({ action: "backup.auto", outcome: "ok", count: 2 });
    expect(entry).not.toHaveProperty("actorId");
  });

  it("audits and 500s when the export fails — and writes nothing", async () => {
    const ctx = await build({
      source: {
        export: async () => {
          throw new Error("firestore unavailable");
        },
      },
    });
    app = ctx.app;
    const res = await run(app);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: "backup_failed" });
    expect(ctx.audited).toContainEqual(
      expect.objectContaining({ action: "backup.auto", outcome: "error" }),
    );
    expect(ctx.store?.objects.size).toBe(0);
  });

  it("audits and 500s when the bucket write fails", async () => {
    const store = new InMemoryBackupStore();
    store.write = async () => {
      throw new Error("permission denied");
    };
    const ctx = await build({ store });
    app = ctx.app;
    expect((await run(app)).statusCode).toBe(500);
    expect(ctx.audited).toContainEqual(
      expect.objectContaining({ action: "backup.auto", outcome: "error" }),
    );
  });

  it("keeps the failure detail off the client and on the diagnostic stream", async () => {
    const ctx = await build({
      source: {
        export: async () => {
          throw new Error("project pbe-book-staging database (default) unreachable");
        },
      },
    });
    app = ctx.app;
    const res = await run(app);
    expect(res.body).not.toContain("pbe-book-staging");
    expect(ctx.logged).toContainEqual(
      expect.objectContaining({ severity: "ERROR", message: "automated backup failed" }),
    );
  });
});

describe("POST /api/internal/backup — the pre-flight staleness check", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const staleness = (logged: Record<string, unknown>[]) =>
    logged.find((entry) => entry.message === BACKUP_STALE_MESSAGE);

  it("logs the bootstrap line, not the alert, on the first-ever run", async () => {
    // The first run has no prior snapshot, so its "age" is infinite. If that took
    // the alert path, every new environment — and prod at cutover — would alarm on
    // day one, training the recipient to ignore it.
    const ctx = await build();
    app = ctx.app;
    await run(app);
    expect(ctx.logged).toContainEqual(
      expect.objectContaining({ severity: "INFO", message: BACKUP_BOOTSTRAP_MESSAGE }),
    );
    expect(staleness(ctx.logged)).toBeUndefined();
  });

  it("stays quiet at the normal ~12h age (the twice-daily cadence, D149)", async () => {
    const lastRun = new Date(NOW.getTime() - 12 * 60 * 60 * 1000);
    const ctx = await build({
      store: new InMemoryBackupStore([[backupObjectName(lastRun), "{}"]]),
    });
    app = ctx.app;
    await run(app);
    expect(staleness(ctx.logged)).toBeUndefined();
    expect(ctx.logged).not.toContainEqual(
      expect.objectContaining({ message: BACKUP_BOOTSTRAP_MESSAGE }),
    );
  });

  it("alerts once a single run has been missed (~24h age)", async () => {
    // The threshold's whole purpose: on a twice-daily schedule one missed run
    // puts the newest snapshot at ~24h, which must be loud. If a cadence change
    // ever makes this test fail, BACKUP_STALE_AFTER_MS needs rethinking with it.
    const oneMissed = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const ctx = await build({
      store: new InMemoryBackupStore([[backupObjectName(oneMissed), "{}"]]),
    });
    app = ctx.app;
    await run(app);
    expect(staleness(ctx.logged)).toMatchObject({ severity: "ERROR" });
  });

  it("alerts at ERROR when a scheduled run was missed", async () => {
    const tooOld = new Date(NOW.getTime() - BACKUP_STALE_AFTER_MS - 60_000);
    const ctx = await build({ store: new InMemoryBackupStore([[backupObjectName(tooOld), "{}"]]) });
    app = ctx.app;
    await run(app);
    expect(staleness(ctx.logged)).toMatchObject({
      severity: "ERROR",
      message: BACKUP_STALE_MESSAGE,
      action: "backup.auto",
    });
  });

  it("does not alert exactly at the threshold — only past it", async () => {
    const atThreshold = new Date(NOW.getTime() - BACKUP_STALE_AFTER_MS);
    const ctx = await build({
      store: new InMemoryBackupStore([[backupObjectName(atThreshold), "{}"]]),
    });
    app = ctx.app;
    await run(app);
    expect(staleness(ctx.logged)).toBeUndefined();
  });

  it("STILL takes the backup when the history is stale", async () => {
    // The whole point: a stale history is a reason to take today's snapshot, not
    // to skip it. If this ever inverts, the detector becomes the outage.
    const tooOld = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    const ctx = await build({ store: new InMemoryBackupStore([[backupObjectName(tooOld), "{}"]]) });
    app = ctx.app;
    const res = await run(app);
    expect(res.statusCode).toBe(200);
    expect(ctx.store?.objects.has(backupObjectName(NOW))).toBe(true);
  });

  it("STILL takes the backup when the staleness check itself throws", async () => {
    const store = new InMemoryBackupStore();
    store.latest = async () => {
      throw new Error("bucket list failed");
    };
    const ctx = await build({ store });
    app = ctx.app;
    const res = await run(app);
    expect(res.statusCode).toBe(200);
    expect(store.objects.has(backupObjectName(NOW))).toBe(true);
    expect(ctx.logged).toContainEqual(
      expect.objectContaining({ severity: "WARNING", message: "backup staleness check failed" }),
    );
  });

  it("runs the check only after auth — an unauthenticated probe logs nothing", async () => {
    const ctx = await build({ verifier: rejectAll });
    app = ctx.app;
    await run(app);
    expect(ctx.logged).toEqual([]);
  });
});
