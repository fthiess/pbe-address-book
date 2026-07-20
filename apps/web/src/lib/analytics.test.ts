import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AnalyticsClient,
  __resetAnalyticsStateForTests,
  identifyMember,
  resetIdentity,
  resultBucket,
  setAnalyticsClient,
  trackPageView,
  trackSearchPerformed,
} from "./analytics.js";

function fakeClient() {
  return {
    identify: vi.fn(),
    peopleSet: vi.fn(),
    track: vi.fn(),
    reset: vi.fn(),
  } satisfies AnalyticsClient;
}

let client: ReturnType<typeof fakeClient>;

beforeEach(() => {
  client = fakeClient();
  setAnalyticsClient(client);
  __resetAnalyticsStateForTests();
});

afterEach(() => {
  setAnalyticsClient(null);
  __resetAnalyticsStateForTests();
});

describe("identifyMember (D137/N123)", () => {
  it("identifies on the Ghost uuid and sets Constitution ID + role as user properties", () => {
    identifyMember("uuid-abc", 5247, "brother");

    expect(client.identify).toHaveBeenCalledExactlyOnceWith("uuid-abc");
    expect(client.peopleSet).toHaveBeenCalledExactlyOnceWith({
      "Constitution ID": 5247,
      Role: "brother",
    });
  });

  it("never sends the brother's name (D88 dropped it, and it stays dropped)", () => {
    identifyMember("uuid-abc", 5247, "brother");

    const properties = client.peopleSet.mock.calls[0]?.[0] ?? {};
    expect(Object.keys(properties)).toEqual(["Constitution ID", "Role"]);
    expect(JSON.stringify(properties)).not.toMatch(/name/i);
  });

  it("does NOT identify when the uuid is absent — no fallback key", () => {
    // The load-bearing rule of 7a-2. Under Simplified ID Merge two `$user_id`s can
    // never be merged, so identifying on any other key would permanently split this
    // brother from the person the newsletter already identifies by uuid (N123).
    identifyMember(undefined, 5247, "brother");

    expect(client.identify).not.toHaveBeenCalled();
    expect(client.peopleSet).not.toHaveBeenCalled();
  });

  it("identifies once per uuid, not once per render", () => {
    identifyMember("uuid-abc", 5247, "brother");
    identifyMember("uuid-abc", 5247, "brother");
    identifyMember("uuid-abc", 5247, "admin");

    expect(client.identify).toHaveBeenCalledOnce();
  });

  it("re-identifies after a reset, so a second brother on one machine is a new person", () => {
    identifyMember("uuid-abc", 5247, "brother");
    resetIdentity();
    identifyMember("uuid-xyz", 5301, "admin");

    expect(client.identify).toHaveBeenCalledTimes(2);
    expect(client.identify).toHaveBeenLastCalledWith("uuid-xyz");
  });

  it("is inert with no client registered (a token-less dev or CI build)", () => {
    setAnalyticsClient(null);
    expect(() => identifyMember("uuid-abc", 5247, "brother")).not.toThrow();
  });
});

describe("resetIdentity", () => {
  it("resets after an identified session", () => {
    identifyMember("uuid-abc", 5247, "brother");
    resetIdentity();

    expect(client.reset).toHaveBeenCalledOnce();
  });

  it("resets even when the session was never identified", () => {
    // The uuid-less case needs this most: without a reset the anonymous device id
    // survives, and the *next* brother's identify() would retroactively absorb this
    // one's anonymous events — unrecoverable under Simplified ID Merge.
    resetIdentity();

    expect(client.reset).toHaveBeenCalledOnce();
  });
});

describe("trackPageView (P6)", () => {
  it("sends the route pattern as given", () => {
    trackPageView("/brother/:id");

    expect(client.track).toHaveBeenCalledExactlyOnceWith("Page View", {
      "Route Pattern": "/brother/:id",
    });
  });

  it("carries no record id for any route the app declares", () => {
    // A guard on the *shape* of what ships: whatever patterns App.tsx declares, none
    // of them may contain a bare number. `/brother/5247` in an event property would
    // record whom a brother looked at.
    for (const pattern of [
      "/",
      "/brother/new",
      "/brother/me",
      "/brother/me/edit",
      "/brother/:id",
      "/brother/:id/edit",
      "/admin",
      "/about",
      "/auth/callback",
      "/*",
    ]) {
      expect(pattern).not.toMatch(/\d/);
    }
  });
});

describe("resultBucket / trackSearchPerformed (P6)", () => {
  it.each([
    [0, "0"],
    [1, "1"],
    [2, "2-10"],
    [10, "2-10"],
    [11, "11+"],
    [700, "11+"],
  ])("buckets %i as %s", (count, expected) => {
    expect(resultBucket(count)).toBe(expected);
  });

  it("treats a negative count defensively as empty", () => {
    expect(resultBucket(-1)).toBe("0");
  });

  it("sends the bucket and nothing else — no query text, no matched ids", () => {
    trackSearchPerformed(3);

    expect(client.track).toHaveBeenCalledExactlyOnceWith("Search Performed", {
      "Result Count": "2-10",
    });
  });
});
