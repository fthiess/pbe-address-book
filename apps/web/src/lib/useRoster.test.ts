import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfilesFetchResult } from "./api.js";
import type { ProfilesResponse } from "./types.js";

/**
 * The unified roster store (Phase 7.5a, ENGINEERING-DESIGN §1.7/N62). Both the
 * Directory and the Profile page render from this one module singleton, so its
 * transitions carry the whole app's roster freshness story:
 *
 * - first load: empty → data, or empty → error (something to render the error
 *   page from);
 * - background revalidation (a Directory remount): retained data renders while a
 *   fresh copy swaps in — and a background *failure* keeps the retained data
 *   silently, never blanking a working Directory;
 * - `clearRoster` on sign-out drops the PII from the heap (D95);
 * - `applyProfileToRoster` folds a save into the one store both pages read.
 *
 * `fetchProfiles` is mocked at the module seam; state is observed through the
 * test-only `__getRosterState` (node environment — no React rendering here; the
 * subscription side is exercised by the Playwright specs).
 */

vi.mock("./api.js", () => ({
  fetchProfiles: vi.fn(),
}));

import { fetchProfiles } from "./api.js";
import {
  __getRosterState,
  __resetRosterCache,
  applyProfileToRoster,
  clearRoster,
  revalidateRoster,
} from "./useRoster.js";

const mockFetchProfiles = vi.mocked(fetchProfiles);

function fresh(
  profiles: ProfilesResponse["profiles"],
  etag: string | null = "v1.brother",
): ProfilesFetchResult {
  return { status: "fresh", body: { profiles, majors: [] }, etag };
}

const NOT_MODIFIED: ProfilesFetchResult = { status: "not-modified" };

const ROSTER = [
  { id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 },
  { id: 5301, firstName: "Alex", lastName: "Chen", classYear: 1999, bigBrotherId: 5247 },
];

/** Let the mocked fetch's `.then` chain settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  __resetRosterCache();
  mockFetchProfiles.mockReset();
});

afterEach(() => {
  __resetRosterCache();
});

describe("roster store — first load", () => {
  it("loads the roster into the store", async () => {
    mockFetchProfiles.mockResolvedValue(fresh(ROSTER));

    revalidateRoster();
    await flush();

    expect(__getRosterState()).toEqual({ profiles: ROSTER, error: false });
    expect(mockFetchProfiles).toHaveBeenCalledTimes(1);
  });

  it("sets the error flag when the first load fails (nothing to render instead)", async () => {
    mockFetchProfiles.mockRejectedValue(new Error("network"));

    revalidateRoster();
    await flush();

    expect(__getRosterState()).toEqual({ profiles: null, error: true });
  });

  it("recovers from a failed first load on the next revalidation (OFC-114: no error latch)", async () => {
    mockFetchProfiles.mockRejectedValueOnce(new Error("cold 503"));
    revalidateRoster();
    await flush();
    expect(__getRosterState().error).toBe(true);

    mockFetchProfiles.mockResolvedValue(fresh(ROSTER));
    revalidateRoster();
    await flush();

    expect(__getRosterState()).toEqual({ profiles: ROSTER, error: false });
  });

  it("dedupes concurrent revalidations against the in-flight fetch", async () => {
    let resolve!: (value: ProfilesFetchResult) => void;
    mockFetchProfiles.mockReturnValue(
      new Promise<ProfilesFetchResult>((r) => {
        resolve = r;
      }),
    );

    revalidateRoster();
    revalidateRoster();
    revalidateRoster();
    expect(mockFetchProfiles).toHaveBeenCalledTimes(1);

    resolve(fresh(ROSTER));
    await flush();
    expect(__getRosterState().profiles).toEqual(ROSTER);
  });
});

describe("roster store — background revalidation (7.5a)", () => {
  const FRESH = [...ROSTER, { id: 5400, firstName: "New", lastName: "Initiate", classYear: 2026 }];

  beforeEach(async () => {
    mockFetchProfiles.mockResolvedValue(fresh(ROSTER));
    revalidateRoster();
    await flush();
  });

  it("swaps fresh data into the retained store", async () => {
    mockFetchProfiles.mockResolvedValue(fresh(FRESH));

    revalidateRoster();
    // The retained roster stays rendered while the refetch is in flight.
    expect(__getRosterState().profiles).toEqual(ROSTER);
    await flush();

    expect(__getRosterState()).toEqual({ profiles: FRESH, error: false });
  });

  it("keeps the retained data silently when a background refresh fails", async () => {
    mockFetchProfiles.mockRejectedValue(new Error("network blip"));

    revalidateRoster();
    await flush();

    // Never blank a working Directory: data kept, no error surfaced.
    expect(__getRosterState()).toEqual({ profiles: ROSTER, error: false });
  });
});

describe("clearRoster (sign-out, D95)", () => {
  it("drops the roster from the heap", async () => {
    mockFetchProfiles.mockResolvedValue(fresh(ROSTER));
    revalidateRoster();
    await flush();

    clearRoster();

    expect(__getRosterState()).toEqual({ profiles: null, error: false });
  });

  it("a fetch in flight at sign-out cannot repopulate the cleared store (the D95 race)", async () => {
    // The race: revalidateRoster() fires on every Directory mount, the fetch has
    // no AbortController (deliberately — it outlives pages), and sign-out/401
    // call clearRoster() while it is in flight. The late response must be
    // DISCARDED — resolving it into the store would put all ~1,166 records of
    // real PII back on a possibly shared machine after the user signed out.
    let resolve!: (value: ProfilesFetchResult) => void;
    mockFetchProfiles.mockReturnValue(
      new Promise<ProfilesFetchResult>((r) => {
        resolve = r;
      }),
    );

    revalidateRoster(); // fetch now in flight
    clearRoster(); // sign-out lands first
    resolve(fresh(ROSTER)); // ...then the response arrives
    await flush();

    expect(__getRosterState()).toEqual({ profiles: null, error: false });
  });

  it("a fetch resolving after sign-out cannot leave its token behind either", async () => {
    // The epoch fence must discard the WHOLE outcome of a cleared-mid-flight
    // fetch — the role-qualified token included. The token is module-private, so
    // this is observed the way the app would leak it: if the late `fresh` result
    // had stashed its etag, the next load after re-sign-in would revalidate with
    // the prior viewer's token instead of starting unconditional.
    let resolve!: (value: ProfilesFetchResult) => void;
    mockFetchProfiles.mockReturnValueOnce(
      new Promise<ProfilesFetchResult>((r) => {
        resolve = r;
      }),
    );

    revalidateRoster();
    clearRoster();
    resolve(fresh(ROSTER, "stale-viewer.admin"));
    await flush();

    mockFetchProfiles.mockResolvedValue(fresh(ROSTER, "v1.brother"));
    revalidateRoster();
    await flush();
    expect(mockFetchProfiles).toHaveBeenLastCalledWith(null);
  });

  it("a fetch failing after sign-out surfaces no stale error state", async () => {
    let reject!: (reason: Error) => void;
    mockFetchProfiles.mockReturnValue(
      new Promise<ProfilesFetchResult>((_r, rj) => {
        reject = rj;
      }),
    );

    revalidateRoster();
    clearRoster();
    reject(new Error("network"));
    await flush();

    // Without the fence, the catch would see profiles === null and flag an
    // error against the signed-out (empty) store.
    expect(__getRosterState()).toEqual({ profiles: null, error: false });
  });
});

describe("roster store — conditional read token (7.5b)", () => {
  it("sends no token on a first load, then the held token on revalidation", async () => {
    mockFetchProfiles.mockResolvedValue(fresh(ROSTER, "v1.brother"));

    revalidateRoster();
    await flush();
    expect(mockFetchProfiles).toHaveBeenLastCalledWith(null);

    revalidateRoster();
    await flush();
    expect(mockFetchProfiles).toHaveBeenLastCalledWith("v1.brother");
  });

  it("a 304 keeps the retained data and the token", async () => {
    mockFetchProfiles.mockResolvedValueOnce(fresh(ROSTER, "v1.brother"));
    revalidateRoster();
    await flush();

    mockFetchProfiles.mockResolvedValue(NOT_MODIFIED);
    revalidateRoster();
    await flush();

    expect(__getRosterState()).toEqual({ profiles: ROSTER, error: false });
    // The token survived the 304: a further revalidation still sends it.
    revalidateRoster();
    await flush();
    expect(mockFetchProfiles).toHaveBeenLastCalledWith("v1.brother");
  });

  it("a fresh 200 replaces both the data and the token", async () => {
    const FRESH = [...ROSTER, { id: 5400, firstName: "New", lastName: "Face" }];
    mockFetchProfiles.mockResolvedValueOnce(fresh(ROSTER, "v1.brother"));
    revalidateRoster();
    await flush();

    mockFetchProfiles.mockResolvedValue(fresh(FRESH, "v2.brother"));
    revalidateRoster();
    await flush();

    expect(__getRosterState().profiles).toEqual(FRESH);
    revalidateRoster();
    await flush();
    expect(mockFetchProfiles).toHaveBeenLastCalledWith("v2.brother");
  });

  it("clearRoster drops the token with the data — the next viewer starts unconditional", async () => {
    mockFetchProfiles.mockResolvedValue(fresh(ROSTER, "v1.brother"));
    revalidateRoster();
    await flush();

    clearRoster();

    revalidateRoster();
    await flush();
    // The role-qualified token must never cross a sign-out boundary: the next
    // load is a plain unconditional read.
    expect(mockFetchProfiles).toHaveBeenLastCalledWith(null);
  });
});

describe("applyProfileToRoster (the §5.7.4 fold)", () => {
  beforeEach(async () => {
    mockFetchProfiles.mockResolvedValue(fresh(ROSTER));
    revalidateRoster();
    await flush();
  });

  it("patches a saved record's lean fields in place", () => {
    applyProfileToRoster({ id: 5301, firstName: "Alexandra", bigBrotherId: 5247 });

    const patched = __getRosterState().profiles?.find((p) => p.id === 5301);
    expect(patched).toMatchObject({
      firstName: "Alexandra",
      lastName: "Chen", // untouched fields survive
      bigBrotherId: 5247,
    });
  });

  it("propagates a cleared bigBrotherId (null → undefined), so the derived Little-Brother edge drops", () => {
    applyProfileToRoster({ id: 5301, bigBrotherId: null });

    const patched = __getRosterState().profiles?.find((p) => p.id === 5301);
    expect(patched?.bigBrotherId).toBeUndefined();
  });

  it("appends a record the roster hasn't seen", () => {
    applyProfileToRoster({ id: 5500, firstName: "Freshly", lastName: "Added" });

    expect(__getRosterState().profiles?.map((p) => p.id)).toContain(5500);
  });

  it("is a no-op before the roster has loaded", () => {
    __resetRosterCache();

    applyProfileToRoster({ id: 5301, firstName: "Ghost" });

    expect(__getRosterState().profiles).toBeNull();
  });
});
