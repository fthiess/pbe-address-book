import { type Page, expect, test } from "@playwright/test";

/**
 * Directory horizontal scroll (OFC-205, Phase 5.5e).
 *
 * The bug was not a broken layout — the scroll container clips and scrolls
 * correctly — but that the OS/browser default *overlay* scrollbar auto-hides,
 * leaving the horizontal scrollbar undiscoverable for the 60+ audience. The fix
 * (the `always-scrollbars` class → classic, always-visible scrollbars) is a
 * visual property headless Chromium doesn't faithfully render, so it is
 * confirmed live. What this guard locks in is the *substrate* the fix depends on:
 * the container remains a working horizontal scroll region whenever the columns
 * overflow, and it carries the class that opts it out of overlay rendering.
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

const GENERATED = Array.from({ length: 40 }, (_, i) => ({
  id: 6000 + i,
  firstName: "William",
  lastName: `Webster${String(i + 1).padStart(4, "0")}`,
  classYear: 1970 + (i % 40),
  deceased: { isDeceased: false },
  hasHeadshot: false,
  email: `test${i + 1}@example.test`,
  address: { city: "Cambridge", stateProvince: "MA", country: "US" },
}));

async function gotoDirectory(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: GENERATED, majors: [] } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

test("the Directory grid is a working horizontal scroll region when columns overflow", async ({
  page,
}) => {
  // Narrow enough that the default admin column set (~1392px) overflows.
  await page.setViewportSize({ width: 800, height: 720 });
  await gotoDirectory(page);

  const scroller = page.getByTestId("directory-scroll");
  await scroller.getByRole("link").first().waitFor();

  // Opted out of overlay scrollbars (the fix's mechanism).
  await expect(scroller).toHaveClass(/always-scrollbars/);

  // The content genuinely overflows horizontally and clips inside this container
  // (not the page): scrollWidth exceeds the visible width, and overflow-x scrolls.
  const metrics = await scroller.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
    docOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.overflowX).toBe("auto");
  // The page itself must NOT be what scrolls — the grid owns the overflow.
  expect(metrics.docOverflow).toBe(true);

  // And it actually scrolls: driving scrollLeft moves the content.
  await scroller.evaluate((el) => el.scrollTo({ left: 300 }));
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});
