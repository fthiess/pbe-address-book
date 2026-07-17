import { describe, expect, it } from "vitest";
import { makeProfile } from "../test-support/make-profile.js";
import { GhostAdminLifecycle } from "./ghost-admin.js";
import { GhostDuplicateEmailError } from "./ghost-lifecycle.js";

/** A secret in hex (the Ghost Admin key secret is hex-encoded). */
const KEY = "640b1b4b7c9f4e2a8d3c1f0a:0011223344556677889900aabbccddeeff";
const API_URL = "https://staging.pbe400.org/ghost/api/admin";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Build a fake `fetch` that records the request and returns a canned response. */
function fakeFetch(response: { status: number; body?: unknown }) {
  const calls: Captured[] = [];
  const impl: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k] = v;
    }
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status,
    });
  };
  return { impl, calls };
}

function decodeJwtHeader(authorization: string): Record<string, unknown> {
  const jwt = authorization.replace(/^Ghost /, "");
  const header = jwt.split(".")[0] ?? "";
  return JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
}

/** The single captured request (asserting exactly one was made). */
function only(calls: Captured[]): Captured {
  if (calls.length !== 1 || !calls[0]) {
    throw new Error(`expected exactly one request, got ${calls.length}`);
  }
  return calls[0];
}

/** The first member object in a captured request body. */
function bodyMember(call: Captured): Record<string, unknown> {
  const members = (call.body as { members?: Record<string, unknown>[] }).members;
  if (!members?.[0]) {
    throw new Error("request body has no member");
  }
  return members[0];
}

describe("GhostAdminLifecycle", () => {
  it("signs a Ghost Admin JWT (HS256, kid, aud=/admin/) on every request", async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: { members: [{ id: "m1" }] } });
    const client = new GhostAdminLifecycle({
      apiUrl: API_URL,
      adminApiKey: KEY,
      newsletterId: "nl-1",
      fetchImpl: impl,
    });
    await client.updateMember(makeProfile({ id: 5001, ghostMemberId: "m1" }), { name: "X '84" });

    const call = only(calls);
    const auth = call.headers.Authorization ?? "";
    expect(auth).toMatch(/^Ghost /);
    const header = decodeJwtHeader(auth);
    expect(header).toMatchObject({ alg: "HS256", kid: "640b1b4b7c9f4e2a8d3c1f0a" });
    expect(call.headers["Accept-Version"]).toBe("v5.0");
  });

  it("creates a member (send_email suppressed) and returns the new id", async () => {
    const { impl, calls } = fakeFetch({ status: 201, body: { members: [{ id: "new-123" }] } });
    const client = new GhostAdminLifecycle({
      apiUrl: API_URL,
      adminApiKey: KEY,
      newsletterId: "nl-1",
      fetchImpl: impl,
    });
    const result = await client.createMember(
      makeProfile({ id: 5001, firstName: "Jim", lastName: "Smyth", classYear: 1984 }),
    );

    expect(result).toEqual({ ghostMemberId: "new-123" });
    const call = only(calls);
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${API_URL}/members/?send_email=false`);
    const member = bodyMember(call);
    expect(member.email).toBe("james.smyth@example.test");
    expect(member.name).toBe("Jim Smyth '84");
    // Subscribed → newsletters relation. The comment-reply pref is not pushed (N66).
    expect(member.newsletters).toEqual([{ id: "nl-1" }]);
    expect(member).not.toHaveProperty("enable_comment_notifications");
  });

  it("maps a 422 create rejection to GhostDuplicateEmailError (the collision path, OFC-232)", async () => {
    // Ghost answers a duplicate-email create with 422 ValidationError; createMember
    // surfaces it as a typed collision so the write path can 422 on `email` (Option B),
    // distinct from a generic outage that would 502.
    const { impl } = fakeFetch({
      status: 422,
      body: { errors: [{ type: "ValidationError", message: "Member already exists." }] },
    });
    const client = new GhostAdminLifecycle({
      apiUrl: API_URL,
      adminApiKey: KEY,
      newsletterId: "nl-1",
      fetchImpl: impl,
    });
    const error = await client
      .createMember(makeProfile({ id: 5001, email: "dup@example.test" }))
      .catch((e) => e);
    expect(error).toBeInstanceOf(GhostDuplicateEmailError);
    expect((error as GhostDuplicateEmailError).email).toBe("dup@example.test");
  });

  it("maps an unsubscribe to an empty newsletters array", async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: { members: [{ id: "m1" }] } });
    const client = new GhostAdminLifecycle({
      apiUrl: API_URL,
      adminApiKey: KEY,
      newsletterId: "nl-1",
      fetchImpl: impl,
    });
    await client.updateMember(makeProfile({ id: 5001, ghostMemberId: "m1" }), {
      allowNewsletterEmail: false,
    });
    const call = only(calls);
    const member = bodyMember(call);
    expect(member.newsletters).toEqual([]);
    expect(call.method).toBe("PUT");
    expect(call.url).toBe(`${API_URL}/members/m1/`);
  });

  it("deletes a member by ghostMemberId", async () => {
    const { impl, calls } = fakeFetch({ status: 204 });
    const client = new GhostAdminLifecycle({
      apiUrl: API_URL,
      adminApiKey: KEY,
      newsletterId: "nl-1",
      fetchImpl: impl,
    });
    await client.deleteMember(makeProfile({ id: 5001, ghostMemberId: "m9" }));
    const call = only(calls);
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe(`${API_URL}/members/m9/`);
  });

  it("throws the raw GhostHttpError on a non-email 422 update (generic abort, not a collision)", async () => {
    // A 422 on an update that carries no email is not a duplicate-email condition —
    // it must propagate as the raw transport error (→ 502 ghost_update_failed), never
    // be mislabelled a collision. Only an email-carrying 422 maps to a duplicate (below).
    const { impl } = fakeFetch({ status: 422, body: { errors: [{ message: "bad name" }] } });
    const client = new GhostAdminLifecycle({
      apiUrl: API_URL,
      adminApiKey: KEY,
      newsletterId: "nl-1",
      fetchImpl: impl,
    });
    await expect(
      client.updateMember(makeProfile({ id: 5001, ghostMemberId: "m1" }), { name: "X '84" }),
    ).rejects.toThrow(/422/);
  });

  it("maps a 422 on an email-carrying update to GhostDuplicateEmailError (OFC-276)", async () => {
    // Setting a member's email to one another member already holds is rejected by
    // Ghost's PUT with the same 422 ValidationError create gets ("Member already
    // exists…", property `email`) — verified against ghost-staging 2026-07-17. Surface
    // it as the typed collision so an email *change* that collides 422s on `email`
    // (Option B), symmetric with createMember, rather than a generic 502.
    const { impl } = fakeFetch({
      status: 422,
      body: {
        errors: [
          {
            type: "ValidationError",
            message: "Validation error, cannot edit member.",
            context: "Member already exists. Attempting to edit member with existing email address",
            property: "email",
          },
        ],
      },
    });
    const client = new GhostAdminLifecycle({
      apiUrl: API_URL,
      adminApiKey: KEY,
      newsletterId: "nl-1",
      fetchImpl: impl,
    });
    const error = await client
      .updateMember(makeProfile({ id: 5001, ghostMemberId: "m1" }), { email: "dup@example.test" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(GhostDuplicateEmailError);
    expect((error as GhostDuplicateEmailError).email).toBe("dup@example.test");
  });

  it("rejects a malformed admin key", () => {
    expect(
      () =>
        new GhostAdminLifecycle({ apiUrl: API_URL, adminApiKey: "no-colon", newsletterId: "nl-1" }),
    ).toThrow(/id.*:.*secret/);
  });

  it("refuses to construct without a newsletter id (no silent unsubscribe — OFC-219)", () => {
    expect(
      () => new GhostAdminLifecycle({ apiUrl: API_URL, adminApiKey: KEY, newsletterId: "" }),
    ).toThrow(/GHOST_NEWSLETTER_ID/);
  });
});
