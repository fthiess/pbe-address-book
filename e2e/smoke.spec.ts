import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The signed-out path. With `/api/me` answering 401, the SPA shows the sign-in
 * screen. The production preview build is scanned, so `import.meta.env.DEV` is
 * false and the dev role switcher is correctly absent. The a11y scan gates on
 * WCAG 2.2 AA (D79).
 */
test.describe("signed-out", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/me", (route) =>
      route.fulfill({ status: 401, json: { error: "unauthenticated" } }),
    );
  });

  test("shows the sign-in screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("PBE Address Book");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("sign-in screen has no detectable accessibility violations (axe, WCAG 2.2 AA)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
