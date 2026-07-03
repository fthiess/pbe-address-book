import type { Profile } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { ProfileCache } from "../data/cache.js";
import type { ProfileStore, ProfileWrite, UnconditionalWrite } from "../data/profiles.js";
import { makeProfile } from "../test-support/make-profile.js";
import { commitStatusWrite } from "./privileged-support.js";

/**
 * `commitStatusWrite` token non-regression (OFC-136). Firestore `updateTime` is
 * monotonic per document, so the cache token must never move backwards: if a
 * concurrent write advanced the cache token during the status write's await, the
 * status write must keep the newer token rather than overwrite it with its own
 * (older) one — else the client's next `If-Match` carries a stale ETag and 412s.
 * Tokens here are the real `<sec>.<nanos>` shape so the comparison is exercised.
 */

/** A store returning real-format tokens; optionally injects a concurrent cache write. */
class RealTokenStore implements ProfileStore {
  constructor(
    private readonly returnedToken: string,
    private readonly onWrite?: (id: number) => Promise<void>,
  ) {}
  update(_id: number, _write: ProfileWrite): Promise<string> {
    return Promise.reject(new Error("unused"));
  }
  async updateUnconditional(id: number, _write: UnconditionalWrite): Promise<string> {
    // Simulate a concurrent write landing in the cache during our await.
    await this.onWrite?.(id);
    return this.returnedToken;
  }
  delete(_id: number): Promise<void> {
    return Promise.resolve();
  }
}

async function loadedCache(): Promise<ProfileCache> {
  const cache = new ProfileCache();
  await cache.load([makeProfile({ id: 5001 })], new Map([[5001, "10.0"]]));
  return cache;
}

describe("commitStatusWrite token non-regression (OFC-136)", () => {
  it("keeps a newer cache token installed by a concurrent write during the await", async () => {
    const cache = await loadedCache();
    // The status write returns an OLDER token (50.5); a concurrent write installs a
    // NEWER one (100.0) in the cache mid-await.
    const store = new RealTokenStore("50.5", async (id) => {
      const current = cache.getById(id) as Profile;
      await cache.applyUpdate({ ...current, jobTitle: "Concurrent" }, "100.0");
    });

    const { token, next } = await commitStatusWrite(
      store,
      cache,
      5001,
      makeProfile({ id: 5001 }),
      { employerName: "Acme" },
      [],
    );

    // The newer token is kept, not regressed to the status write's 50.5.
    expect(token).toBe("100.0");
    expect(cache.concurrencyToken(5001)).toBe("100.0");
    // The record carries both the concurrent write's field and this write's.
    expect(next.jobTitle).toBe("Concurrent");
    expect(next.employerName).toBe("Acme");
  });

  it("installs the write's own token when it is the newest (the normal path)", async () => {
    const cache = await loadedCache();
    const store = new RealTokenStore("60.0");
    const { token } = await commitStatusWrite(
      store,
      cache,
      5001,
      makeProfile({ id: 5001 }),
      { employerName: "Acme" },
      [],
    );
    expect(token).toBe("60.0");
    expect(cache.concurrencyToken(5001)).toBe("60.0");
  });
});
