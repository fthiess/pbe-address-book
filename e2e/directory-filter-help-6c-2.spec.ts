import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Phase 6c-2 — toggle-tips on the two numeric Directory filters (OFC-283, N120).
 *
 * These controls carried hardcoded labels and placeholders and no registry entry,
 * so they had no `?` help — and USER-MANUAL §10, generated from the registry
 * (N118), would have silently dropped the range-and-list syntax the hand-written
 * manual used to document. This spec holds both ends of that: the help exists in
 * the running app, and it comes from the registry the manual is built from.
 *
 * Constitution ID is manager/admin-only, so `ME` is an admin here.
 */

const ME = {
  profileId: 5002,
  role: "admin" as const,
  realRole: "admin" as const,
  impersonating: false,
  stars: [] as number[],
  profile: {
    id: 5002,
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

async function openFilters(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [ME.profile], majors: [] } }),
  );
  await page.route("**/api/banner", (route) => route.fulfill({ json: { active: false } }));
  await page.goto("/");
  await page.getByRole("button", { name: /^Filters/ }).click();
}

test.describe("numeric filter toggle-tips (OFC-283)", () => {
  test("Class Year explains the range-and-list syntax, including open-ended ranges", async ({
    page,
  }) => {
    await openFilters(page);

    await page.getByRole("button", { name: "Help: Class Year" }).click();

    // The open-ended forms are the part a member cannot guess and the part the
    // generated §10 would otherwise have lost entirely.
    const tip = page.getByText(/Ranges can be open-ended/);
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("1990-");
    await expect(tip).toContainText("-1975");
  });

  test("Constitution ID explains what the number is, not just how to filter", async ({ page }) => {
    await openFilters(page);

    await page.getByRole("button", { name: "Help: Constitution ID" }).click();

    await expect(page.getByText(/sequence number of the brother's signature/)).toBeVisible();
  });

  test("the help buttons are distinct from the fields they describe", async ({ page }) => {
    await openFilters(page);

    // Regression guard for the collision this change introduced: the help
    // button's accessible name contains the field's label, so a substring
    // `getByLabel` matches both. Each must remain separately addressable.
    await expect(page.getByRole("textbox", { name: "Class Year" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Help: Class Year" })).toBeVisible();
  });

  test("an open toggle-tip has no axe violations (WCAG 2.2 AA)", async ({ page }) => {
    await openFilters(page);
    await page.getByRole("button", { name: "Help: Class Year" }).click();
    await expect(page.getByText(/Ranges can be open-ended/)).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
