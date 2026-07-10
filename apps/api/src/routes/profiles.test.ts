import zlib from "node:zlib";
import { type Profile, type Role, formatCanonicalName } from "@pbe/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit-log.js";
import { ProfileCache } from "../data/cache.js";
import type { GhostLifecycle } from "../identity/ghost-lifecycle.js";
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

// A no-op provider: these tests exercise the read path, not the handshake.
const stubProvider: IdentityProvider = {
  name: "stub",
  createSession: () => Promise.reject(new Error("not used in the read-path test")),
};

interface DecodedBody {
  profiles: Array<{ id: number; email?: string } & Record<string, unknown>>;
  majors: unknown[];
}

function sessionFor(role: Role): Session {
  return {
    identity: {
      subject: "5001",
      profileId: 5001,
      email: "a@example.test",
      role,
      displayName: `Test ${role}`,
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

/** Decode whatever encoding the server chose for an injected response. */
function decode(response: { rawPayload: Buffer; headers: Record<string, unknown> }): DecodedBody {
  const enc = response.headers["content-encoding"];
  const raw =
    enc === "br"
      ? zlib.brotliDecompressSync(response.rawPayload)
      : enc === "gzip"
        ? zlib.gunzipSync(response.rawPayload)
        : response.rawPayload;
  return JSON.parse(raw.toString("utf-8")) as DecodedBody;
}

async function buildReadServer() {
  const cache = new ProfileCache();
  await cache.load([
    // 5001 shares email (default privacy); 5002 is unlisted (hidden from brothers);
    // 5003 has email on file but the share toggle off; 5004 is de-brothered (hidden).
    makeProfile({
      id: 5001,
      email: "a@example.test",
      adminNote: "staff eyes only",
      ghostMemberId: "ghost-5001",
    }),
    makeProfile({ id: 5002, unlisted: true }),
    makeProfile({
      id: 5003,
      email: "b@example.test",
      privacy: {
        shareEmail: false,
        sharePhone: true,
        shareAddress: true,
        shareEmergency: false,
        shareSpousePartner: false,
      },
    }),
    makeProfile({ id: 5004, debrothered: { isDebrothered: true } }),
  ]);
  const sessionStore = new InMemorySessionStore();
  const app = await buildServer({
    identityProvider: stubProvider,
    profileCache: cache,
    profileStore: new InMemoryProfileStore(),
    adminUsers: new InMemoryAdminUserStore(),
    bannerStore: new InMemoryBannerStore(),
    backupSource: new InMemoryBackupSource(),
    bugReportStore: new InMemoryBugReportStore(),
    sessionStore,
    nonceStore: new InMemoryNonceStore(),
    getStars: async () => [],
    addStar: async () => [],
    removeStar: async () => [],
    cookie: { secure: true },
  });
  const cookieFor = async (role: Role) =>
    `${SESSION_COOKIE}=${await sessionStore.create(sessionFor(role))}`;
  return { app, cookie: await cookieFor("brother"), cookieFor };
}

describe("GET /api/profiles", () => {
  let app: Awaited<ReturnType<typeof buildReadServer>>["app"];
  let cookie: string;
  let cookieFor: Awaited<ReturnType<typeof buildReadServer>>["cookieFor"];

  beforeEach(async () => {
    ({ app, cookie, cookieFor } = await buildReadServer());
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects an unauthenticated request with 401 (the Phase 1b gate)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("serves brotli with no-store and the right headers when br is accepted", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { "accept-encoding": "br, gzip", cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.vary).toBe("Accept-Encoding");
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");

    const body = JSON.parse(
      zlib.brotliDecompressSync(response.rawPayload).toString("utf-8"),
    ) as DecodedBody;
    // The unlisted (5002) and de-brothered (5004) records are projected away.
    expect(body.profiles.map((p) => p.id)).toEqual([5001, 5003]);
    // Email rides the consent toggle: present for 5001, absent for 5003.
    expect(body.profiles.find((p) => p.id === 5001)?.email).toBe("a@example.test");
    expect(body.profiles.find((p) => p.id === 5003)).not.toHaveProperty("email");
    expect(body.majors).toEqual([]);
  });

  it("serves gzip when br is not accepted but gzip is", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { "accept-encoding": "gzip, deflate", cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    const body = JSON.parse(zlib.gunzipSync(response.rawPayload).toString("utf-8")) as DecodedBody;
    expect(body.profiles).toHaveLength(2);
  });

  it("serves uncompressed JSON when no encoding is accepted", async () => {
    const response = await app.inject({ method: "GET", url: "/api/profiles", headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = JSON.parse(response.payload) as DecodedBody;
    expect(body.profiles).toHaveLength(2);
  });

  it("gives a manager the whole roster (unlisted + de-brothered included) with restricted flags, but no off-toggle value", async () => {
    const cookieM = await cookieFor("manager");
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { "accept-encoding": "br", cookie: cookieM },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = decode(response);
    // The two whole-record-hidden records are visible to staff.
    expect(body.profiles.map((p) => p.id)).toEqual([5001, 5002, 5003, 5004]);
    expect(body.profiles.find((p) => p.id === 5002)?.unlisted).toBe(true);
    // The staff-internal note rides the manager projection (it does not for brothers).
    expect(body.profiles.find((p) => p.id === 5001)?.adminNote).toBe("staff eyes only");
    // Restricted flags are visible to a manager…
    expect(body.profiles.find((p) => p.id === 5003)).toHaveProperty("privacy");
    // …but the value behind 5003's off email-toggle is not (manager ≠ admin).
    expect(body.profiles.find((p) => p.id === 5003)).not.toHaveProperty("email");
  });

  it("lets an admin see through an off-toggle that a manager cannot", async () => {
    const cookieA = await cookieFor("admin");
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { "accept-encoding": "br", cookie: cookieA },
    });
    const body = decode(response);
    expect(body.profiles.map((p) => p.id)).toEqual([5001, 5002, 5003, 5004]);
    // 5003 hid its email; the admin override still sees it.
    expect(body.profiles.find((p) => p.id === 5003)?.email).toBe("b@example.test");
  });

  it("never ships ghostMemberId to any role", async () => {
    for (const role of ["brother", "manager", "admin"] as const) {
      const response = await app.inject({
        method: "GET",
        url: "/api/profiles",
        headers: { "accept-encoding": "br", cookie: await cookieFor(role) },
      });
      const body = decode(response);
      for (const p of body.profiles) {
        expect(p).not.toHaveProperty("ghostMemberId");
      }
    }
  });
});

// --- Phase 2c: the single-record read and the PATCH write path ---

/** A fixed clock so `lastModified`, the verification date, and audit stamps are deterministic. */
const FIXED_NOW = new Date("2026-06-26T12:00:00.000Z");

function sessionAs(profileId: number, role: Role): Session {
  return {
    identity: {
      subject: String(profileId),
      profileId,
      email: `u${profileId}@example.test`,
      role,
      displayName: `Test ${role} ${profileId}`,
    },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

async function buildWriteServer(
  profiles: Profile[],
  ghostLifecycle: GhostLifecycle = new RecordingGhostLifecycle(),
) {
  const cache = new ProfileCache();
  await cache.load(profiles);
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
    sessionStore,
    nonceStore: new InMemoryNonceStore(),
    getStars: async () => [],
    addStar: async () => [],
    removeStar: async () => [],
    cookie: { secure: true },
    ghostLifecycle,
    auditLog: new AuditLog({ write: (record) => audited.push(record) }),
    clock: () => FIXED_NOW,
  });
  const cookieAs = async (profileId: number, role: Role) =>
    `${SESSION_COOKIE}=${await sessionStore.create(sessionAs(profileId, role))}`;
  const etagOf = async (id: number, cookie: string) =>
    (await app.inject({ method: "GET", url: `/api/profiles/${id}`, headers: { cookie } })).headers
      .etag as string;
  return { app, cache, audited, cookieAs, etagOf };
}

describe("GET /api/profiles/:id", () => {
  it("returns the owner's own full record with an ETag, no-store", async () => {
    const { app, cookieAs } = await buildWriteServer([makeProfile({ id: 5001, phone: "555" })]);
    const cookie = await cookieAs(5001, "brother");
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/5001",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.etag).toBeTruthy();
    expect(response.json()).toMatchObject({ id: 5001, phone: "555" });
    await app.close();
  });

  it("404s a brother asking for an unlisted record (the whole-record hide)", async () => {
    const { app, cookieAs } = await buildWriteServer([
      makeProfile({ id: 5001 }),
      makeProfile({ id: 5002, unlisted: true }),
    ]);
    const cookie = await cookieAs(5001, "brother");
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/5002",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("lets a manager read an unlisted record", async () => {
    const { app, cookieAs } = await buildWriteServer([makeProfile({ id: 5002, unlisted: true })]);
    const cookie = await cookieAs(9001, "manager");
    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/5002",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 5002, unlisted: true });
    await app.close();
  });
});

describe("PATCH /api/profiles/:id — concurrency, authorization, audit", () => {
  it("applies an owner edit, stamps verification, advances the ETag, and audits names not values", async () => {
    const { app, cache, audited, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({ id: 5001, phone: "555-0001" }),
    ]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag, "x-cloud-trace-context": "trace-abc/1;o=1" },
      payload: { phone: "617-555-0002" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBeTruthy();
    expect(response.headers.etag).not.toBe(etag);
    // Stored + returned in the one canonical NANP form (N35), not as entered.
    expect(response.json()).toMatchObject({ phone: "+1 (617) 555-0002" });

    // Read-your-writes: the cache reflects the edit, plus the D28 owner auto-verify.
    const stored = cache.getById(5001);
    expect(stored?.phone).toBe("+1 (617) 555-0002");
    expect(stored?.lastVerifiedDate).toBe("2026-06-26");
    expect(stored?.verifiedBy).toBe(5001);
    expect(stored?.lastModified).toBe(FIXED_NOW.toISOString());

    // Audit: one entry, names not values, with the trace id.
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      logType: "audit",
      action: "profile.update",
      actorId: 5001,
      targetId: 5001,
      outcome: "ok",
      fields: ["phone"],
      trace: "trace-abc",
    });
    expect(JSON.stringify(audited[0])).not.toContain("555-0002");
    await app.close();
  });

  it("canonicalizes the primary and emergency-contact phones on save (N35)", async () => {
    const { app, cache, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: {
        phone: "(617) 555-0143",
        emergencyContacts: [{ name: "Susan Smyth", phone: "617.555.0188", email: "" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const stored = cache.getById(5001);
    expect(stored?.phone).toBe("+1 (617) 555-0143");
    expect(stored?.emergencyContacts?.[0]?.phone).toBe("+1 (617) 555-0188");
    await app.close();
  });

  it("requires If-Match (428) and rejects a stale token (412)", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(5001, "brother");

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie },
      payload: { phone: "617-555-0100" },
    });
    expect(missing.statusCode).toBe(428);

    const stale = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": "not-the-current-token" },
      payload: { phone: "617-555-0100" },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ error: "stale_write" });

    // A second writer moves the record on; the first caller's now-stale token 412s.
    const etag = await etagOf(5001, cookie);
    await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { phone: "617-555-0001" },
    });
    const second = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { phone: "617-555-0002" },
    });
    expect(second.statusCode).toBe(412);
    await app.close();
  });

  it("blocks a brother editing another record (403, object-level) and audits the denial", async () => {
    const { app, audited, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({ id: 5001 }),
      makeProfile({ id: 5003 }),
    ]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5003, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5003",
      headers: { cookie, "if-match": etag },
      payload: { phone: "x" },
    });
    expect(response.statusCode).toBe(403);
    expect(audited.at(-1)).toMatchObject({ outcome: "denied", actorId: 5001, targetId: 5003 });
    await app.close();
  });

  it("rejects a field outside the caller's powers (403) rather than dropping it", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    // adminNote is staff-only; a brother may not write it on his own record.
    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { adminNote: "let me in" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ fields: ["adminNote"] });
    await app.close();
  });

  it("forbids a manager setting another brother's consent field (owner-only)", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5003 })]);
    const cookie = await cookieAs(9001, "manager");
    const etag = await etagOf(5003, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5003",
      headers: { cookie, "if-match": etag },
      payload: { unlisted: true },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("forbids a manager overwriting a toggle field the owner has hidden (OFC-206/N70)", async () => {
    // The default privacy hides spouse/partner (shareSpousePartner: false), so a
    // manager never sees 5003's value — and must not be able to blind-overwrite it.
    const { app, cache, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5003 })]);
    const cookie = await cookieAs(9001, "manager");
    const etag = await etagOf(5003, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5003",
      headers: { cookie, "if-match": etag },
      payload: { spousePartnerName: "Blind Overwrite" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ fields: ["spousePartnerName"] });
    expect(cache.getById(5003)?.spousePartnerName).toBeUndefined();
    await app.close();
  });

  it("lets a manager write a toggle field the owner has shared (OFC-206/N70)", async () => {
    const { app, cache, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({
        id: 5003,
        privacy: {
          shareEmail: true,
          sharePhone: true,
          shareAddress: true,
          shareEmergency: true,
          shareSpousePartner: true,
        },
      }),
    ]);
    const cookie = await cookieAs(9001, "manager");
    const etag = await etagOf(5003, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5003",
      headers: { cookie, "if-match": etag },
      payload: { spousePartnerName: "Pat Smyth" },
    });
    expect(response.statusCode).toBe(200);
    expect(cache.getById(5003)?.spousePartnerName).toBe("Pat Smyth");
    await app.close();
  });

  it("clears verification when a manager edits another brother (D28)", async () => {
    const { app, cache, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({
        id: 5003,
        lastVerifiedDate: "2026-01-01",
        verifiedBy: 5003,
        phone: "555-0001",
      }),
    ]);
    const cookie = await cookieAs(9001, "manager");
    const etag = await etagOf(5003, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5003",
      headers: { cookie, "if-match": etag },
      payload: { phone: "617-555-0007" },
    });
    expect(response.statusCode).toBe(200);
    const stored = cache.getById(5003);
    expect(stored?.phone).toBe("+1 (617) 555-0007");
    expect(stored?.lastVerifiedDate).toBeUndefined();
    expect(stored?.verifiedBy).toBeUndefined();
    await app.close();
  });

  it("returns 422 with field names on a validation failure", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { email: "not-an-email" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().issues).toContainEqual(expect.objectContaining({ field: "email" }));
    await app.close();
  });

  it("rejects a duplicate email via the dataset-level uniqueness check (422)", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({ id: 5001, email: "taken@example.test" }),
      makeProfile({ id: 5003, email: "mine@example.test" }),
    ]);
    const cookie = await cookieAs(5003, "brother");
    const etag = await etagOf(5003, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5003",
      headers: { cookie, "if-match": etag },
      payload: { email: "taken@example.test" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().issues).toContainEqual(expect.objectContaining({ field: "email" }));
    await app.close();
  });

  it("returns 422 (not 500) when a required field arrives as JSON null (OFC-89)", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    // A null on a *required* field is neither a clear nor a valid value: it must
    // still be a clean 422, never a 500 (OFC-89). (A null on an optional field is
    // now the OFC-107 clear sentinel — see the clear tests below.)
    for (const [field, payload] of [
      ["firstName", { firstName: null }],
      ["lastName", { lastName: null }],
    ] as const) {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/profiles/5001",
        headers: { cookie, "if-match": etag },
        payload,
      });
      expect(response.statusCode, `${field}: null should be a clean 422, not a 500`).toBe(422);
      expect(response.json().issues).toContainEqual(expect.objectContaining({ field }));
    }
    await app.close();
  });

  it("clears an optional field sent as null end-to-end (OFC-107)", async () => {
    const { app, cache, audited, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({ id: 5001, jobTitle: "Engineer", employerName: "Akamai" }),
    ]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { jobTitle: null },
    });

    expect(response.statusCode).toBe(200);
    const stored = cache.getById(5001);
    // The field is genuinely removed, not left at its old value or stored as null.
    expect(stored?.jobTitle).toBeUndefined();
    expect("jobTitle" in (stored as object)).toBe(false);
    expect(stored?.employerName).toBe("Akamai"); // untouched
    // The clear is a real content change: audited, and the response omits the field.
    expect(audited.at(-1)).toMatchObject({ action: "profile.update", fields: ["jobTitle"] });
    expect(response.json()).not.toHaveProperty("jobTitle");
    await app.close();
  });

  it("does not block an unrelated edit when the stored phone is legacy non-canonical (OFC-110)", async () => {
    // "555-0002" is 7 digits — valid under the old permissive rule, rejected by the
    // N35 narrowing, with no migration behind it. Editing an unrelated field must
    // still succeed rather than 422 on the untouched legacy phone.
    const { app, cache, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({ id: 5001, phone: "555-0002" }),
    ]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { jobTitle: "Engineer" },
    });
    expect(response.statusCode).toBe(200);
    expect(cache.getById(5001)?.jobTitle).toBe("Engineer");
    expect(cache.getById(5001)?.phone).toBe("555-0002"); // untouched, still stored

    // But a genuinely invalid *edit* to the phone is still rejected.
    const etag2 = await etagOf(5001, cookie);
    const bad = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag2 },
      payload: { phone: "12" },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().issues).toContainEqual(expect.objectContaining({ field: "phone" }));
    await app.close();
  });

  it("treats a re-formatted legacy phone as a no-op, sparing the write/re-verify/audit (OFC-112)", async () => {
    const { app, cache, audited, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({
        id: 5001,
        phone: "617-555-0142", // canonicalizable, but stored in legacy (non-canonical) form
        lastVerifiedDate: "2026-01-01",
        verifiedBy: 5001,
      }),
    ]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    // Re-send the same number in a different format — the canonical forms match, so
    // it is not a real change: no write, no verification re-stamp, no audit entry.
    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { phone: "(617) 555-0142" },
    });
    expect(response.statusCode).toBe(200);
    const stored = cache.getById(5001);
    expect(stored?.lastVerifiedDate).toBe("2026-01-01"); // NOT re-stamped to today
    expect(audited).toHaveLength(0);
    await app.close();
  });

  it("rejects a malformed consent/privacy value feeding the projection (OFC-111)", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(5001, "brother");

    for (const [field, payload] of [
      ["unlisted", { unlisted: "no" }],
      ["allowNewsletterEmail", { allowNewsletterEmail: "yes" }],
      ["privacy", { privacy: "nope" }],
    ] as const) {
      const etag = await etagOf(5001, cookie);
      const response = await app.inject({
        method: "PATCH",
        url: "/api/profiles/5001",
        headers: { cookie, "if-match": etag },
        payload,
      });
      expect(response.statusCode, `${field}: malformed consent value must 422`).toBe(422);
      expect(response.json().issues).toContainEqual(expect.objectContaining({ field }));
    }
    await app.close();
  });

  it("completes a partial privacy patch over the stored flags so none go missing (OFC-111)", async () => {
    const { app, cache, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    // A hand-crafted patch flips one flag and omits the rest; the stored object
    // must stay complete (every switch present), not collapse to the single key.
    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { privacy: { shareEmail: false } },
    });
    expect(response.statusCode).toBe(200);
    const stored = cache.getById(5001);
    expect(stored?.privacy).toMatchObject({
      shareEmail: false,
      sharePhone: true,
      shareAddress: true,
      shareEmergency: false,
      shareSpousePartner: false,
    });
    await app.close();
  });

  it("emits a quoted ETag and accepts a weak/quoted If-Match back (OFC-92)", async () => {
    const { app, cookieAs, etagOf } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    // The tag is a spec-compliant quoted entity-tag…
    expect(etag).toMatch(/^".+"$/);
    // …and the server strips an intermediary's `W/` weak prefix + quotes on the way
    // back in, so a normalized round-trip still matches (would 412 every save if not).
    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": `W/${etag}` },
      payload: { jobTitle: "Engineer" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toMatch(/^".+"$/);
    await app.close();
  });

  it("lets an owner save over his own address without a self-conflict (OFC-87)", async () => {
    const { app, cache, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({ id: 5001, email: "mine@example.test" }),
    ]);
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    // Re-send the unchanged own email alongside a real change: the ownership
    // exemption must clear the uniqueness check for an address only he holds.
    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { email: "mine@example.test", jobTitle: "Engineer" },
    });
    expect(response.statusCode).toBe(200);
    expect(cache.getById(5001)?.jobTitle).toBe("Engineer");
    await app.close();
  });

  it("treats a re-sent sub-object differing only by an undefined key as a no-op (OFC-94)", async () => {
    const { app, cache, audited, cookieAs, etagOf } = await buildWriteServer([
      makeProfile({
        id: 5003,
        address: { city: "Cambridge", country: "US", stateProvince: undefined },
        lastVerifiedDate: "2026-01-01",
        verifiedBy: 5003,
      }),
    ]);
    const cookie = await cookieAs(9001, "manager");
    const etag = await etagOf(5003, cookie);

    // The manager re-saves the semantically-identical address (the stored copy
    // carries stateProvince as an explicit undefined; the re-sent one omits it).
    // This must be a no-op — no write, no verification clear, no audit entry.
    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5003",
      headers: { cookie, "if-match": etag },
      payload: { address: { city: "Cambridge", country: "US" } },
    });
    expect(response.statusCode).toBe(200);
    const stored = cache.getById(5003);
    expect(stored?.lastVerifiedDate).toBe("2026-01-01"); // NOT cleared
    expect(stored?.verifiedBy).toBe(5003);
    expect(audited).toHaveLength(0); // no mutation audited
    await app.close();
  });

  it("404s a PATCH to a non-existent record", async () => {
    const { app, cookieAs } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(9001, "admin");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/9999",
      headers: { cookie, "if-match": "anything" },
      payload: { phone: "x" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("PATCH /api/profiles/:id — Ghost-first-gated push (N65)", () => {
  it("pushes a changed pushed field to Ghost, then commits Book", async () => {
    const ghost = new RecordingGhostLifecycle();
    const { app, cache, cookieAs, etagOf } = await buildWriteServer(
      [makeProfile({ id: 5001, email: "old@example.test", ghostMemberId: "gm-5001" })],
      ghost,
    );
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { email: "new@example.test" },
    });

    expect(response.statusCode).toBe(200);
    // Ghost got exactly the changed field, addressed by ghostMemberId…
    expect(ghost.updated).toEqual([
      { id: 5001, ghostMemberId: "gm-5001", diff: { email: "new@example.test" } },
    ]);
    // …and Book committed the change.
    expect(cache.getById(5001)?.email).toBe("new@example.test");
    await app.close();
  });

  it("pushes the recomputed Canonical Name when a name input changes", async () => {
    const ghost = new RecordingGhostLifecycle();
    const { app, cookieAs, etagOf } = await buildWriteServer(
      [makeProfile({ id: 5001, firstName: "James", ghostMemberId: "gm-5001" })],
      ghost,
    );
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { firstName: "Jim" },
    });

    expect(response.statusCode).toBe(200);
    const expectedName = formatCanonicalName(makeProfile({ id: 5001, firstName: "Jim" }), false);
    expect(ghost.updated).toEqual([
      { id: 5001, ghostMemberId: "gm-5001", diff: { name: expectedName } },
    ]);
    await app.close();
  });

  it("fails the whole save with 502 when Ghost rejects, leaving Book untouched", async () => {
    const { app, cache, audited, cookieAs, etagOf } = await buildWriteServer(
      [makeProfile({ id: 5001, email: "old@example.test", ghostMemberId: "gm-5001" })],
      new FailingGhostLifecycle("update"),
    );
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { email: "new@example.test" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: "ghost_update_failed" });
    // Book is untouched: the email did not change and no success was audited.
    expect(cache.getById(5001)?.email).toBe("old@example.test");
    expect(audited.some((a) => a.outcome === "ok")).toBe(false);
    await app.close();
  });

  it("makes no Ghost call when only a non-pushed field changes", async () => {
    const ghost = new RecordingGhostLifecycle();
    const { app, cookieAs, etagOf } = await buildWriteServer(
      [makeProfile({ id: 5001, ghostMemberId: "gm-5001" })],
      ghost,
    );
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { jobTitle: "Engineer" },
    });

    expect(response.statusCode).toBe(200);
    expect(ghost.updated).toHaveLength(0);
    await app.close();
  });

  it("skips the push (and still commits) for a profile with no ghostMemberId", async () => {
    const ghost = new RecordingGhostLifecycle();
    const { app, cache, cookieAs, etagOf } = await buildWriteServer(
      [makeProfile({ id: 5001, email: "old@example.test" })], // no ghostMemberId
      ghost,
    );
    const cookie = await cookieAs(5001, "brother");
    const etag = await etagOf(5001, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/profiles/5001",
      headers: { cookie, "if-match": etag },
      payload: { email: "new@example.test" },
    });

    expect(response.statusCode).toBe(200);
    expect(ghost.updated).toHaveLength(0);
    expect(cache.getById(5001)?.email).toBe("new@example.test");
    await app.close();
  });
});

describe("POST /api/profiles (Add Brother — OFC-201)", () => {
  /** A complete admin-entered create body for a brand-new brother (#6001). */
  function newBrotherBody(overrides: Record<string, unknown> = {}) {
    return {
      id: 6001,
      firstName: "New",
      lastName: "Brother",
      classYear: 2000,
      email: "new.brother@example.test",
      privacy: {
        shareEmail: true,
        sharePhone: true,
        shareAddress: true,
        shareEmergency: false,
        shareSpousePartner: false,
      },
      allowNewsletterEmail: true,
      allowShareWithMITAA: false,
      ...overrides,
    };
  }

  it("creates a brother for an admin (201 + ETag), inserting it into the cache", async () => {
    const ghost = new RecordingGhostLifecycle();
    const { app, cache, cookieAs } = await buildWriteServer([makeProfile({ id: 5001 })], ghost);
    const cookie = await cookieAs(9001, "admin");

    const response = await app.inject({
      method: "POST",
      url: "/api/profiles",
      headers: { cookie },
      payload: newBrotherBody(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.etag).toBeTruthy();
    expect(response.json()).toMatchObject({ id: 6001, firstName: "New", lastName: "Brother" });
    const stored = cache.getById(6001);
    expect(stored?.firstName).toBe("New");
    // Ghost-first: the member is created and its fresh id folded into the record.
    expect(ghost.created).toEqual([6001]);
    expect(stored?.ghostMemberId).toBe("recreated-6001");
    // New-brother status defaults are server-forced.
    expect(stored?.hasHeadshot).toBe(false);
    expect(stored?.deceased.isDeceased).toBe(false);
    await app.close();
  });

  it("forbids a non-admin (manager) from creating a brother (403)", async () => {
    const { app, cache, cookieAs } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(9001, "manager");

    const response = await app.inject({
      method: "POST",
      url: "/api/profiles",
      headers: { cookie },
      payload: newBrotherBody(),
    });

    expect(response.statusCode).toBe(403);
    expect(cache.getById(6001)).toBeNull();
    await app.close();
  });

  it("409s when the Constitution id already exists", async () => {
    const { app, cookieAs } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(9001, "admin");

    const response = await app.inject({
      method: "POST",
      url: "/api/profiles",
      headers: { cookie },
      payload: newBrotherBody({ id: 5001 }),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "conflict" });
    await app.close();
  });

  it("422s a missing or invalid Constitution id", async () => {
    const { app, cookieAs } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(9001, "admin");

    const response = await app.inject({
      method: "POST",
      url: "/api/profiles",
      headers: { cookie },
      payload: newBrotherBody({ id: undefined }),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().issues).toMatchObject([{ field: "id" }]);
    await app.close();
  });

  it("422s a create missing a required field", async () => {
    const { app, cache, cookieAs } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(9001, "admin");

    const response = await app.inject({
      method: "POST",
      url: "/api/profiles",
      headers: { cookie },
      payload: newBrotherBody({ lastName: undefined }),
    });

    expect(response.statusCode).toBe(422);
    expect(cache.getById(6001)).toBeNull();
    await app.close();
  });

  it("aborts clean with 502 when the Ghost-first create fails (nothing written)", async () => {
    const { app, cache, cookieAs } = await buildWriteServer(
      [makeProfile({ id: 5001 })],
      new FailingGhostLifecycle("create"),
    );
    const cookie = await cookieAs(9001, "admin");

    const response = await app.inject({
      method: "POST",
      url: "/api/profiles",
      headers: { cookie },
      payload: newBrotherBody(),
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "ghost_create_failed" });
    expect(cache.getById(6001)).toBeNull();
    await app.close();
  });

  it("creates a Book-only record (no Ghost member) when the brother has no email", async () => {
    const ghost = new RecordingGhostLifecycle();
    const { app, cache, cookieAs } = await buildWriteServer([makeProfile({ id: 5001 })], ghost);
    const cookie = await cookieAs(9001, "admin");

    const response = await app.inject({
      method: "POST",
      url: "/api/profiles",
      headers: { cookie },
      payload: newBrotherBody({ email: undefined }),
    });

    expect(response.statusCode).toBe(201);
    expect(ghost.created).toHaveLength(0); // no email → no Ghost member
    expect(cache.getById(6001)?.ghostMemberId).toBeUndefined();
    await app.close();
  });

  it("ignores server-managed / protected fields sent in the body", async () => {
    const { app, cache, cookieAs } = await buildWriteServer([makeProfile({ id: 5001 })]);
    const cookie = await cookieAs(9001, "admin");

    const response = await app.inject({
      method: "POST",
      url: "/api/profiles",
      headers: { cookie },
      payload: newBrotherBody({
        hasHeadshot: true,
        deceased: { isDeceased: true, deathYear: 1990 },
        lastVerifiedDate: "2000-01-01",
        verifiedBy: 1,
        ghostMemberId: "attacker-supplied",
      }),
    });

    expect(response.statusCode).toBe(201);
    const stored = cache.getById(6001);
    expect(stored?.hasHeadshot).toBe(false);
    expect(stored?.deceased.isDeceased).toBe(false);
    expect(stored?.lastVerifiedDate).toBeUndefined();
    expect(stored?.verifiedBy).toBeUndefined();
    // The Ghost id is server-set from the create result, not the body.
    expect(stored?.ghostMemberId).toBe("recreated-6001");
    await app.close();
  });
});
