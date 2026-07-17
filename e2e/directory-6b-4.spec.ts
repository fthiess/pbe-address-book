import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Phase 6b-4 — the Directory-page UI batch. Network-mocks `/api/me` +
 * `/api/profiles` (like directory.spec.ts) so the real SPA renders against
 * fixed fixtures, and asserts the five tickets:
 *
 *  - OFC-269: the Course column shows ALL of a brother's courses as chips, in
 *    order (primary first), not just the primary.
 *  - OFC-265: the Course filter picker renders each option as the same course
 *    chip used elsewhere, keeping the course description.
 *  - OFC-266: the Staff filter option reads "PBE Address Book Managers and
 *    Administrators".
 *  - OFC-267: the newsletter filter is labelled "Subscribed to PBE News".
 *  - OFC-262: the header row's background fills the space to the right of the
 *    last column (a presentational, aria-hidden spacer header cell).
 *
 * ME is an admin so the staff-only filters (newsletter) are present.
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

const PROFILES = {
  profiles: [
    // A DOUBLE-major brother, primary first — exercises OFC-269 (all courses)
    // and seeds the OFC-265 filter options with two distinct courses.
    {
      id: 5001,
      firstName: "Aaron",
      lastName: "Adams",
      classYear: 1984,
      majors: ["6-3", "18"],
      deceased: { isDeceased: false },
      hasHeadshot: false,
      email: "aaron.adams@example.test",
    },
    // A single-major brother (the common case).
    {
      id: 5003,
      firstName: "Bob",
      lastName: "Acker",
      classYear: 2001,
      majors: ["2"],
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
    // The caller's own row (no courses — exercises the em-dash placeholder).
    {
      id: 5002,
      firstName: "Dev",
      lastName: "Admin",
      classYear: 1990,
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
  ],
  majors: [],
};

async function gotoDirectory(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: PROFILES }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

/** Opens the Filters disclosure and returns the Course filter's <details>. */
async function openCourseFilter(page: Page) {
  await page.getByRole("button", { name: "Filters" }).click();
  // The Course multiselect is the only <details> carrying a course description
  // (present in the DOM even while collapsed); the grid shows chips, not names.
  const courseField = page.locator("details", {
    has: page.getByText("Computer Science and Engineering"),
  });
  await courseField.locator("summary").click();
  return courseField;
}

test.describe("directory 6b-4 — UI batch", () => {
  test("OFC-269: the Course column shows all of a brother's courses as chips, in order", async ({
    page,
  }) => {
    await gotoDirectory(page);

    const row = page.getByRole("row").filter({ hasText: "Aaron Adams" });
    // Both courses render as chips (identified by their accessible names), where
    // the old behaviour showed only the primary "6-3".
    await expect(row.getByLabel("Course 6-3, Computer Science and Engineering")).toBeVisible();
    await expect(row.getByLabel("Course 18, Mathematics")).toBeVisible();
    await expect(row.getByLabel(/^Course /)).toHaveCount(2);

    // A brother with no courses still gets the em-dash placeholder, not a chip.
    const ownRow = page.getByRole("row").filter({ hasText: "Dev Admin" });
    await expect(ownRow.getByLabel(/^Course /)).toHaveCount(0);
  });

  test("OFC-269 (mobile cards): a brother's card shows all courses as chips", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDirectory(page);

    const card = page.getByRole("listitem").filter({ hasText: "Aaron Adams" });
    await expect(card.getByLabel("Course 6-3, Computer Science and Engineering")).toBeVisible();
    await expect(card.getByLabel("Course 18, Mathematics")).toBeVisible();
    await expect(card.getByLabel(/^Course /)).toHaveCount(2);
  });

  test("OFC-265: the Course filter renders chips beside the course descriptions", async ({
    page,
  }) => {
    await gotoDirectory(page);
    const courseField = await openCourseFilter(page);

    // Each option is the shared course chip (accessible name "Course <code>, …")
    // followed by the still-present course description.
    await expect(
      courseField.getByLabel("Course 6-3, Computer Science and Engineering"),
    ).toBeVisible();
    await expect(courseField.getByText("Computer Science and Engineering")).toBeVisible();
    await expect(courseField.getByLabel("Course 18, Mathematics")).toBeVisible();
    await expect(courseField.getByText("Mathematics")).toBeVisible();

    // The checkbox is still operable and drives the filter (keyboard-native input).
    await courseField.getByRole("checkbox").first().check();
    await expect(courseField.getByRole("checkbox").first()).toBeChecked();
  });

  test("OFC-266 / OFC-267: filter labels are self-explanatory", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("button", { name: "Filters" }).click();

    await expect(
      page.locator("option", { hasText: "PBE Address Book Managers and Administrators" }),
    ).toHaveCount(1);
    // The newsletter filter is staff-only; ME is an admin, so it is present.
    await expect(page.getByText("Subscribed to PBE News")).toBeVisible();
  });

  test("OFC-262: a presentational spacer fills the header background past the last column", async ({
    page,
  }) => {
    await gotoDirectory(page);
    const filler = page.locator('thead th[aria-hidden="true"]');
    await expect(filler).toHaveCount(1);
    // It carries the header fill, not the general grid background.
    await expect(filler).toHaveClass(/bg-secondary/);
  });

  test("the Course filter picker with chips has no WCAG 2.2 AA violations", async ({ page }) => {
    await gotoDirectory(page);
    await openCourseFilter(page);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
