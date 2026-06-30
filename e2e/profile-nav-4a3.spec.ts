import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Profile navigation & the unsaved guard (Phase 4a-3; DECISIONS N33, OFC-65).
 * On the data router, this exercises the real SPA's navigation model end to end:
 *
 *  - the unified `useBlocker` unsaved-changes guard (Back + in-app links),
 *  - the no-anachronistic-history edit model (Edit pushes one entry; Save/Cancel
 *    pop it, so Back from the view always reaches the Directory),
 *  - the "← Directory" affordance and the masthead logo "home" link,
 *  - and the dropped redundant post-save GET.
 *
 * The backend is mocked at the network layer (`/api/me`, the `/api/profiles`
 * list, and the stateful single-record GET/PATCH).
 */

/** The fake exemplar, James Smyth '84 (#5247) — a full owner record. */
function ownerRecord() {
  return {
    id: 5247,
    firstName: "James",
    middleName: "Allen",
    lastName: "Smyth",
    fullLegalName: "James Allen Smyth",
    mugName: "Smitty",
    classYear: 1984,
    email: "james@example.test",
    phone: "+1 (617) 555-0142",
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
    lastVerifiedDate: "2026-03-14",
    verifiedBy: 5247,
    lastModified: "2026-03-14T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-03-14T12:00:00.000Z",
  };
}

// The caller is the owner of #5247, so the Edit button and editable consent show.
const ME = {
  profileId: 5247,
  role: "brother" as const,
  realRole: "brother" as const,
  impersonating: false,
  stars: [],
  profile: ownerRecord(),
};

// A small directory list (brother projection) that includes the exemplar, so a
// row click lands on the editable record.
const LIST = {
  profiles: [
    { id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984, deceased: { isDeceased: false }, hasHeadshot: false },
    { id: 5300, firstName: "Aaron", lastName: "Adams", classYear: 1980, deceased: { isDeceased: false }, hasHeadshot: false },
    { id: 5301, firstName: "Carl", lastName: "Young", classYear: 1990, deceased: { isDeceased: false }, hasHeadshot: false },
  ],
  majors: [],
};

/**
 * Wire the mocks. Returns a `getCount` reader for the single-record GET so a test
 * can assert that a save does NOT trigger a redundant refetch.
 */
async function mock(page: Page): Promise<{ getCount: () => number }> {
  const state = { record: ownerRecord(), etag: 'W/"v1"' };
  let getCount = 0;

  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: LIST }));
  await page.route(/\/api\/profiles\/\d+$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      state.record = { ...state.record, ...body, lastVerifiedDate: "2026-06-30" };
      state.etag = 'W/"v2"';
      return route.fulfill({ headers: { ETag: state.etag }, json: state.record });
    }
    getCount += 1;
    return route.fulfill({ headers: { ETag: state.etag }, json: state.record });
  });

  return { getCount: () => getCount };
}

async function gotoDirectory(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

/** Open the exemplar's profile by clicking its Directory row link. */
async function openFromDirectory(page: Page) {
  await page.getByRole("rowheader", { name: /James Smyth/ }).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: /James Smyth/ })).toBeVisible();
}

/** Enter edit mode from the view and make the form dirty. */
async function startEditing(page: Page) {
  await page.getByRole("link", { name: "Edit profile" }).click();
  await expect(page.getByText("Editing", { exact: true })).toBeVisible();
  await page.getByLabel("First name").fill("Jim");
}

test.describe("profile navigation (4a-3)", () => {
  test("no anachronistic history: Back from a saved profile reaches the Directory", async ({
    page,
  }) => {
    await mock(page);
    await gotoDirectory(page);
    await openFromDirectory(page);

    await startEditing(page);
    await page.getByRole("button", { name: "Save changes" }).click();

    // Save lands on the display (popping the edit entry), shows the new value + toast.
    await expect(page).toHaveURL(/\/brother\/5247$/);
    await expect(page.getByRole("heading", { level: 1, name: /Jim Smyth/ })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Saved");

    // The headline of N33: one Back from the display reaches the Directory, never a
    // stale edit page — no matter that we went display→edit→save.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("saving does not refetch the profile (the redundant GET is gone)", async ({ page }) => {
    const { getCount } = await mock(page);
    await gotoDirectory(page);
    await openFromDirectory(page);
    expect(getCount()).toBe(1); // the single load on open

    await startEditing(page); // view↔edit shares the container — no GET
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Jim Smyth/ })).toBeVisible();

    // The PATCH response populated the record; popping back to the view reuses it.
    expect(getCount()).toBe(1);
  });

  test("an in-app navigation away from a dirty edit is blocked, then honored on confirm", async ({
    page,
  }) => {
    await mock(page);
    await gotoDirectory(page);
    await openFromDirectory(page);
    await startEditing(page);

    // Click the masthead "home" link — an in-app navigation the blocker catches.
    await page.getByRole("link", { name: /PBE Address Book/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // "Keep editing" reverts the navigation and preserves the edit.
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(/\/brother\/5247\/edit$/);
    await expect(page.getByLabel("First name")).toHaveValue("Jim");

    // Trying again and discarding lets the navigation through to the home (Directory).
    await page.getByRole("link", { name: /PBE Address Book/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
  });

  test("the browser Back button is guarded on a dirty edit", async ({ page }) => {
    await mock(page);
    await gotoDirectory(page);
    await openFromDirectory(page);
    await startEditing(page);

    await page.goBack();
    // The blocker intercepts the POP: the dialog shows and we stay in edit.
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(/\/brother\/5247\/edit$/);
    await expect(page.getByLabel("First name")).toHaveValue("Jim");
  });

  test("the '← Directory' affordance returns to the directory", async ({ page }) => {
    await mock(page);
    await gotoDirectory(page);
    await openFromDirectory(page);

    await page.getByRole("button", { name: /Directory/ }).click();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("a cold deep-link's '← Directory' falls back to the Directory home", async ({ page }) => {
    await mock(page);
    await page.goto("/brother/5247");
    await expect(page.getByRole("heading", { level: 1, name: /James Smyth/ })).toBeVisible();

    await page.getByRole("button", { name: /Directory/ }).click();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
  });

  test("the masthead logo returns to the Directory home from a profile", async ({ page }) => {
    await mock(page);
    await page.goto("/brother/5247");
    await expect(page.getByRole("heading", { level: 1, name: /James Smyth/ })).toBeVisible();

    await page.getByRole("link", { name: /PBE Address Book/ }).click();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("the profile view (reached from the directory) has no a11y violations (axe, WCAG 2.2 AA)", async ({
    page,
  }) => {
    await mock(page);
    await gotoDirectory(page);
    await openFromDirectory(page);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
