import { describe, expect, it } from "vitest";
import { makeProfile } from "../test-support/make-profile.js";
import { GhostAdminLifecycle } from "./ghost-admin.js";

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
    const client = new GhostAdminLifecycle({ apiUrl: API_URL, adminApiKey: KEY, fetchImpl: impl });
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
    const client = new GhostAdminLifecycle({ apiUrl: API_URL, adminApiKey: KEY, fetchImpl: impl });
    await client.deleteMember(makeProfile({ id: 5001, ghostMemberId: "m9" }));
    const call = only(calls);
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe(`${API_URL}/members/m9/`);
  });

  it("throws on a non-2xx Ghost response (so the caller aborts clean)", async () => {
    const { impl } = fakeFetch({ status: 422, body: { errors: [{ message: "bad email" }] } });
    const client = new GhostAdminLifecycle({ apiUrl: API_URL, adminApiKey: KEY, fetchImpl: impl });
    await expect(
      client.updateMember(makeProfile({ id: 5001, ghostMemberId: "m1" }), { email: "bad" }),
    ).rejects.toThrow(/422/);
  });

  it("rejects a malformed admin key", () => {
    expect(() => new GhostAdminLifecycle({ apiUrl: API_URL, adminApiKey: "no-colon" })).toThrow();
  });
});
