import { describe, expect, it } from "vitest";
import { GhostAdminReader } from "./ghost-reader.js";

/**
 * The real read client's field extraction + pagination (5b-2). Driven with an
 * injected `fetch` that serves canned Ghost pages, so no network is touched.
 */

const KEY = "640b1b4b7c9f4e2a8d3c1f0a:aabbccdd";
const API = "https://staging.example.test/ghost/api/admin";

/** Build a fetch double from a `path?query` → JSON-body map (status 200). */
function fetchFrom(routes: Record<string, unknown>, on403: string[] = []): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    // The resource path after the `/ghost/api/admin` base, e.g. `/members/`.
    const resource = u.pathname.split("/admin")[1] ?? u.pathname;
    const key = `${resource}?${u.searchParams.get("filter") ?? u.searchParams.get("include") ?? ""}`;
    // Match by resource path + a discriminating query param; fall back to path alone.
    const body = routes[key] ?? routes[resource];
    if (on403.includes(resource)) {
      return new Response(JSON.stringify({ errors: [{ message: "NoPermissionError" }] }), {
        status: 403,
      });
    }
    return new Response(JSON.stringify(body ?? { meta: { pagination: { next: null } } }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
}

function reader(fetchImpl: typeof fetch) {
  return new GhostAdminReader({ apiUrl: API, adminApiKey: KEY, fetchImpl });
}

describe("GhostAdminReader.listMembers", () => {
  it("projects id/email/name and derives subscribed from the newsletters relation", async () => {
    const r = reader(
      fetchFrom({
        "/members/?newsletters,labels": {
          members: [
            { id: "m1", email: "a@example.test", name: "A '84", newsletters: [{ id: "nl" }] },
            {
              id: "m2",
              email: "b@example.test",
              name: "B '85",
              subscribed: false,
              newsletters: [],
            },
          ],
          meta: { pagination: { next: null } },
        },
      }),
    );
    const members = await r.listMembers();
    expect(members).toEqual([
      { id: "m1", email: "a@example.test", name: "A '84", subscribed: true },
      { id: "m2", email: "b@example.test", name: "B '85", subscribed: false },
    ]);
  });

  it("follows pagination until meta.pagination.next is null", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      const body =
        call === 1
          ? {
              members: [{ id: "m1", email: "a@example.test", name: "A", subscribed: true }],
              meta: { pagination: { next: 2 } },
            }
          : {
              members: [{ id: "m2", email: "b@example.test", name: "B", subscribed: true }],
              meta: { pagination: { next: null } },
            };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const members = await reader(fetchImpl).listMembers();
    expect(members.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(call).toBe(2);
  });
});

describe("GhostAdminReader.listNewsletterEvents", () => {
  it("extracts memberId/subscribed/at and drops malformed rows", async () => {
    const r = reader(
      fetchFrom({
        "/members/events/?type:newsletter_event": {
          events: [
            {
              type: "newsletter_event",
              data: { member_id: "m1", subscribed: false, created_at: "2026-06-01T00:00:00.000Z" },
            },
            { type: "newsletter_event", data: { member_id: "m2" } }, // no subscribed/at → dropped
          ],
          meta: { pagination: { next: null } },
        },
      }),
    );
    expect(await r.listNewsletterEvents()).toEqual([
      { memberId: "m1", subscribed: false, at: "2026-06-01T00:00:00.000Z" },
    ]);
  });
});

describe("GhostAdminReader.listBounceEvents", () => {
  it("extracts member/email ids and prefers failed_at over created_at", async () => {
    const r = reader(
      fetchFrom({
        "/members/events/?type:email_failed_event": {
          events: [
            {
              type: "email_failed_event",
              data: {
                member_id: "m1",
                email_id: "e1",
                failed_at: "2026-06-01T00:00:00.000Z",
                created_at: "2026-05-01T00:00:00.000Z",
              },
            },
          ],
          meta: { pagination: { next: null } },
        },
      }),
    );
    expect(await r.listBounceEvents()).toEqual([
      { memberId: "m1", emailId: "e1", at: "2026-06-01T00:00:00.000Z" },
    ]);
  });
});

describe("GhostAdminReader.listNewsletterEmails", () => {
  it("maps post.email.id → subject, falling back to the post title", async () => {
    const r = reader(
      fetchFrom({
        "/posts/?email": {
          posts: [
            { id: "p1", title: "Post One", email: { id: "e1", subject: "Spring Issue" } },
            { id: "p2", title: "Post Two", email: { id: "e2" } },
          ],
          meta: { pagination: { next: null } },
        },
      }),
    );
    expect(await r.listNewsletterEmails()).toEqual([
      { emailId: "e1", title: "Spring Issue" },
      { emailId: "e2", title: "Post Two" },
    ]);
  });

  it("returns [] (best-effort) when the posts endpoint 403s a custom integration", async () => {
    const r = reader(fetchFrom({}, ["/posts/"]));
    expect(await r.listNewsletterEmails()).toEqual([]);
  });
});
