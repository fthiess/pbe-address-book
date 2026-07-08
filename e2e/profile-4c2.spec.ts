import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The 4c-2 privileged-action UI (API-SPEC §3–§5; DECISIONS N40/N41/N44): the
 * verify affordance, the guided mark-deceased flow, de-brother/reinstate, change
 * role, and delete — plus an axe 2.2 AA pass on the mark-deceased dialog. The
 * backend is mocked at the network layer; an **admin** views **another** brother
 * (#5247), so the whole Staff-controls surface renders.
 */

function targetRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 5247,
    firstName: "James",
    lastName: "Smyth",
    classYear: 1984,
    email: "james@example.test",
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
    lastModified: "2026-03-14T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

/** Mock the admin session + the profile surface + the 4c-2 endpoints. */
async function mockAdminViewing(page: Page, record = targetRecord()) {
  const calls = { verify: 0, deceased: 0, debrother: 0, role: 0, del: 0 };

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        profileId: 5001,
        role: "admin",
        realRole: "admin",
        impersonating: false,
        stars: [],
        profile: { ...targetRecord(), id: 5001, firstName: "Ada", lastName: "Admin" },
      },
    }),
  );
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [record], majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+\/verify$/, (route) => {
    calls.verify += 1;
    return route.fulfill({
      headers: { ETag: 'W/"v2"' },
      json: { lastVerifiedDate: "2026-07-03", verifiedBy: 5001 },
    });
  });
  await page.route(/\/api\/profiles\/\d+\/deceased$/, (route) => {
    calls.deceased += 1;
    return route.fulfill({
      headers: { ETag: 'W/"v2"' },
      json: {
        ...record,
        deceased: { isDeceased: true, deathYear: 2026 },
        allowNewsletterEmail: false,
      },
    });
  });
  await page.route(/\/api\/profiles\/\d+\/debrothered$/, (route) => {
    calls.debrother += 1;
    return route.fulfill({
      headers: { ETag: 'W/"v2"' },
      json: {
        ...record,
        debrothered: { isDebrothered: true, debrotheredAt: "2026-07-03T00:00:00Z" },
      },
    });
  });
  await page.route(/\/api\/users\/\d+\/role$/, (route) => {
    // GET is the Role control reading the current role on mount; PUT applies a change.
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { id: 5247, role: "brother" } });
    }
    calls.role += 1;
    const body = JSON.parse(route.request().postData() ?? "{}");
    return route.fulfill({ json: { id: 5247, role: body.role } });
  });
  // GET the single record, and DELETE it.
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    if (route.request().method() === "DELETE") {
      calls.del += 1;
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ headers: { ETag: 'W/"v1"' }, json: record });
  });

  return calls;
}

async function gotoProfile(page: Page) {
  await page.goto("/brother/5247");
  await expect(page.getByRole("heading", { name: /James Smyth/ })).toBeVisible();
}

test.describe("profile 4c-2 — privileged actions", () => {
  test("an admin sees the Staff controls and can mark a record verified", async ({ page }) => {
    const calls = await mockAdminViewing(page);
    await gotoProfile(page);

    await expect(page.getByRole("heading", { name: "Staff controls" })).toBeVisible();

    await page.getByRole("button", { name: "Mark as verified" }).click();
    await expect(page.getByText("Marked as verified.")).toBeVisible();
    expect(calls.verify).toBe(1);
  });

  test("the guided mark-deceased flow confirms, reveals the fields, and submits", async ({
    page,
  }) => {
    const calls = await mockAdminViewing(page);
    await gotoProfile(page);

    await page.getByRole("button", { name: "Mark as deceased…" }).click();

    // Phase 1: a pure confirmation — no fields yet. (The dialog's accessible name is
    // "Mark <canonical name> as deceased", which carries the class year — so match on
    // the sole open dialog rather than the full string.)
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: /Mark .* as deceased/ })).toBeVisible();
    await expect(dialog.getByLabel("Death year (if the date is unknown)")).toHaveCount(0);

    // Axe 2.2 AA with the mark-deceased dialog open (a native <dialog>, so its role
    // is implicit — scan the whole page rather than a `[role="dialog"]` include).
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);

    // Continue → the fields appear and take focus.
    await dialog.getByRole("button", { name: "Continue" }).click();
    const deathYear = dialog.getByLabel("Death year (if the date is unknown)");
    await expect(deathYear).toBeVisible();
    await deathYear.fill("2026");
    await dialog.getByRole("button", { name: "Mark as deceased" }).click();

    await expect(page.getByText("Marked as deceased.")).toBeVisible();
    expect(calls.deceased).toBe(1);
  });

  test("an admin can de-brother a member with a confirmation", async ({ page }) => {
    const calls = await mockAdminViewing(page);
    await gotoProfile(page);

    await page.getByRole("button", { name: "De-brother…" }).click();
    const dialog = page.getByRole("dialog", { name: "De-brother this member?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "De-brother", exact: true }).click();

    await expect(page.getByText("Brother de-brothered.")).toBeVisible();
    expect(calls.debrother).toBe(1);
  });

  test("an admin can change a brother's role via the segmented control", async ({ page }) => {
    const calls = await mockAdminViewing(page);
    await gotoProfile(page);

    // The current role (brother) is fetched and highlighted; the control is a
    // segmented Brother/Manager/Administrator toggle (visual-design Profile.dc.html).
    const group = page.getByRole("group", { name: "Role" });
    await expect(group.getByRole("button", { name: "Brother" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await group.getByRole("button", { name: "Manager" }).click();

    await expect(page.getByText("Role set to Manager.")).toBeVisible();
    await expect(group.getByRole("button", { name: "Manager" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(calls.role).toBe(1);
  });

  test("an admin can delete a brother and returns to the Directory", async ({ page }) => {
    const calls = await mockAdminViewing(page);
    await gotoProfile(page);

    await page.getByRole("button", { name: "Delete brother…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this brother?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete permanently" }).click();

    await expect(page).toHaveURL(/\/$|\/#?$/);
    expect(calls.del).toBe(1);
  });
});
