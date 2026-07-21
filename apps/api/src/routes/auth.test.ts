import { describe, expect, it } from "vitest";
import { AuditLog, type AuditSink } from "../audit/audit-log.js";
import { ProfileCache } from "../data/cache.js";
import { SESSION_COOKIE } from "../identity/session-cookie.js";
import { AuthError, type IdentityProvider, type Session } from "../identity/types.js";
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

/** The Ghost member uuid the stub session carries (D137); see `/api/me` below. */
const SESSION_UUID = "4fa3e4df-85d5-44bd-b0bf-d504bbe22060";

function sessionFor(
  profileId: number,
  role: "brother" | "manager" | "admin",
  withUuid = true,
): Session {
  return {
    identity: {
      subject: String(profileId),
      profileId,
      email: "x@example.test",
      role,
      displayName: "X",
      // Omitted, not undefined, when absent — matching what the real provider
      // builds for a session whose uuid lookup failed or found nothing (D137).
      ...(withUuid ? { ghostMemberUuid: SESSION_UUID } : {}),
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

// A stub Ghost provider: `good` succeeds, the others throw the spec's AuthErrors.
// `jwksdown` throws a JWKS-tagged AuthError — same client-facing 401 invalid_token,
// but categorized so the route audits it as the infrastructure event `auth.jwks`.
function makeProvider(withUuid = true): IdentityProvider {
  return {
    name: "ghost-stub",
    async createSession(request) {
      if (request.token === "good" && request.state) {
        return sessionFor(5001, "brother", withUuid);
      }
      if (request.token === "unlinked") {
        throw new AuthError(403, "unlinked_member");
      }
      if (request.token === "jwksdown") {
        throw new AuthError(401, "invalid_token", "jwks unreachable", { category: "jwks" });
      }
      throw new AuthError(401, "invalid_token");
    },
  };
}

/** A capturing audit sink so a test can assert exactly what the auth route logged. */
function captureSink(): { records: Record<string, unknown>[]; sink: AuditSink } {
  const records: Record<string, unknown>[] = [];
  return { records, sink: { write: (record) => records.push(record) } };
}

async function buildAuthServer(
  withBridge = true,
  opts: { withUuid?: boolean; auditSink?: AuditSink } = {},
) {
  const cache = new ProfileCache();
  await cache.load([
    makeProfile({
      id: 5001,
      email: "x@example.test",
      // shareEmail off proves the owner still gets his OWN value back via /api/me…
      privacy: {
        shareEmail: false,
        sharePhone: true,
        shareAddress: true,
        shareEmergency: false,
        shareSpousePartner: false,
      },
      // …while these never reach any client, even their owner (§9).
      adminNote: "staff eyes only",
      ghostMemberId: "ghost-5001",
    }),
  ]);
  const sessionStore = new InMemorySessionStore();
  const app = await buildServer({
    identityProvider: makeProvider(opts.withUuid ?? true),
    profileCache: cache,
    profileStore: new InMemoryProfileStore(),
    adminUsers: new InMemoryAdminUserStore(),
    bannerStore: new InMemoryBannerStore(),
    backupSource: new InMemoryBackupSource(),
    bugReportStore: new InMemoryBugReportStore(),
    sessionStore,
    nonceStore: new InMemoryNonceStore(),
    getStars: async () => [42],
    addStar: async () => [42],
    removeStar: async () => [42],
    cookie: { secure: true },
    ghostBridge: withBridge ? { url: "https://pbe400.org/book", target: "staging" } : undefined,
    ...(opts.auditSink ? { auditLog: new AuditLog(opts.auditSink) } : {}),
  });
  return { app, sessionStore };
}

function cookieFromResponse(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (header ?? "").split(";")[0] ?? "";
}

describe("auth routes", () => {
  it("POST /api/auth/start mints a nonce and a relay URL carrying state + target", async () => {
    const { app } = await buildAuthServer();
    const response = await app.inject({ method: "POST", url: "/api/auth/start" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const url = new URL(body.signInUrl);
    expect(url.origin + url.pathname).toBe("https://pbe400.org/book");
    expect(url.searchParams.get("state")).toBe(body.state);
    expect(url.searchParams.get("target")).toBe("staging");
    await app.close();
  });

  it("POST /api/auth/start is 404 when no Ghost bridge is configured", async () => {
    const { app } = await buildAuthServer(false);
    const response = await app.inject({ method: "POST", url: "/api/auth/start" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("POST /api/auth/session completes the handshake, sets the cookie, returns identity", async () => {
    const { app } = await buildAuthServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "good", state: "s" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ profileId: 5001, role: "brother", stars: [42] });
    expect(response.headers["set-cookie"]).toContain(SESSION_COOKIE);
    await app.close();
  });

  it("POST /api/auth/session maps an AuthError to its status + code", async () => {
    const { app } = await buildAuthServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "unlinked", state: "s" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "unlinked_member" });
    await app.close();
  });

  it("audits a successful sign-in as auth.signin ok, carrying the authenticated actor (7a-3a)", async () => {
    const { records, sink } = captureSink();
    const { app } = await buildAuthServer(true, { auditSink: sink });
    await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "good", state: "s" },
    });
    const signin = records.find((r) => r.action === "auth.signin");
    expect(signin).toBeDefined();
    expect(signin).toMatchObject({ action: "auth.signin", outcome: "ok", actorId: 5001 });
    await app.close();
  });

  it("audits a denied sign-in as auth.signin denied with the reason code, no actor, no PII (7a-3a)", async () => {
    const { records, sink } = captureSink();
    const { app } = await buildAuthServer(true, { auditSink: sink });
    await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "unlinked", state: "s" },
    });
    const signin = records.find((r) => r.action === "auth.signin");
    expect(signin).toBeDefined();
    expect(signin).toMatchObject({ outcome: "denied", reason: "unlinked_member" });
    // No established actor on a denial, and nothing resembling an email or token.
    expect(signin).not.toHaveProperty("actorId");
    expect(JSON.stringify(signin)).not.toContain("@");
    await app.close();
  });

  it("audits a JWKS key-resolution failure as auth.jwks, distinct from a sign-in denial (7a-3a)", async () => {
    const { records, sink } = captureSink();
    const { app } = await buildAuthServer(true, { auditSink: sink });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "jwksdown", state: "s" },
    });
    // The client still sees the ordinary 401 invalid_token — no API-behavior change.
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_token" });
    // …but the audit stream records the infrastructure fault as its own action, and
    // does NOT also emit an auth.signin denial (which would pollute the denial metric).
    const jwks = records.find((r) => r.action === "auth.jwks");
    expect(jwks).toBeDefined();
    expect(jwks).toMatchObject({ action: "auth.jwks", outcome: "error" });
    expect(records.find((r) => r.action === "auth.signin")).toBeUndefined();
    await app.close();
  });

  it("GET /api/me requires a session, then returns own state no-store", async () => {
    const { app } = await buildAuthServer();
    const unauthed = await app.inject({ method: "GET", url: "/api/me" });
    expect(unauthed.statusCode).toBe(401);

    const signIn = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "good", state: "s" },
    });
    const cookie = cookieFromResponse(signIn.headers["set-cookie"]);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.headers["cache-control"]).toBe("no-store");
    const body = me.json();
    expect(body.profileId).toBe(5001);
    expect(body.role).toBe("brother");
    expect(body.stars).toEqual([42]);
    expect(body.profile.id).toBe(5001);
    // The owner gets his own value back even with the share toggle off (D82)…
    expect(body.profile.email).toBe("x@example.test");
    // …but never the staff-internal note or the system-internal Ghost id (§9).
    expect(body.profile).not.toHaveProperty("adminNote");
    expect(body.profile).not.toHaveProperty("ghostMemberId");
    // The stub session carries a uuid, so /api/me hands the SPA its Mixpanel
    // `distinct_id` (D137) — from the session, and at the top level, NOT inside
    // `profile` (so it never passes through the projection).
    expect(body.ghostMemberUuid).toBe(SESSION_UUID);
    expect(body.profile).not.toHaveProperty("ghostMemberUuid");
    await app.close();
  });

  it("GET /api/me omits ghostMemberUuid when the sign-in lookup did not supply one", async () => {
    // A uuid-less session is a valid session (D137 fail-soft) — /api/me must not
    // invent a value or 500; the SPA simply skips `identify()` in 7a-2.
    const { app } = await buildAuthServer(true, { withUuid: false });
    const signIn = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "good", state: "s" },
    });
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookieFromResponse(signIn.headers["set-cookie"]) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).not.toHaveProperty("ghostMemberUuid");
    await app.close();
  });

  it("POST /api/auth/signout clears the session so the next request is 401", async () => {
    const { app } = await buildAuthServer();
    const signIn = await app.inject({
      method: "POST",
      url: "/api/auth/session",
      payload: { token: "good", state: "s" },
    });
    const cookie = cookieFromResponse(signIn.headers["set-cookie"]);

    const out = await app.inject({ method: "POST", url: "/api/auth/signout", headers: { cookie } });
    expect(out.statusCode).toBe(204);

    const after = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(after.statusCode).toBe(401);
    await app.close();
  });

  it("POST /api/auth/signout clears the cookie even for an already-expired session (OFC-150)", async () => {
    const { app, sessionStore } = await buildAuthServer();
    // A session already past its cap — the gate would 401 it, so a gated sign-out
    // could never clear the cookie. The ungated endpoint must still 204 + clear it.
    const expired = await sessionStore.create({
      identity: {
        subject: "5001",
        profileId: 5001,
        email: "x@example.test",
        role: "brother",
        displayName: "T",
      },
      expiresAt: Date.now() - 1000,
    });
    const out = await app.inject({
      method: "POST",
      url: "/api/auth/signout",
      headers: { cookie: `${SESSION_COOKIE}=${expired}` },
    });
    expect(out.statusCode).toBe(204);
    // The Set-Cookie clears the session cookie (empty value / expiry in the past).
    const setCookie = out.headers["set-cookie"];
    const header = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
    expect(header).toContain(SESSION_COOKIE);
    await app.close();
  });
});
