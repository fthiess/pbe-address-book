import AxeBuilder from "@axe-core/playwright";
import { type Page, type Route, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The Directory's Phase-3c behaviours, against the mocked backend: the universal
 * Star column and "Starred only" toggle (D39), the Include-deceased toggle (D36),
 * the structured filter panel (D38), the manager/admin Select column + action bar
 * with CSV export (D41/D92), and double-click/Enter auto-fit (N27). Role-gating
 * (Select/Export/staff filters are staff-only) is checked from a brother session.
 */

function meFor(role: "admin" | "brother") {
  return {
    profileId: 5002,
    role,
    stars: [] as number[],
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
}

const PROFILES = {
  profiles: [
    {
      id: 5001,
      firstName: "Aaron",
      lastName: "Adams",
      classYear: 1984,
      majors: ["6-3"],
      deceased: { isDeceased: false },
      hasHeadshot: false,
      email: "aaron.adams@example.test",
    },
    {
      id: 5003,
      firstName: "Grace",
      lastName: "Abbott",
      classYear: 1979,
      majors: ["18"],
      deceased: { isDeceased: true },
      hasHeadshot: false,
    },
    {
      id: 5002,
      firstName: "Dev",
      lastName: "Admin",
      classYear: 1990,
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
    {
      id: 5006,
      firstName: "William",
      lastName: "Webster",
      classYear: 1988,
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
  ],
  majors: [],
};

async function gotoDirectory(page: Page, role: "admin" | "brother" = "admin") {
  await page.route("**/api/me", (route) => route.fulfill({ json: meFor(role) }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: PROFILES }));
  await page.route("**/img/thumbnails/**", (route) => route.fulfill({ status: 404 }));
  // Star writes echo the resulting list; the SPA toggles optimistically regardless.
  await page.route("**/api/me/stars/**", (route: Route) => route.fulfill({ json: { stars: [] } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

test.describe("Directory 3c — stars", () => {
  test("the Star column toggles optimistically (D39)", async ({ page }) => {
    await gotoDirectory(page);
    const star = page.getByRole("button", { name: /^Star Aaron Adams/ });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    // Optimistic flip: the control reflects the new state immediately.
    await expect(page.getByRole("button", { name: /^Starred: Aaron Adams/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("'Starred only' restricts the view and prompts when empty", async ({ page }) => {
    await gotoDirectory(page);
    // With nothing starred, the toggle shows the friendly empty prompt.
    await page.getByRole("checkbox", { name: "Starred only" }).check();
    await expect(page.getByText(/haven't starred anyone yet/i)).toBeVisible();

    // Star one brother, and only he remains.
    await page.getByRole("checkbox", { name: "Starred only" }).uncheck();
    await page.getByRole("button", { name: /^Star Aaron Adams/ }).click();
    await page.getByRole("checkbox", { name: "Starred only" }).check();
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /William Webster/ })).toHaveCount(0);
  });
});

test.describe("Directory 3c — deceased & filters", () => {
  test("deceased are hidden by default and revealed by the toggle (D36)", async ({ page }) => {
    await gotoDirectory(page);
    await expect(page.getByRole("rowheader", { name: /Grace Abbott/ })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Include deceased" }).check();
    await expect(page.getByRole("rowheader", { name: /Grace Abbott/ })).toBeVisible();
    await expect(page).toHaveURL(/deceased=true/);
  });

  test("the filter panel filters by Class Year and Reset clears it (D38)", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByLabel("Class Year").fill("1984");
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Dev Admin/ })).toHaveCount(0);
    await expect(page.getByText("1 active")).toBeVisible();

    await page.getByRole("button", { name: /Reset search & filters/ }).click();
    await expect(page.getByRole("rowheader", { name: /Dev Admin/ })).toBeVisible();
  });

  test("a numeric-grammar typo is flagged inline, not dropped (§5.6.4)", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByLabel("Class Year").fill("198x");
    await expect(page.getByText(/Couldn't read: 198x/)).toBeVisible();
  });
});

test.describe("Directory 3c — selection, export, auto-fit (admin)", () => {
  test("Export downloads a CSV and fires the audit ping (D41/D92)", async ({ page }) => {
    await gotoDirectory(page);
    let pinged = false;
    await page.route("**/api/exports", (route) => {
      pinged = true;
      return route.fulfill({ status: 204, body: "" });
    });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export CSV/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^pbe-directory-\d{4}-\d{2}-\d{2}\.csv$/);
    await expect.poll(() => pinged).toBe(true);
  });

  test("select-all scopes the export to the current view", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("checkbox", { name: /select all brothers/i }).check();
    // The Export label reflects the selection count.
    await expect(page.getByRole("button", { name: /Export CSV \(\d+ selected\)/ })).toBeVisible();
  });

  test("Add Brother navigates to the new-profile route", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("link", { name: "Add Brother" }).click();
    await expect(page).toHaveURL(/\/brother\/new$/);
  });

  test("double-click and Enter auto-fit a column (N27)", async ({ page }) => {
    await gotoDirectory(page);
    const resizer = page.getByRole("separator", { name: /resize the email column/i });
    const width = async () =>
      (await page.getByRole("columnheader").filter({ hasText: "Email" }).first().boundingBox())
        ?.width ?? 0;

    // Widen well past the data, then auto-fit via Enter — it snaps back smaller.
    await resizer.focus();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("ArrowRight");
    }
    const widened = await width();
    await page.keyboard.press("Enter");
    await expect.poll(width).toBeLessThan(widened);
  });
});

test.describe("Directory 3c — role gating", () => {
  test("a brother sees no Select column, action bar, or staff filters", async ({ page }) => {
    await gotoDirectory(page, "brother");
    // The universal Star column is present...
    await expect(page.getByRole("button", { name: /^Star Aaron Adams/ })).toBeVisible();
    // ...but the staff-only surfaces are not.
    await expect(page.getByRole("checkbox", { name: /select all brothers/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Export CSV/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.getByLabel("Class Year")).toBeVisible();
    await expect(page.getByLabel("Verification")).toHaveCount(0);
  });
});

test.describe("Directory 3c — follow-up fixes", () => {
  test("a row Select checkbox toggles without opening the profile", async ({ page }) => {
    await gotoDirectory(page);
    const box = page.getByRole("checkbox", { name: /^Select Aaron Adams/ });
    await box.check();
    await expect(box).toBeChecked();
    // The selection click must NOT have navigated to the profile (the bug).
    await expect(page).not.toHaveURL(/\/brother\//);
    // ...and the selection feeds the export scope.
    await expect(page.getByRole("button", { name: /Export CSV \(1 selected\)/ })).toBeVisible();
  });

  test("a filter field's clear button empties it", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("button", { name: /^Filters/ }).click();
    const year = page.getByLabel("Class Year");
    await year.fill("1984");
    await page.getByRole("button", { name: "Clear Class Year" }).click();
    await expect(year).toHaveValue("");
  });

  test("the Course filter shows the course name, not just the code", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("button", { name: /^Filters/ }).click();
    // Course is the first multi-select; open its disclosure and confirm a named option.
    await page.locator("summary").filter({ hasText: "Any" }).first().click();
    await expect(
      page.getByRole("checkbox", { name: /6-3 — Computer Science and Engineering/ }),
    ).toBeVisible();
  });

  test("a course chip carries the full course name on hover (title)", async ({ page }) => {
    await gotoDirectory(page);
    await expect(page.getByTitle("6-3 — Computer Science and Engineering")).toBeVisible();
  });

  test("staff filters sit under the 'Membership upkeep' divider (admin)", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.getByText(/Membership upkeep/i)).toBeVisible();
    await expect(page.getByLabel("Verification")).toBeVisible();
  });

  test("the Photo column has no resize separator (fixed width)", async ({ page }) => {
    await gotoDirectory(page);
    await expect(page.getByRole("separator", { name: /resize the photo/i })).toHaveCount(0);
    // The data columns are still resizable.
    await expect(page.getByRole("separator", { name: /resize the email/i })).toBeVisible();
  });

  test("the Name Search box uses the same custom clear control as the filters", async ({
    page,
  }) => {
    await gotoDirectory(page);
    const search = page.getByRole("searchbox", { name: /name search/i });
    await search.fill("webster");
    // The custom clear button (shared with the filters) appears and clears it.
    await page.getByRole("button", { name: /clear name search/i }).click();
    await expect(search).toHaveValue("");
  });
});

test.describe("Directory 3c — accessibility", () => {
  test("the open filter panel has no axe violations (WCAG 2.2 AA)", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByLabel("Class Year").fill("1984");
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
