import { type Page, expect, test } from "@playwright/test";

/**
 * Directory horizontal scroll (OFC-205, Phase 5.5e).
 *
 * The horizontal scrollbar lives at the *bottom* of the grid's scroll container.
 * The bug: the container was capped at a fixed `100dvh − 13rem`, but the chrome
 * above the grid (masthead, system banner, heading/search, Filters, action bar)
 * grew past that constant, so the container's bottom — and its horizontal
 * scrollbar — was pushed below the viewport fold, unreachable. The fix measures
 * the grid's live top and fills to the viewport bottom. This guard reproduces the
 * banner-present condition that exposed it and asserts the container's bottom
 * (hence its horizontal scrollbar) stays on-screen while the columns overflow.
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

const GENERATED = Array.from({ length: 200 }, (_, i) => ({
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
  // A visible system banner, as on staging ("This is a test copy…") — the extra
  // chrome above the grid is exactly what pushed the old fixed cap past the fold.
  await page.route("**/api/banner", (route) =>
    route.fulfill({
      json: {
        message: "This is a test copy of the PBE Address Book, with test data.",
        severity: "info",
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

test("the grid's bottom (and horizontal scrollbar) stays within the viewport while columns overflow", async ({
  page,
}) => {
  // Narrow enough that the default admin column set (~1392px) overflows, and short
  // enough that a fixed `100dvh − 13rem` cap would put the bottom below the fold.
  await page.setViewportSize({ width: 1100, height: 900 });
  await gotoDirectory(page);

  const scroller = page.getByTestId("directory-scroll");
  await scroller.getByRole("link").first().waitFor();

  // Opted out of overlay scrollbars (the complementary always-visible-scrollbar fix).
  await expect(scroller).toHaveClass(/always-scrollbars/);

  const m = await scroller.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      hOverflow: el.scrollWidth > el.clientWidth,
      bottom: rect.bottom,
      innerHeight: window.innerHeight,
      pageScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  // Columns genuinely overflow the grid horizontally...
  expect(m.hOverflow).toBe(true);
  // ...the grid — not the page — owns that overflow...
  expect(m.pageScrollsX).toBe(false);
  // ...and crucially the grid's bottom edge (where the horizontal scrollbar sits)
  // is ON-SCREEN, not shoved below the viewport fold as it was before the fix.
  expect(m.bottom).toBeLessThanOrEqual(m.innerHeight);

  // And it actually scrolls horizontally.
  await scroller.evaluate((el) => el.scrollTo({ left: 300 }));
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});
