import { readFileSync } from "node:fs";
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
    realRole: role,
    impersonating: false,
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
  // Star writes echo the *resulting* list — as the real endpoint does — so the SPA
  // can reconcile its optimistic set to the server's authoritative array (OFC-103).
  // A static list would be adopted verbatim and undo the toggle, so track state.
  const starred = new Set<number>();
  await page.route("**/api/me/stars/**", (route: Route) => {
    const request = route.request();
    const id = Number(request.url().split("/").pop());
    if (request.method() === "DELETE") {
      starred.delete(id);
    } else {
      starred.add(id);
    }
    return route.fulfill({ json: { stars: [...starred] } });
  });
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
    await page.getByRole("button", { name: /^Export CSV/ }).click();
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
    await expect(page.getByRole("button", { name: /^Export CSV/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.getByLabel("Class Year")).toBeVisible();
    await expect(page.getByLabel("Verification", { exact: true })).toHaveCount(0);
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
    // Course is the first multi-select; open its disclosure and confirm a named
    // option. Each option is now the shared course chip (OFC-265/N106), so the
    // checkbox's accessible name is the chip's "Course <code>, <name>".
    await page.locator("summary").filter({ hasText: "Any" }).first().click();
    await expect(
      page.getByRole("checkbox", { name: /Course 6-3, Computer Science and Engineering/ }),
    ).toBeVisible();
  });

  test("a course chip carries the full course name on hover (title)", async ({ page }) => {
    await gotoDirectory(page);
    await expect(page.getByTitle("6-3 — Computer Science and Engineering")).toBeVisible();
  });

  test("a filter multi-select closes on an outside click and on Escape (N110)", async ({
    page,
  }) => {
    await gotoDirectory(page);
    await page.getByRole("button", { name: /^Filters/ }).click();

    // Open the Course multi-select (the first "Any" disclosure).
    await page.locator("summary").filter({ hasText: "Any" }).first().click();
    await expect(page.locator("details[open]")).toHaveCount(1);

    // A click anywhere outside the open disclosure dismisses it.
    await page.getByRole("heading", { name: "Directory" }).click();
    await expect(page.locator("details[open]")).toHaveCount(0);

    // Re-open, then Escape closes it too.
    await page.locator("summary").filter({ hasText: "Any" }).first().click();
    await expect(page.locator("details[open]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("details[open]")).toHaveCount(0);
  });

  test("staff filters sit under the 'Membership upkeep' divider (admin)", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.getByText(/Membership upkeep/i)).toBeVisible();
    await expect(page.getByLabel("Verification", { exact: true })).toBeVisible();
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

  test("the date filter adopts a dark color-scheme so its calendar icon stays visible", async ({
    page,
  }) => {
    await gotoDirectory(page);
    // The theme toggle moved into the avatar menu (D131) — open it, switch to dark,
    // then close it before reaching for the Filters panel below.
    await page.locator("summary").filter({ hasText: "Dev Admin" }).click();
    await page.getByRole("button", { name: "Dark theme" }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Filters/ }).click();
    const scheme = await page
      .getByLabel("Not verified since", { exact: true })
      .evaluate((el) => getComputedStyle(el).colorScheme);
    expect(scheme).toBe("dark");
  });
});

test.describe("Directory 5.5d — directory state (OFC-194/195/196)", () => {
  test("filters by a one-sided year range (OFC-195)", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("button", { name: /^Filters/ }).click();
    // Target the input by role: once a value is present a same-named "Clear Class
    // Year" button also appears, so getByLabel would match two elements.
    const year = page.getByRole("textbox", { name: "Class Year" });

    // "1988-" → 1988 and later: William (1988) and Dev (1990); Aaron (1984) drops.
    await year.fill("1988-");
    await expect(page.getByRole("rowheader", { name: /William Webster/ })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Dev Admin/ })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toHaveCount(0);

    // "-1984" → 1984 and earlier: only Aaron among the living (Grace is deceased-hidden).
    await year.fill("-1984");
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Dev Admin/ })).toHaveCount(0);
  });

  test("selection persists across a filter change and the export includes off-view picks (OFC-196)", async ({
    page,
  }) => {
    await gotoDirectory(page);
    await page.route("**/api/exports", (route) => route.fulfill({ status: 204, body: "" }));

    // Select Aaron (1984).
    await page.getByRole("checkbox", { name: /^Select Aaron Adams/ }).check();
    await expect(page.getByRole("button", { name: /Export CSV \(1 selected\)/ })).toBeVisible();

    // Filter to 1988 — Aaron leaves the view, but the selection survives (the D41 reversal).
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByLabel("Class Year").fill("1988");
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Export CSV \(1 selected\)/ })).toBeVisible();

    // Add the now-visible William to build a disjoint set spanning two filters.
    await page.getByRole("checkbox", { name: /^Select William Webster/ }).check();
    await expect(page.getByRole("button", { name: /Export CSV \(2 selected\)/ })).toBeVisible();

    // Export while Aaron is still filtered out: the CSV must include him anyway.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Export CSV/ }).click();
    const csv = readFileSync(await (await downloadPromise).path(), "utf8");
    expect(csv).toContain("Adams"); // the off-view pick
    expect(csv).toContain("Webster"); // the visible pick
  });

  test("Clear selection empties the whole selection (OFC-196)", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("checkbox", { name: /^Select Aaron Adams/ }).check();
    await expect(page.getByRole("button", { name: /Export CSV \(1 selected\)/ })).toBeVisible();
    await page.getByRole("button", { name: /Clear selection/ }).click();
    await expect(page.getByRole("button", { name: /^Export CSV$/ })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /^Select Aaron Adams/ })).not.toBeChecked();
  });

  test("selection survives navigating to a profile and back (OFC-196)", async ({ page }) => {
    await gotoDirectory(page);
    await page.route(/\/api\/profiles\/\d+$/, (route) =>
      route.fulfill({
        headers: { ETag: 'W/"v1"' },
        json: {
          id: 5001,
          firstName: "Aaron",
          lastName: "Adams",
          classYear: 1984,
          majors: ["6-3"],
          deceased: { isDeceased: false },
          debrothered: { isDebrothered: false },
          unlisted: false,
          hasHeadshot: false,
          privacy: {
            shareEmail: true,
            sharePhone: true,
            shareAddress: true,
            shareEmergency: false,
            shareSpousePartner: false,
          },
        },
      }),
    );

    await page.getByRole("checkbox", { name: /^Select Aaron Adams/ }).check();
    // Open Aaron's profile, then browser-Back — an SPA popstate, not a full reload.
    await page
      .getByRole("link", { name: /Aaron Adams/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/brother\/5001/);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    // The selection lives in a context above the route, so it outlived the remount.
    await expect(page.getByRole("checkbox", { name: /^Select Aaron Adams/ })).toBeChecked();
  });

  test("the masthead logo is a clean slate: clears Starred-only and the selection (OFC-194)", async ({
    page,
  }) => {
    await gotoDirectory(page);
    // Build transient state: star Aaron, restrict to Starred-only, select Aaron.
    await page.getByRole("button", { name: /^Star Aaron Adams/ }).click();
    await page.getByRole("checkbox", { name: "Starred only" }).check();
    await expect(page.getByRole("rowheader", { name: /William Webster/ })).toHaveCount(0);
    await page.getByRole("checkbox", { name: /^Select Aaron Adams/ }).check();
    await expect(page.getByRole("button", { name: /Export CSV \(1 selected\)/ })).toBeVisible();

    // Click the masthead crest + wordmark — "home, fresh".
    await page.getByRole("link", { name: "PBE Address Book" }).click();

    // Starred-only is off (William is back) and the selection is cleared.
    await expect(page.getByRole("checkbox", { name: "Starred only" })).not.toBeChecked();
    await expect(page.getByRole("rowheader", { name: /William Webster/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Export CSV$/ })).toBeVisible();
  });

  test("the masthead clears Starred-only after visiting a profile (OFC-194 exact repro)", async ({
    page,
  }) => {
    await gotoDirectory(page);
    await page.route(/\/api\/profiles\/\d+$/, (route) =>
      route.fulfill({
        headers: { ETag: 'W/"v1"' },
        json: {
          id: 5001,
          firstName: "Aaron",
          lastName: "Adams",
          classYear: 1984,
          deceased: { isDeceased: false },
          debrothered: { isDebrothered: false },
          unlisted: false,
          hasHeadshot: false,
          privacy: {
            shareEmail: true,
            sharePhone: true,
            shareAddress: true,
            shareEmergency: false,
            shareSpousePartner: false,
          },
        },
      }),
    );

    // The reported path: star a brother, restrict to Starred-only, open that
    // brother's profile, then click the masthead to come home.
    await page.getByRole("button", { name: /^Star Aaron Adams/ }).click();
    await page.getByRole("checkbox", { name: "Starred only" }).check();
    await page
      .getByRole("link", { name: /Aaron Adams/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/brother\/5001/);

    await page.getByRole("link", { name: "PBE Address Book" }).click();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    // The Directory returns clean: Starred-only off, the un-starred William visible.
    await expect(page.getByRole("checkbox", { name: "Starred only" })).not.toBeChecked();
    await expect(page.getByRole("rowheader", { name: /William Webster/ })).toBeVisible();
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
