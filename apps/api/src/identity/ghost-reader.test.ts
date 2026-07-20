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

/**
 * The sign-in member lookup (D137, OFC-287). The encoding assertions matter more than
 * the happy path: OFC-275 is the standing proof that a wrong NQL filter fails at
 * runtime against real Ghost while every unit test passes, so these pin the exact
 * query string that goes on the wire.
 */
describe("GhostAdminReader.findUuidByEmail", () => {
  /** A fetch double that records the request URLs and serves one canned body. */
  function capturingFetch(body: unknown): { impl: typeof fetch; urls: string[] } {
    const urls: string[] = [];
    const impl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    return { impl, urls };
  }

  /** The single URL the lookup requested, as a parsed `URL` (fails loudly if absent). */
  function requested(urls: string[]): URL {
    expect(urls).toHaveLength(1);
    return new URL(urls[0] ?? "");
  }

  it("returns the uuid for a matching member", async () => {
    const { impl } = capturingFetch({
      members: [
        { id: "m1", uuid: "4fa3e4df-85d5-44bd-b0bf-d504bbe22060", email: "a@example.test" },
      ],
    });
    expect(await reader(impl).findUuidByEmail("a@example.test")).toBe(
      "4fa3e4df-85d5-44bd-b0bf-d504bbe22060",
    );
  });

  it("single-quotes the email in the NQL filter and asks for a single row", async () => {
    const { impl, urls } = capturingFetch({ members: [] });
    await reader(impl).findUuidByEmail("a@example.test");
    const query = requested(urls).searchParams;
    // Quoting is unconditional (see findUuidByEmail): an unquoted `+` is NQL's AND.
    expect(query.get("filter")).toBe("email:'a@example.test'");
    expect(query.get("limit")).toBe("1");
  });

  it("percent-encodes a `+` address so Ghost does not read it as AND (regression)", async () => {
    // `fred+news@example.test` is the shape that breaks a hand-built query string:
    // a raw `+` in a query is decoded as a space, and an unquoted `+` in NQL is AND.
    // Both halves — the quotes and the `%2B` — are required for this to match.
    const { impl, urls } = capturingFetch({ members: [{ uuid: "u-plus" }] });
    const uuid = await reader(impl).findUuidByEmail("fred+news@example.test");
    expect(uuid).toBe("u-plus");
    const url = requested(urls);
    expect(url.href).toContain("%2Bnews%40example.test");
    expect(url.href).not.toContain("+news@");
    // And it still round-trips back to the intended filter when Ghost decodes it.
    expect(url.searchParams.get("filter")).toBe("email:'fred+news@example.test'");
  });

  it("escapes an apostrophe in the address so the NQL string cannot be broken out of", async () => {
    // `o'brien@example.test` is a valid, unremarkable address — `'` is RFC 5322
    // atext, and a 700-brother roster with Irish surnames will contain one. Ghost's
    // filter docs are explicit that a quote inside a quoted string MUST be escaped;
    // unescaped, `email:'o'brien@…'` terminates the string after `o` and the rest is
    // garbage. Two failure modes, one silent and one severe: Ghost 400s and the
    // brother is never identified, or the mangled filter matches a DIFFERENT member
    // and we adopt his uuid — and a wrong `$user_id` is unrecoverable under
    // Simplified ID Merge (D137). Escaping forecloses both.
    const { impl, urls } = capturingFetch({ members: [] });
    await reader(impl).findUuidByEmail("o'brien@example.test");
    expect(requested(urls).searchParams.get("filter")).toBe("email:'o\\'brien@example.test'");
  });

  it("escapes a backslash before the quote, so the escape cannot itself be escaped away", async () => {
    // Order matters: escaping `'` first and `\` second would turn `\'` into `\\'`,
    // re-exposing the quote. Backslash must be doubled first.
    const { impl, urls } = capturingFetch({ members: [] });
    await reader(impl).findUuidByEmail("odd\\'name@example.test");
    expect(requested(urls).searchParams.get("filter")).toBe("email:'odd\\\\\\'name@example.test'");
  });

  it("returns null when Ghost has no member at that address", async () => {
    const { impl } = capturingFetch({ members: [] });
    expect(await reader(impl).findUuidByEmail("nobody@example.test")).toBeNull();
  });

  it("returns null rather than a bad value when the row carries no usable uuid", async () => {
    // A wrong `$user_id` is unrecoverable under Simplified ID Merge (D137), so a
    // malformed row degrades to "unidentified" instead of being trusted through.
    const { impl } = capturingFetch({ members: [{ id: "m1", uuid: 12345 }] });
    expect(await reader(impl).findUuidByEmail("a@example.test")).toBeNull();
    const empty = capturingFetch({ members: [{ id: "m1", uuid: "" }] });
    expect(await reader(empty.impl).findUuidByEmail("a@example.test")).toBeNull();
  });

  it("throws on a transport failure, leaving the fail-soft decision to the caller", async () => {
    // `null` (no such member) and "threw" (Ghost is broken) are deliberately
    // distinguishable — the provider logs them differently.
    const impl = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "boom" }] }), {
        status: 500,
      })) as unknown as typeof fetch;
    await expect(reader(impl).findUuidByEmail("a@example.test")).rejects.toThrow();
  });

  it("bounds the wait so a hung Ghost cannot stall sign-in (OFC-287)", async () => {
    // The one place Book passes `timeoutMs`. A fetch that never settles on its own
    // must still reject, via the abort signal the request attaches. The budget is
    // shrunk to keep the test instant; the production value is 3s.
    const hangs = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const r = new GhostAdminReader({
      apiUrl: API,
      adminApiKey: KEY,
      fetchImpl: hangs,
      memberLookupTimeoutMs: 10,
    });
    await expect(r.findUuidByEmail("a@example.test")).rejects.toThrow();
  });

  it("leaves the report reads unbounded — the timeout is opt-in per call (OFC-294)", async () => {
    // Guards the deliberate asymmetry: only the sign-in lookup passes `timeoutMs`,
    // so `listMembers` must attach no abort signal. If a later change defaults a
    // timeout for every Ghost call, this fails and forces the decision to be explicit.
    let sawSignal: unknown = "unset";
    const impl = (async (_url: string, init?: RequestInit) => {
      sawSignal = init?.signal;
      return new Response(JSON.stringify({ members: [], meta: { pagination: { next: null } } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    await reader(impl).listMembers();
    expect(sawSignal).toBeUndefined();
  });
});
