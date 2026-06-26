import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The signed-in walking-skeleton directory. The backend is mocked at the network
 * layer (`/api/me` + `/api/profiles`), so this exercises the real SPA rendering
 * — the shell, role badge, own-row marker, and the rendered list — and gates the
 * page on WCAG 2.2 AA (D79) without standing up the API and emulator.
 */
const ME = {
  profileId: 5002,
  role: "admin" as const,
  stars: [],
  profile: {
    id: "fake-5002",
    constitutionId: 5002,
    canonicalName: "Dev Admin",
    firstName: "Dev",
    lastName: "Admin",
    classYear: 1990,
    email: "admin@example.test",
    city: "Cambridge",
    state: "MA",
    country: "USA",
    deceased: false,
    unlisted: false,
    allowDirectoryEmail: true,
    headshotVersion: null,
  },
};

const PROFILES = {
  profiles: [
    {
      id: "fake-5001",
      constitutionId: 5001,
      canonicalName: "Aaron Adams",
      firstName: "Aaron",
      lastName: "Adams",
      classYear: 1984,
      city: "Boston",
      state: "MA",
      country: "USA",
      deceased: false,
      headshotVersion: null,
      email: "aaron.adams@example.test",
    },
    {
      id: "fake-5002",
      constitutionId: 5002,
      canonicalName: "Dev Admin",
      firstName: "Dev",
      lastName: "Admin",
      classYear: 1990,
      city: "Cambridge",
      state: "MA",
      country: "USA",
      deceased: false,
      headshotVersion: null,
    },
  ],
  majors: [],
};

test.describe("signed-in directory", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
    await page.route("**/api/profiles", (route) => route.fulfill({ json: PROFILES }));
  });

  test("renders the shell, role badge, and the brother list", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page.getByText("Admin", { exact: true })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    // The caller's own row carries the "You" marker (the split-read overlay, D82).
    await expect(page.getByRole("rowheader", { name: /Dev Admin/ })).toContainText("You");
  });

  test("name search filters the list", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    await page.getByRole("searchbox", { name: /search brothers/i }).fill("aaron");
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Dev Admin/ })).toHaveCount(0);
  });

  test("has no detectable accessibility violations (axe, WCAG 2.2 AA)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
