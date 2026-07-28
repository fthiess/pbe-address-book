import { type Page, expect, test } from "@playwright/test";

/**
 * Phase 7.5a — the unified roster store (OFC-179, ENGINEERING-DESIGN §1.7/N62).
 *
 * Before 7.5a the SPA held the bulk dataset twice: the Directory re-downloaded
 * the full payload on every remount, and the Profile page kept a second,
 * tab-lived roster for relationship derivation — so a Directory→Profile→
 * Directory trip transferred the payload two to three times, into copies that
 * could drift. These specs pin the unified behaviour with a **counting route
 * handler**: how many times the SPA actually hit `GET /api/profiles`.
 *
 * The counting pattern is load-bearing for 7.5b too, whose e2e must prove a
 * `304` revalidation ("match skips the download / a version bump forces it")
 * with the same handler.
 */

const OWN_ID = 5002;

const ME = {
  profileId: OWN_ID,
  role: "admin" as const,
  realRole: "admin" as const,
  impersonating: false,
  stars: [],
  profile: {
    id: OWN_ID,
    firstName: "Dev",
    lastName: "Admin",
    classYear: 1990,
    email: "admin@example.test",
    deceased: { isDeceased: false },
    debrothered: { isDebrothered: false },
    hasHeadshot: false,
    privacy: {
      shareEmail: true,
      sharePhone: true,
      shareAddress: true,
      shareEmergency: false,
      shareSpousePartner: false,
    },
    unlisted: false,
    allowNewsletterEmail: true,
    allowShareWithMITAA: false,
    lastModified: "2026-06-03T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
  },
};

const ROSTER = [
  {
    id: 5001,
    firstName: "Aaron",
    lastName: "Adams",
    classYear: 1984,
    deceased: { isDeceased: false },
    hasHeadshot: false,
  },
  {
    id: OWN_ID,
    firstName: "Dev",
    lastName: "Admin",
    classYear: 1990,
    deceased: { isDeceased: false },
    hasHeadshot: false,
  },
];

/** The record read for the Profile page a row click lands on. */
function recordRoute(page: Page) {
  return page.route(/\/api\/profiles\/\d+$/, (route) => {
    const id = Number(/(\d+)$/.exec(route.request().url())?.[1]);
    const named = ROSTER.find((p) => p.id === id);
    return route.fulfill({
      headers: { ETag: "v1" },
      json: {
        id,
        firstName: named?.firstName ?? "Test",
        lastName: named?.lastName ?? "Brother",
        classYear: named?.classYear ?? 1990,
        deceased: { isDeceased: false },
        debrothered: { isDebrothered: false },
        hasHeadshot: false,
        privacy: {
          shareEmail: true,
          sharePhone: true,
          shareAddress: true,
          shareEmergency: false,
          shareSpousePartner: false,
        },
        unlisted: false,
        allowNewsletterEmail: true,
        allowShareWithMITAA: false,
        lastModified: "2026-06-03T12:00:00.000Z",
        newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
      },
    });
  });
}

/**
 * 7.5b — the app-level conditional read. The mock plays the server's part: it
 * stamps an `ETag` on the full response and answers `304` (empty body) when the
 * SPA's `If-None-Match` matches the current token — so these specs prove the
 * client half end-to-end: the token is held, sent, and a `304` re-renders the
 * retained store with no payload transferred, while a bumped token forces the
 * full pull (the CODING-PROJECT-PLAN §7.5 gate's "match skips / bump forces").
 */
test.describe("Phase 7.5b — the conditional read", () => {
  function conditionalRoute(
    page: Page,
    dataset: () => { etag: string; profiles: typeof ROSTER },
    counts: { full: number; notModified: number },
  ) {
    return page.route("**/api/profiles", (route) => {
      const { etag, profiles } = dataset();
      const sent = route.request().headers()["if-none-match"];
      if (sent && sent.replace(/^W\//, "").replace(/^"(.*)"$/, "$1") === etag) {
        counts.notModified += 1;
        return route.fulfill({ status: 304, headers: { ETag: `"${etag}"` } });
      }
      counts.full += 1;
      return route.fulfill({
        headers: { ETag: `"${etag}"` },
        json: { profiles, majors: [] },
      });
    });
  }

  test("match skips the download: the return trip revalidates as a 304 and renders from the store", async ({
    page,
  }) => {
    const counts = { full: 0, notModified: 0 };
    await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
    await recordRoute(page);
    await conditionalRoute(page, () => ({ etag: "v1.brother", profiles: ROSTER }), counts);

    await page.goto("/");
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    expect(counts).toEqual({ full: 1, notModified: 0 });

    await page
      .getByRole("rowheader", { name: /Aaron Adams/ })
      .getByRole("link")
      .click();
    await expect(page.getByRole("heading", { level: 1, name: /Aaron Adams/ })).toBeVisible();
    await page.goBack();

    // The grid renders from the retained store; the background revalidation was
    // answered 304 — no second payload ever crossed the wire.
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    await expect.poll(() => counts.notModified).toBe(1);
    expect(counts.full).toBe(1);
  });

  test("a version bump forces the full pull and the fresh data reaches the grid", async ({
    page,
  }) => {
    const counts = { full: 0, notModified: 0 };
    const FRESH = [
      ...ROSTER,
      {
        id: 5400,
        firstName: "Newly",
        lastName: "Arrived",
        classYear: 2026,
        deceased: { isDeceased: false },
        hasHeadshot: false,
      },
    ];
    // The dataset "changes server-side" while the reader is on the Profile page.
    let current = { etag: "v1.brother", profiles: ROSTER };
    await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
    await recordRoute(page);
    await conditionalRoute(page, () => current, counts);

    await page.goto("/");
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();

    await page
      .getByRole("rowheader", { name: /Aaron Adams/ })
      .getByRole("link")
      .click();
    await expect(page.getByRole("heading", { level: 1, name: /Aaron Adams/ })).toBeVisible();
    current = { etag: "v2.brother", profiles: FRESH };
    await page.goBack();

    // The stale token misses, the full pull runs, and the change lands.
    await expect(page.getByRole("rowheader", { name: /Newly Arrived/ })).toBeVisible();
    expect(counts).toEqual({ full: 2, notModified: 0 });
  });
});

test.describe("Phase 7.5a — one roster store, one download", () => {
  test("Directory→Profile→Directory: one download in, instant render back, one background refresh", async ({
    page,
  }) => {
    let bulkFetches = 0;
    await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
    await recordRoute(page);
    await page.route("**/api/profiles", async (route) => {
      bulkFetches += 1;
      if (bulkFetches > 1) {
        // Stall the background refresh, so the instant-render assertions below
        // demonstrably run from the RETAINED store, not a fast re-download.
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      await route.fulfill({ json: { profiles: ROSTER, majors: [] } });
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    expect(bulkFetches).toBe(1);

    // Opening a profile adds NO bulk fetch: the relationship derivation reads
    // the same store the Directory just filled. (Before 7.5a this was the
    // roster singleton's own second download.)
    await page
      .getByRole("rowheader", { name: /Aaron Adams/ })
      .getByRole("link")
      .click();
    await expect(page.getByRole("heading", { level: 1, name: /Aaron Adams/ })).toBeVisible();
    expect(bulkFetches).toBe(1);

    // Back to the Directory: the grid renders IMMEDIATELY from the retained
    // store — no loading overlay, rows visible — while the background
    // revalidation (stalled 3 s above) is still in flight.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    expect(await page.locator("output[aria-live='polite']").isVisible()).toBe(false);
    expect(bulkFetches).toBe(2); // the remount's background refresh, already counted
  });

  test("the background refresh swaps fresh data into the rendered grid", async ({ page }) => {
    let bulkFetches = 0;
    const FRESH = [
      ...ROSTER,
      {
        id: 5400,
        firstName: "Newly",
        lastName: "Arrived",
        classYear: 2026,
        deceased: { isDeceased: false },
        hasHeadshot: false,
      },
    ];
    await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
    await recordRoute(page);
    await page.route("**/api/profiles", (route) => {
      bulkFetches += 1;
      return route.fulfill({
        json: { profiles: bulkFetches === 1 ? ROSTER : FRESH, majors: [] },
      });
    });

    await page.goto("/");
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Newly Arrived/ })).toBeHidden();

    await page
      .getByRole("rowheader", { name: /Aaron Adams/ })
      .getByRole("link")
      .click();
    await expect(page.getByRole("heading", { level: 1, name: /Aaron Adams/ })).toBeVisible();
    await page.goBack();

    // The second response (another user's edit landing server-side) reaches the
    // grid without a reload: freshness cadence identical to the pre-7.5a
    // remount refetch.
    await expect(page.getByRole("rowheader", { name: /Newly Arrived/ })).toBeVisible();
  });

  test("a failed background refresh keeps the retained roster on screen", async ({ page }) => {
    let bulkFetches = 0;
    await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
    await recordRoute(page);
    await page.route("**/api/profiles", (route) => {
      bulkFetches += 1;
      if (bulkFetches > 1) {
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: { profiles: ROSTER, majors: [] } });
    });

    await page.goto("/");
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();

    await page
      .getByRole("rowheader", { name: /Aaron Adams/ })
      .getByRole("link")
      .click();
    await expect(page.getByRole("heading", { level: 1, name: /Aaron Adams/ })).toBeVisible();
    await page.goBack();

    // The refresh died; the Directory must keep serving the retained data, not
    // blank into the error page.
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    await expect.poll(() => bulkFetches).toBeGreaterThan(1);
    expect(await page.getByText(/couldn't load the directory/).isVisible()).toBe(false);
  });
});
