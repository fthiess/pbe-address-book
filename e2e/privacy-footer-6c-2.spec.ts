import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Phase 6c-2 — the footer's privacy link (OFC-281, N120).
 *
 * USER-MANUAL §8 had told brothers for months that "there is a link to it in the
 * footer at the bottom of every page." There wasn't one, and there was no privacy
 * page to link to. This spec is the proof that the manual's sentence is now true,
 * so it can't quietly become false again.
 *
 * The load-bearing test is the *landing*, not the link's existence: a router
 * `<Link>` to a fragment does not scroll on its own, so "the link is present" and
 * "the reader arrives at the privacy section" are genuinely different claims, and
 * only the second is what §8 promises.
 */

const OWN_ID = 5002;

const ownProfile = {
  id: OWN_ID,
  firstName: "Dev",
  lastName: "Brother",
  classYear: 1990,
  email: "brother@example.test",
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
};

const meDoc = {
  profileId: OWN_ID,
  role: "brother",
  realRole: "brother",
  impersonating: false,
  stars: [] as number[],
  profile: ownProfile,
};

async function signedIn(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: meDoc }));
  await page.route("**/api/profiles*", (route) => route.fulfill({ json: { profiles: [] } }));
  await page.route("**/api/banner", (route) => route.fulfill({ json: { banner: null } }));
}

const privacyLink = (page: Page) =>
  page.getByRole("link", { name: "How we handle your information" });

test.describe("the privacy footer's About link (OFC-281)", () => {
  test("carries the reader from any page to the privacy section of About", async ({ page }) => {
    await signedIn(page);
    await page.goto("/");

    await privacyLink(page).click();

    await expect(page).toHaveURL(/\/about#privacy$/);

    // The section is *reached*, not merely present: a client-side navigation to a
    // fragment does not scroll by itself, which is the whole reason AboutPage has
    // a hash effect. Assert the heading is actually in the viewport.
    const heading = page.getByRole("heading", { name: "Privacy", exact: true });
    await expect(heading).toBeInViewport();
  });

  test("moves focus to the section, so the jump works without a mouse", async ({ page }) => {
    await signedIn(page);
    await page.goto("/");

    await privacyLink(page).click();

    // WCAG 2.4.3: a keyboard or screen-reader user must land where a sighted user
    // lands. Scrolling alone would leave focus back on the footer link.
    await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeFocused();
  });

  test("is absent on the sign-in page, where /about is behind the gate", async ({ page }) => {
    await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: {} }));
    await page.goto("/");

    // The standing privacy prose still shows signed-out — only the link, which
    // would bounce off the session gate, is withheld.
    await expect(page.getByText("This is a private directory for brothers")).toBeVisible();
    await expect(privacyLink(page)).toHaveCount(0);
  });

  test("a deep link to #privacy lands on the section on a cold load", async ({ page }) => {
    await signedIn(page);
    await page.goto("/about#privacy");

    await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeInViewport();
  });

  test("the About page with the privacy link has no axe violations (WCAG 2.2 AA)", async ({
    page,
  }) => {
    await signedIn(page);
    await page.goto("/about#privacy");
    await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
