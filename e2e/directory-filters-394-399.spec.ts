import { type Page, expect, test } from "@playwright/test";

/**
 * The filter panel's header-row **Reset** (OFC-394) and the three filters added by
 * OFC-399 — Deceased for everyone, Unlisted and De-brothered for staff.
 *
 * The Reset assertions deliberately never open the Filters fold: reaching the
 * control *without* opening it is the entire change, so a test that opened it
 * first would pass just as well against the old layout.
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

/**
 * Four brothers, one per state the new filters select on. The staff-internal flags
 * are present on every record, as the manager/admin projection sends them — a
 * brother's roster would simply omit both the flags and the hidden records.
 */
const PROFILES = {
  profiles: [
    {
      id: 5001,
      firstName: "Aaron",
      lastName: "Adams",
      classYear: 1984,
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      unlisted: false,
      hasHeadshot: false,
    },
    {
      id: 5002,
      firstName: "Dev",
      lastName: "Admin",
      classYear: 1990,
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      unlisted: false,
      hasHeadshot: false,
    },
    {
      id: 5003,
      firstName: "Grace",
      lastName: "Abbott",
      classYear: 1979,
      deceased: { isDeceased: true },
      debrothered: { isDebrothered: false },
      unlisted: false,
      hasHeadshot: false,
    },
    {
      id: 5004,
      firstName: "Ulric",
      lastName: "Unlisted",
      classYear: 1995,
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      unlisted: true,
      hasHeadshot: false,
    },
    {
      id: 5005,
      firstName: "Dexter",
      lastName: "Dropped",
      classYear: 1999,
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: true },
      unlisted: false,
      hasHeadshot: false,
    },
  ],
  majors: [],
};

async function gotoDirectory(page: Page, role: "admin" | "brother" = "admin", url = "/") {
  await page.route("**/api/me", (route) => route.fulfill({ json: meFor(role) }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: PROFILES }));
  await page.route("**/img/thumbnails/**", (route) => route.fulfill({ status: 404 }));
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

const resetButton = (page: Page) => page.getByRole("button", { name: /Reset search & filters/ });
const filtersFold = (page: Page) => page.getByRole("button", { name: /^Filters/ });
const row = (page: Page, name: RegExp) => page.getByRole("rowheader", { name });

test.describe("OFC-394 — Reset lives on the Filters header row", () => {
  test("clears a filter without the fold ever being opened", async ({ page }) => {
    // The filter arrives through the URL, so the panel is never touched — exactly
    // the state a brother returns to from a profile.
    await gotoDirectory(page, "admin", "/?classYear=1984");
    await expect(row(page, /Aaron Adams/)).toBeVisible();
    await expect(row(page, /Dev Admin/)).toHaveCount(0);

    // The fold is still collapsed, and Reset is nonetheless on screen and usable.
    await expect(filtersFold(page)).toHaveAttribute("aria-expanded", "false");
    await resetButton(page).click();

    await expect(row(page, /Dev Admin/)).toBeVisible();
    await expect(filtersFold(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("is enabled by a search alone, and clears it (the broadened test)", async ({ page }) => {
    // The regression the move exposed: `activeCount` counts only the structured
    // filters, so a view narrowed purely by the search box left Reset greyed out —
    // invisible while the button was buried in the fold, and the first thing you
    // would reach for once it is not.
    await gotoDirectory(page, "admin", "/?q=Aaron");
    await expect(resetButton(page)).toBeEnabled();
    await resetButton(page).click();
    await expect(page.getByRole("searchbox")).toHaveValue("");
    await expect(row(page, /Dev Admin/)).toBeVisible();
  });

  test("is enabled by 'Include deceased' alone", async ({ page }) => {
    await gotoDirectory(page, "admin", "/?deceased=true");
    await expect(resetButton(page)).toBeEnabled();
    await resetButton(page).click();
    await expect(page.getByRole("checkbox", { name: "Include deceased" })).not.toBeChecked();
  });

  test("is enabled by a non-default sort alone", async ({ page }) => {
    await gotoDirectory(page, "admin", "/?sort=classYear&dir=desc");
    await expect(resetButton(page)).toBeEnabled();
  });

  test("is disabled on a pristine view", async ({ page }) => {
    await gotoDirectory(page);
    await expect(resetButton(page)).toBeDisabled();
  });

  test("the disclosure and Reset are siblings, not nested", async ({ page }) => {
    // Nested interactive elements are invalid HTML and hide the inner control from
    // assistive tech; the header layout exists to keep them apart.
    await gotoDirectory(page, "admin", "/?q=Aaron");
    await expect(filtersFold(page).locator("button")).toHaveCount(0);
    await expect(resetButton(page).locator("button")).toHaveCount(0);
  });
});

test.describe("OFC-399 — Deceased filter (all roles, D171)", () => {
  test("shows only the deceased WITHOUT 'Include deceased' being ticked", async ({ page }) => {
    // The whole point of D171. Before the override this combination was the empty
    // set, because the living-only default is applied after the filter predicate.
    await gotoDirectory(page);
    await expect(page.getByRole("checkbox", { name: "Include deceased" })).not.toBeChecked();

    await filtersFold(page).click();
    await page.getByLabel("Deceased", { exact: true }).selectOption("yes");

    await expect(row(page, /Grace Abbott/)).toBeVisible();
    await expect(row(page, /Aaron Adams/)).toHaveCount(0);
    await expect(row(page, /Dev Admin/)).toHaveCount(0);
    // Still unticked — the filter carries its own inclusion rather than flipping
    // the toggle behind the user's back.
    await expect(page.getByRole("checkbox", { name: "Include deceased" })).not.toBeChecked();
  });

  test("is offered to an ordinary brother — the flag is public", async ({ page }) => {
    await gotoDirectory(page, "brother");
    await filtersFold(page).click();
    await expect(page.getByLabel("Deceased", { exact: true })).toBeVisible();
  });

  test("survives a round trip through the URL under its own key", async ({ page }) => {
    // `deceasedOnly`, never `deceased` — that key belongs to the D36 toggle, and a
    // collision would have had the two controls overwriting each other.
    await gotoDirectory(page);
    await filtersFold(page).click();
    await page.getByLabel("Deceased", { exact: true }).selectOption("yes");
    await expect(page).toHaveURL(/deceasedOnly=yes/);
    await expect(page).not.toHaveURL(/[?&]deceased=/);
  });

  test("leaves the 'Include deceased' toggle independently operable", async ({ page }) => {
    await gotoDirectory(page, "admin", "/?deceasedOnly=yes");
    await expect(row(page, /Grace Abbott/)).toBeVisible();
    // Ticking the toggle must not be swallowed by the filter's own inclusion.
    await page.getByRole("checkbox", { name: "Include deceased" }).check();
    await expect(page).toHaveURL(/deceased=true/);
    await expect(page).toHaveURL(/deceasedOnly=yes/);
    // The filter still narrows: the living are excluded by the predicate, not by
    // the default the toggle just lifted.
    await expect(row(page, /Aaron Adams/)).toHaveCount(0);
  });
});

test.describe("OFC-399 — Unlisted and De-brothered (staff only)", () => {
  test("an admin can gather the unlisted records", async ({ page }) => {
    await gotoDirectory(page);
    await filtersFold(page).click();
    await page.getByLabel("Unlisted", { exact: true }).selectOption("yes");
    await expect(row(page, /Ulric Unlisted/)).toBeVisible();
    await expect(row(page, /Aaron Adams/)).toHaveCount(0);
  });

  test("an admin can gather the de-brothered records", async ({ page }) => {
    await gotoDirectory(page);
    await filtersFold(page).click();
    await page.getByLabel("De-brothered", { exact: true }).selectOption("yes");
    await expect(row(page, /Dexter Dropped/)).toBeVisible();
    await expect(row(page, /Aaron Adams/)).toHaveCount(0);
  });

  test("a brother is offered neither — filterable ⟺ visible", async ({ page }) => {
    await gotoDirectory(page, "brother");
    await filtersFold(page).click();
    await expect(page.getByLabel("Unlisted", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("De-brothered", { exact: true })).toHaveCount(0);
  });

  test("all three count toward the panel's active badge", async ({ page }) => {
    await gotoDirectory(page, "admin", "/?deceasedOnly=yes&unlisted=yes&debrothered=yes");
    await expect(page.getByText("3 active")).toBeVisible();
  });
});
