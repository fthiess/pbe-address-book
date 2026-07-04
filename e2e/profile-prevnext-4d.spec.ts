import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Prev/next-through-the-Directory navigation (Phase 4d, OFC-67 / DECISIONS N45).
 * Against the mocked backend, this drives the real SPA's data-router navigation:
 *
 *  - the three Directory entry points stash the displayed (search ∩ filter ∩
 *    sort) id-list, so the Profile page can step Prev/Next through it;
 *  - "← Directory" pops the whole `directoryDelta` chain back to the true
 *    Directory entry (not just one step) after a Prev/Next walk;
 *  - a stale stashed id shows the not-found state with prev/next still working
 *    (no auto-skip); and
 *  - a cold deep-link hides the prev/next controls (graceful degradation).
 *
 * The default sort is Canonical Name ascending, so the fixed three-row list
 * orders Adams (5300) → Smyth (5247) → Young (5301) — positions 1/2/3 of 3.
 */

function baseRecord(id: number, firstName: string, lastName: string, classYear: number) {
  return {
    id,
    firstName,
    lastName,
    classYear,
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
    lastModified: "2026-03-14T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-03-14T12:00:00.000Z",
  };
}

const RECORDS: Record<number, ReturnType<typeof baseRecord>> = {
  5300: baseRecord(5300, "Aaron", "Adams", 1980),
  5247: baseRecord(5247, "James", "Smyth", 1984),
  5301: baseRecord(5301, "Carl", "Young", 1990),
};

// The caller is an ordinary brother viewing the directory (no edit affordances
// needed for these tests).
const ME = {
  profileId: 5247,
  role: "brother" as const,
  realRole: "brother" as const,
  impersonating: false,
  stars: [],
  profile: RECORDS[5247],
};

const LIST = {
  profiles: Object.values(RECORDS).map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    classYear: r.classYear,
    deceased: { isDeceased: false },
    hasHeadshot: false,
  })),
  majors: [],
};

/**
 * Wire the mocks. `stale` holds ids whose single-record GET returns 404 (a record
 * that stopped resolving between stash and click — deleted/unlisted/etc.).
 */
async function mock(page: Page, stale: Set<number> = new Set()) {
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: LIST }));
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    const id = Number(
      route
        .request()
        .url()
        .match(/\/(\d+)$/)?.[1],
    );
    if (stale.has(id) || !RECORDS[id]) {
      return route.fulfill({ status: 404, json: { error: "not_found" } });
    }
    return route.fulfill({ headers: { ETag: 'W/"v1"' }, json: RECORDS[id] });
  });
}

async function gotoDirectory(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

/** Open a brother's profile by clicking its Directory row link. */
async function openRow(page: Page, lastName: string) {
  await page
    .getByRole("rowheader", { name: new RegExp(lastName) })
    .getByRole("link")
    .click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(lastName) })).toBeVisible();
}

test.describe("prev/next through the directory (4d)", () => {
  test("steps forward and back through the displayed set, disabling the ends", async ({ page }) => {
    await mock(page);
    await gotoDirectory(page);
    await openRow(page, "Adams");

    // First in the set: Prev disabled, position 1 of 3.
    await expect(page.getByText("1 of 3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous brother" })).toBeDisabled();

    await page.getByRole("button", { name: "Next brother" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();
    await expect(page.getByText("2 of 3")).toBeVisible();

    await page.getByRole("button", { name: "Next brother" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Young/ })).toBeVisible();
    await expect(page.getByText("3 of 3")).toBeVisible();
    // Last in the set: Next disabled.
    await expect(page.getByRole("button", { name: "Next brother" })).toBeDisabled();

    // Prev walks back.
    await page.getByRole("button", { name: "Previous brother" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();
    await expect(page.getByText("2 of 3")).toBeVisible();
  });

  test("'← Directory' pops the whole prev/next chain back to the Directory", async ({ page }) => {
    await mock(page);
    await gotoDirectory(page);
    await openRow(page, "Adams"); // delta 1

    await page.getByRole("button", { name: "Next brother" }).click(); // → Smyth, delta 2
    await expect(page.getByText("2 of 3")).toBeVisible();
    await page.getByRole("button", { name: "Next brother" }).click(); // → Young, delta 3
    await expect(page.getByText("3 of 3")).toBeVisible();

    // navigate(-3) lands on the Directory entry itself — not one profile back
    // (which would still show a profile heading).
    await page.getByRole("button", { name: /Directory/ }).click();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("a stale stashed id shows not-found with prev/next still working (no auto-skip)", async ({
    page,
  }) => {
    // Young (5301) has gone stale since the stash was taken.
    await mock(page, new Set([5301]));
    await gotoDirectory(page);
    await openRow(page, "Smyth"); // 2 of 3

    await page.getByRole("button", { name: "Next brother" }).click(); // → 5301, now 404
    await expect(page.getByRole("heading", { name: "Brother not found" })).toBeVisible();
    // The controls persist (the id is still a member of the stashed set), so the
    // user can step past it, and the position readout still orients them.
    await expect(page.getByText("3 of 3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next brother" })).toBeDisabled();

    await page.getByRole("button", { name: "Previous brother" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();
  });

  test("a cold deep-link hides the prev/next controls but keeps ← Directory", async ({ page }) => {
    await mock(page);
    await page.goto("/brother/5247");
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();

    await expect(page.getByRole("button", { name: "Next brother" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Previous brother" })).toHaveCount(0);
    // ← Directory still works (falls back to the Directory home).
    await page.getByRole("button", { name: /Directory/ }).click();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
  });

  test("the profile view with the prev/next bar has no a11y violations (axe, WCAG 2.2 AA)", async ({
    page,
  }) => {
    await mock(page);
    await gotoDirectory(page);
    await openRow(page, "Adams");
    await expect(page.getByRole("button", { name: "Next brother" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
