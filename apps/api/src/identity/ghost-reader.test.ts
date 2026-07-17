import { describe, expect, it } from "vitest";
import { GhostAdminReader } from "./ghost-reader.js";

/**
 * The real read client's field extraction + pagination (5b-2). Driven with an
 * injected `fetch` that serves canned Ghost pages, so no network is touched.
 */

const KEY = "640b1b4b7c9f4e2a8d3c1f0a:aabbccdd";
const API = "https://staging.example.test/ghost/api/admin";
/** A fixed clock so the event-fetch cutoff (OFC-231, 24 months back) is deterministic. */
const FIXED_NOW = Date.parse("2026-07-15T12:00:00.000Z");
const CUTOFF = "2024-07-15"; // 24 months before FIXED_NOW (UTC, day granularity)

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
  return new GhostAdminReader({ apiUrl: API, adminApiKey: KEY, fetchImpl, now: () => FIXED_NOW });
}

describe("GhostAdminReader.listMembers", () => {
  it("projects id/email/name and derives subscribed from the newsletters relation", async () => {
    const r = reader(
      fetchFrom({
        "/members/?newsletters": {
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

  it("derives subscribed from the newsletters relation even when the global boolean disagrees", async () => {
    // Ghost's top-level `subscribed` is a legacy/global flag; the relation is
    // authoritative. A member in the newsletter with global subscribed:false is
    // subscribed for our purposes — no spurious newsletterDrift (review).
    const r = reader(
      fetchFrom({
        "/members/?newsletters": {
          members: [
            {
              id: "m1",
              email: "a@example.test",
              name: "A",
              subscribed: false,
              newsletters: [{ id: "nl" }],
            },
          ],
          meta: { pagination: { next: null } },
        },
      }),
    );
    const [m] = await r.listMembers();
    expect(m?.subscribed).toBe(true);
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
        [`/members/events/?type:newsletter_event+data.created_at:>'${CUTOFF}'`]: {
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

  it("degrades to [] (advisory) when the member-events fetch fails (OFC-275)", async () => {
    // The audit's `ghostChangedAt` enrichment is advisory (N69) — a member-events
    // read failure must NOT break the whole audit, mirroring the best-effort
    // `listNewsletterEmails` swallow. (Before OFC-275's filter fix this failure was a
    // real 400 "Cannot filter by created_at"; the swallow is the belt to that fix.)
    const failing = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "Cannot filter by created_at" }] }), {
        status: 400,
      })) as unknown as typeof fetch;
    expect(await reader(failing).listNewsletterEvents()).toEqual([]);
  });
});

describe("GhostAdminReader.listBounceEvents", () => {
  it("extracts member/email ids and prefers failed_at over created_at", async () => {
    const r = reader(
      fetchFrom({
        [`/members/events/?type:email_failed_event+data.created_at:>'${CUTOFF}'`]: {
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

  it("throws (not advisory) when the member-events fetch fails — the bounce report needs the events", async () => {
    // Unlike the audit's advisory newsletter events, the bounce report genuinely
    // needs these, so a read failure must surface (→ route `502 ghost_read_failed`),
    // not silently produce an empty-and-misleading report (OFC-275).
    const failing = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "boom" }] }), {
        status: 400,
      })) as unknown as typeof fetch;
    await expect(reader(failing).listBounceEvents()).rejects.toThrow();
  });
});

describe("event-fetch date bound (OFC-231)", () => {
  /** A fetch double that records the decoded `filter` query of every request. */
  function capturing(filters: string[]): typeof fetch {
    return (async (url: string | URL | Request) => {
      const f = new URL(String(url)).searchParams.get("filter");
      if (f) {
        filters.push(f);
      }
      return new Response(JSON.stringify({ events: [], meta: { pagination: { next: null } } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
  }

  it("bounds both event fetches to the last 24 months via an NQL created_at filter", async () => {
    const filters: string[] = [];
    const r = reader(capturing(filters));
    await r.listNewsletterEvents();
    await r.listBounceEvents();
    // The `+` is NQL's AND: each fetch is "events of this type created after the cutoff".
    // The date field is `data.created_at` — Ghost's `/members/events` filter allowlist
    // is `[data.created_at, data.member_id, data.post_id, type, id]`; the bare
    // `created_at` is rejected `400 "Cannot filter by created_at"` (OFC-275).
    expect(filters).toEqual([
      `type:newsletter_event+data.created_at:>'${CUTOFF}'`,
      `type:email_failed_event+data.created_at:>'${CUTOFF}'`,
    ]);
  });

  it("recomputes the cutoff from the injected clock (24 calendar months back, UTC)", async () => {
    const filters: string[] = [];
    const r = new GhostAdminReader({
      apiUrl: API,
      adminApiKey: KEY,
      fetchImpl: capturing(filters),
      now: () => Date.parse("2026-03-15T00:00:00.000Z"),
    });
    await r.listNewsletterEvents();
    expect(filters[0]).toContain("data.created_at:>'2024-03-15'");
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
