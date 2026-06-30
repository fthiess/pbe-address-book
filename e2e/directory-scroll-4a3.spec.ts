import { type Page, expect, test } from "@playwright/test";

/**
 * Directory scroll restoration under an active Name Search (regression, 4a-3).
 *
 * Name Search is the one filter that resolves **asynchronously**: the grid shows
 * the main-thread substring match immediately, then the Web Worker grows it into
 * the richer fuzzy/phonetic/nickname set (D110/D123). Scroll restoration must wait
 * for that to *settle* — restoring against the interim (shorter) substring list
 * clamps the offset, and the once-per-view guard then leaves it stuck near the
 * top. Forrest hit exactly this: filter-then-Back restored scroll, but
 * search-then-Back landed at the top.
 *
 * The dataset makes the gap large and observable: every brother is a "William",
 * so the nickname search "bill" → William matches all 800 via the worker, while
 * the substring fallback matches only the 20 with "bill" in the surname.
 */

const ME = {
  profileId: 5002,
  role: "admin" as const,
  realRole: "admin" as const,
  impersonating: false,
  stars: [],
  profile: {
    id: 5002,
    firstName: "Dev",
    lastName: "Admin",
    classYear: 1990,
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
    allowCommentReplyEmail: true,
    allowShareWithMITAA: false,
    lastModified: "2026-06-03T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
  },
};

const GENERATED = Array.from({ length: 800 }, (_, i) => ({
  id: 6000 + i,
  firstName: "William",
  lastName:
    i < 20 ? `Bill${String(i + 1).padStart(4, "0")}` : `Webster${String(i + 1).padStart(4, "0")}`,
  classYear: 1970 + (i % 40),
  deceased: { isDeceased: false },
  hasHeadshot: false,
  email: `test${i + 1}@example.test`,
}));

const PROFILES = { profiles: GENERATED, majors: [] };

async function gotoDirectory(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  // Delay the *return*-side refetch so the grid remounts empty and the virtualizer
  // sizes the list a few frames after restoration would naively fire — the
  // condition that exposed the virtualizer-sizing clamp on staging.
  let bulkHits = 0;
  await page.route("**/api/profiles", async (route) => {
    bulkHits += 1;
    if (bulkHits > 1) {
      await new Promise((r) => setTimeout(r, 600));
    }
    return route.fulfill({ json: PROFILES });
  });
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    const id = Number(/(\d+)$/.exec(route.request().url())?.[1]);
    route.fulfill({
      headers: { ETag: "v1" },
      json: {
        id,
        firstName: "William",
        lastName: "Webster",
        classYear: 1990,
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
        allowCommentReplyEmail: true,
        allowShareWithMITAA: false,
        lastModified: "2026-06-03T12:00:00.000Z",
        newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

test("Back restores scroll under an active (worker-resolved) search", async ({ page }) => {
  await gotoDirectory(page);
  const scroller = page.getByTestId("directory-scroll");
  await scroller.getByRole("link").first().waitFor();

  // Nickname search: wait until the worker has ANSWERED (the list grows well past
  // the 20-row substring match) before scrolling, so the save is against the final set.
  await page.getByRole("searchbox", { name: /name search/i }).fill("bill");
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight)).toBeGreaterThan(40000);

  await scroller.evaluate((el) => el.scrollTo(0, 4000));
  await page.waitForTimeout(150); // let the rAF-throttled save write history state
  await scroller.getByRole("link").nth(3).click();
  // The profile genuinely opens (the Directory unmounts), so Back is a true remount.
  await expect(page.getByRole("heading", { level: 1, name: /William/ })).toBeVisible();
  await expect(page).toHaveURL(/\/brother\/\d+/);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
  await expect(page).toHaveURL(/q=bill/);
  // The deep offset must be restored, not clamped near the top. This exercises
  // both halves of the fix: restoration waits for the worker to settle (right row
  // set) AND re-applies across frames until the virtualizer has sized the list
  // (so the offset isn't clamped against an interim tiny scroll height).
  await expect
    .poll(() => page.getByTestId("directory-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(3000);
});
