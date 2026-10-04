import { type Page, expect, test } from "@playwright/test";

/**
 * The masthead's clean-slate reset returns the list to the top when the reader is
 * already on the Directory (OFC-237).
 *
 * Clicking the crest from a Profile remounts the Directory on a fresh history entry
 * and so already lands at the top. Clicking it while already on the Directory,
 * scrolled down, cleared the view's state but left the virtualized list mid-scroll:
 * the new history entry has no saved offset, and `useScrollRestoration` marks such a
 * view "restored" without touching `scrollTop` — deliberately, because filter, sort
 * and `?cols=` changes mint new entries too and must not jump to the top.
 *
 * The fix is therefore a one-shot scroll-to-top signal from the Directory's reset
 * effect, not a change to restoration. The Back guard below runs in the same flow so
 * the fix is proven not to touch D31's scroll-restoration-on-Back.
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
    allowShareWithMITAA: false,
    lastModified: "2026-06-03T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
  },
};

const GENERATED = Array.from({ length: 300 }, (_, i) => ({
  id: 6000 + i,
  firstName: "William",
  lastName: `Webster${String(i + 1).padStart(4, "0")}`,
  classYear: 1970 + (i % 40),
  deceased: { isDeceased: false },
  hasHeadshot: false,
  email: `test${i + 1}@example.test`,
}));

async function gotoDirectory(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: GENERATED, majors: [] } }),
  );
  await page.route("**/img/thumbnails/**", (route) => route.fulfill({ status: 404 }));
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    const id = Number(/(\d+)$/.exec(route.request().url())?.[1]);
    route.fulfill({
      headers: { ETag: "v1" },
      json: { ...ME.profile, id, firstName: "William", lastName: "Webster" },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

const masthead = (page: Page) => page.getByRole("link", { name: "PBE Address Book" });

test.describe("OFC-237 — the masthead returns an already-open Directory to the top", () => {
  test("grid: Back still restores the offset; the masthead lands at the top", async ({ page }) => {
    await gotoDirectory(page);
    const scroller = page.getByTestId("directory-scroll");
    await scroller.getByRole("link").first().waitFor();

    await scroller.evaluate((el) => el.scrollTo(0, 4000));
    await page.waitForTimeout(150); // let the rAF-throttled save write history state

    // D31 guard: open a profile, come Back, and the saved offset is restored.
    await scroller.getByRole("link").nth(3).click();
    await expect(page).toHaveURL(/\/brother\/\d+/);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect
      .poll(() => page.getByTestId("directory-scroll").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(3000);

    // The bug: the crest, clicked from the Directory itself, must land at the top.
    await masthead(page).click();
    await expect
      .poll(() => page.getByTestId("directory-scroll").evaluate((el) => el.scrollTop))
      .toBe(0);
  });

  test("cards: the masthead lands at the top", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDirectory(page);
    const scroller = page.getByTestId("directory-cards-scroll");
    await scroller.getByRole("link").first().waitFor();

    await scroller.evaluate((el) => el.scrollTo(0, 4000));
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(3000);

    await masthead(page).click();
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
  });
});
