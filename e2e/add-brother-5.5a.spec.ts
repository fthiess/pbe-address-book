import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The Add Brother essentials step (Phase 5.5a; OFC-201). The backend is mocked at
 * the network layer: `/api/me` sets the role, the bulk `/api/profiles` GET backs the
 * roster, and the `POST /api/profiles` returns 201 (or 409). Proves the client half
 * — the admin-only gate, the required-fields validation, the create call, and the
 * hand-off to the regular edit page — while the server-side create (Ghost-first,
 * projection, audit) is proven in the API unit + emulator suites.
 */

const OWN_ID = 5001;
const NEW_ID = 6001;

function meDoc(role: "admin" | "brother") {
  return {
    profileId: OWN_ID,
    role,
    realRole: role,
    impersonating: false,
    stars: [] as number[],
    profile: {
      id: OWN_ID,
      firstName: "Dev",
      lastName: role === "admin" ? "Admin" : "Brother",
      classYear: 1990,
      email: "user@example.test",
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

/** The record the edit page pulls after a successful create. */
const createdRecord = {
  id: NEW_ID,
  firstName: "Fred",
  lastName: "Newman",
  classYear: 2001,
  email: "fred.newman@example.test",
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
  allowNewsletterEmail: false,
  allowShareWithMITAA: false,
  lastModified: "2026-07-10T12:00:00.000Z",
  newsletterConsentChangedAt: "2026-07-10T12:00:00.000Z",
};

interface CreateMocks {
  /** The parsed body of the POST, once it fires. */
  posted: () => Record<string, unknown> | null;
}

/** Wire the auth + roster + create mocks; `postStatus` shapes the create response. */
async function gotoNew(
  page: Page,
  role: "admin" | "brother",
  postStatus: 201 | 409 = 201,
): Promise<CreateMocks> {
  let posted: Record<string, unknown> | null = null;
  await page.route("**/api/me", (route) => route.fulfill({ json: meDoc(role) }));
  await page.route("**/api/banner", (route) => route.fulfill({ json: { active: false } }));
  await page.route("**/api/profiles", (route) => {
    if (route.request().method() === "POST") {
      posted = JSON.parse(route.request().postData() ?? "{}");
      if (postStatus === 409) {
        return route.fulfill({ status: 409, json: { error: "conflict" } });
      }
      return route.fulfill({ status: 201, headers: { ETag: '"1.0"' }, json: createdRecord });
    }
    return route.fulfill({ json: { profiles: [meDoc(role).profile], majors: [] } });
  });
  // The edit page the happy path hands off to pulls the freshly created record.
  await page.route(`**/api/profiles/${NEW_ID}`, (route) =>
    route.fulfill({ headers: { ETag: '"1.0"' }, json: createdRecord }),
  );
  await page.goto("/brother/new");
  return { posted: () => posted };
}

/** Fill the four text essentials with a valid new brother. */
async function fillEssentials(page: Page) {
  await page.fill("#new-constitutionId", String(NEW_ID));
  await page.fill("#new-firstName", "Fred");
  await page.fill("#new-lastName", "Newman");
  await page.fill("#new-classYear", "2001");
  await page.fill("#new-email", "fred.newman@example.test");
}

test.describe("Add Brother essentials (5.5a)", () => {
  test("redirects a non-admin to the Directory", async ({ page }) => {
    await gotoNew(page, "brother");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Add Brother" })).toHaveCount(0);
  });

  test("shows the required-fields + two-step note and passes an axe scan", async ({ page }) => {
    await gotoNew(page, "admin");
    await expect(page.getByRole("heading", { name: "Add Brother" })).toBeVisible();
    await expect(page.getByText("All fields are required.")).toBeVisible();
    await expect(
      page.getByText(/full profile page to optionally add other details/i),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test("creates a brother and hands off to the edit page", async ({ page }) => {
    const mocks = await gotoNew(page, "admin");
    await fillEssentials(page);
    await page.getByRole("button", { name: "Create brother" }).click();

    // Lands on the regular edit page for the new brother.
    await expect(page).toHaveURL(new RegExp(`/brother/${NEW_ID}/edit$`));
    await expect(page.getByText("Editing")).toBeVisible();

    // The POST carried exactly the essentials the admin entered.
    expect(mocks.posted()).toMatchObject({
      id: NEW_ID,
      firstName: "Fred",
      lastName: "Newman",
      classYear: 2001,
      email: "fred.newman@example.test",
    });
  });

  test("blocks an empty submit with inline errors and makes no create call", async ({ page }) => {
    const mocks = await gotoNew(page, "admin");
    await page.getByRole("button", { name: "Create brother" }).click();

    // The id error ("…a positive whole number") appears only as validation output.
    await expect(page.getByText(/positive whole number/i)).toBeVisible();
    // Still on the create page; nothing was posted.
    await expect(page).toHaveURL(/\/brother\/new$/);
    expect(mocks.posted()).toBeNull();
  });

  test("surfaces a duplicate Constitution id (409) on the id field", async ({ page }) => {
    await gotoNew(page, "admin", 409);
    await fillEssentials(page);
    await page.getByRole("button", { name: "Create brother" }).click();

    await expect(
      page.getByText("A brother with that Constitution id already exists."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/brother\/new$/);
  });
});
