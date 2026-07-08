import { setImmediate as tick } from "node:timers/promises";
import type { Profile, Role } from "@pbe/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { ProfileCache } from "../data/cache.js";
import type {
  GhostCreateResult,
  GhostLifecycle,
  GhostMemberDiff,
} from "../identity/ghost-lifecycle.js";
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
 * Serialization regression tests for the shared per-record write lock
 * (OFC-220/221). The key trick: a Ghost client whose `updateMember` **blocks** on a
 * gate, so a PATCH that changes a pushed field holds the record lock across an
 * observable window. We fire a second write into that window and assert the lock
 * forces it to wait — the behavior the pre-fix code lacked.
 */

const provider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("unused")),
};

/** A Ghost client whose `updateMember` parks until released, signaling when entered. */
function blockingGhost() {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let signalEntered!: () => void;
  const entered = new Promise<void>((r) => {
    signalEntered = r;
  });
  const lifecycle: GhostLifecycle = {
    async deleteMember() {},
    async createMember(profile: Profile): Promise<GhostCreateResult> {
      return { ghostMemberId: `recreated-${profile.id}` };
    },
    async updateMember(_profile: Profile, _diff: GhostMemberDiff) {
      signalEntered();
      await gate;
    },
  };
  return { lifecycle, entered, release };
}

function sessionFor(profileId: number, role: Role): Session {
  return {
    identity: { subject: String(profileId), profileId, email: "s@x.test", role, displayName: "T" },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

async function build(profiles: Profile[], ghostLifecycle: GhostLifecycle) {
  const cache = new ProfileCache();
  await cache.load(profiles);
  const sessionStore = new InMemorySessionStore();
  const app = await buildServer({
    identityProvider: provider,
    profileCache: cache,
    profileStore: new InMemoryProfileStore(),
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
    auditLog: new AuditLog({ write: () => {} }),
    cookie: { secure: true },
  });
  const cookieFor = async (profileId: number, role: Role) =>
    `${SESSION_COOKIE}=${await sessionStore.create(sessionFor(profileId, role))}`;
  const etagOf = async (id: number, cookie: string) =>
    (await app.inject({ method: "GET", url: `/api/profiles/${id}`, headers: { cookie } })).headers
      .etag as string;
  return { app, cache, cookieFor, etagOf };
}

describe("per-record write serialization (OFC-220/221)", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("a verify cannot commit during a PATCH's in-flight Ghost push (OFC-220)", async () => {
    const ghost = blockingGhost();
    const { app, cookieFor, etagOf } = await build(
      [makeProfile({ id: 5001, email: "old@x.test", ghostMemberId: "gm" })],
      ghost.lifecycle,
    );
    close = () => app.close();
    const cookie = await cookieFor(5001, "brother");
    const etag = await etagOf(5001, cookie);

    // PATCH an email (a pushed field) → acquires the lock, then parks in the push.
    const patch = app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { email: "new@x.test" },
    });
    await ghost.entered;

    // Fire a verify into that window; give it every chance to (wrongly) commit.
    const verify = app.inject({
      method: "POST",
      url: "/api/profiles/5001/verify",
      headers: { cookie },
    });
    await tick();
    ghost.release();

    const [patchRes, verifyRes] = await Promise.all([patch, verify]);
    // The verify was forced to wait for the lock, so PATCH's If-Match still held and
    // it committed 200 — not a 412 caused by the verify's token-advance mid-push.
    expect(patchRes.statusCode).toBe(200);
    expect(verifyRes.statusCode).toBe(200);
  });

  it("mark-deceased snapshots consent from a fresh in-lock read, not a pre-lock one (OFC-221)", async () => {
    const ghost = blockingGhost();
    const { app, cache, cookieFor, etagOf } = await build(
      [
        makeProfile({
          id: 5002,
          email: "own@x.test",
          ghostMemberId: "gm",
          allowNewsletterEmail: true,
        }),
      ],
      ghost.lifecycle,
    );
    close = () => app.close();
    const owner = await cookieFor(5002, "brother");
    const admin = await cookieFor(9001, "admin");
    const etag = await etagOf(5002, owner);

    // Owner unsubscribes (a pushed field) → holds the lock, parks in the push.
    const patch = app.inject({
      method: "PATCH",
      url: "/api/profiles/5002",
      headers: { cookie: owner, "if-match": etag },
      payload: { allowNewsletterEmail: false },
    });
    await ghost.entered;

    // Admin marks deceased: at handler entry the record still reads newsletter=true,
    // but its snapshot is built inside the lock — AFTER the unsubscribe commits.
    const deceased = app.inject({
      method: "PUT",
      url: "/api/profiles/5002/deceased",
      headers: { cookie: admin },
      payload: { deceased: true, deathYear: 2026 },
    });
    await tick();
    ghost.release();

    const [patchRes, deceasedRes] = await Promise.all([patch, deceased]);
    expect(patchRes.statusCode).toBe(200);
    expect(deceasedRes.statusCode).toBe(200);
    // The snapshot captured the CURRENT (unsubscribed) consent, so a later reverse
    // would restore `false` — it does not re-subscribe a brother who opted out. (It
    // also reflects the owner-PATCH's auto-verification, confirming a genuinely fresh
    // in-lock read rather than the stale pre-lock `true`.)
    expect(cache.getById(5002)?.deceasedConsentSnapshot).toMatchObject({
      allowNewsletterEmail: false,
    });
  });
});
