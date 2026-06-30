import AxeBuilder from "@axe-core/playwright";
import { type Page, type Route, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The Profile page **special controls** (Phase 4b-1, N36): the majors chip editor,
 * the Big-Brother typeahead with derived Little Brothers, the country-driven
 * address block, and the progressive-disclosure repeatables (links + emergency
 * contacts). The backend is mocked at the network layer — `/api/me`, the bulk
 * `GET /api/profiles` roster (which feeds the typeahead and the reverse Little-
 * Brother edge), and `GET`/`PATCH /api/profiles/:id` — so this drives the real SPA
 * and gates the edit page on WCAG 2.2 AA (D79).
 */

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
    address: {
      street1: "114 Memorial Drive",
      city: "Cambridge",
      stateProvince: "MA",
      postalCode: "02142",
      country: "US",
    },
    emergencyContacts: [{ name: "Susan Smyth", phone: "(617) 555-0188", email: "" }],
    employerName: "Akamai Technologies",
    jobTitle: "Principal Engineer",
    majors: ["6-3", "2"],
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

function me(role: "brother" | "manager" | "admin", profileId: number) {
  return {
    profileId,
    role,
    realRole: role,
    impersonating: false,
    stars: [],
    profile: ownerRecord(),
  };
}

/** A small brother-projected roster: a candidate Big Brother and a derived Little Brother. */
function roster() {
  return [
    { id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 },
    { id: 5001, firstName: "Robert", lastName: "Brown", classYear: 1979 },
    { id: 5103, firstName: "Carl", lastName: "Adams", classYear: 1985 },
    { id: 5400, firstName: "Tom", lastName: "Wills", classYear: 1990, bigBrotherId: 5247 },
  ];
}

async function mockProfile(
  page: Page,
  options: {
    meDoc: ReturnType<typeof me>;
    record: ReturnType<typeof ownerRecord>;
    patch?: (route: Route, body: Record<string, unknown>) => boolean;
    onPatch?: (body: Record<string, unknown>) => void;
  },
) {
  const state = { record: options.record, etag: 'W/"v1"' };
  await page.route("**/api/me", (route) => route.fulfill({ json: options.meDoc }));
  // The bulk roster (no trailing id) — feeds the typeahead + Little Brothers.
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: roster(), majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      options.onPatch?.(body);
      if (options.patch?.(route, body)) {
        return;
      }
      state.record = { ...state.record, ...body, lastVerifiedDate: "2026-06-30" };
      state.etag = 'W/"v2"';
      return route.fulfill({ headers: { ETag: state.etag }, json: state.record });
    }
    return route.fulfill({ headers: { ETag: state.etag }, json: state.record });
  });
}

async function gotoEdit(page: Page) {
  await page.goto("/brother/5247/edit");
  await expect(page.getByText("Editing", { exact: true })).toBeVisible();
}

test.describe("profile 4b-1 — majors chip editor", () => {
  test("adds a course from the combobox and removes a chip", async ({ page }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);

    // Add Mathematics (Course 18) via the typeahead.
    await page.getByRole("combobox", { name: "Add a course" }).fill("Math");
    await page.getByRole("option", { name: /Course 18/ }).click();
    await expect(page.getByRole("button", { name: /Remove Course 18/ })).toBeVisible();

    // Remove Course 2.
    await page.getByRole("button", { name: /Remove Course 2, Mechanical/ }).click();
    await expect(page.getByRole("button", { name: /Remove Course 2, Mechanical/ })).toHaveCount(0);
  });

  test("reorders a chip with the keyboard (arrow moves it)", async ({ page }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);

    // 6-3 starts first (position 1 of 2); ArrowRight moves it to position 2.
    const grip = page.getByRole("button", { name: /Reorder Course 6-3.*position 1 of 2/ });
    await grip.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("button", { name: /Reorder Course 6-3.*position 2 of 2/ }),
    ).toBeVisible();
  });
});

test.describe("profile 4b-1 — Big Brother & Little Brothers", () => {
  test("derives the read-only Little Brothers from the roster", async ({ page }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);
    await expect(page.getByText("Little Brothers")).toBeVisible();
    await expect(page.getByRole("link", { name: /Tom Wills '90/ })).toBeVisible();
  });

  test("sets a Big Brother via the typeahead and saves the pointer", async ({ page }) => {
    let saved: Record<string, unknown> | null = null;
    await mockProfile(page, {
      meDoc: me("brother", 5247),
      record: ownerRecord(),
      onPatch: (body) => {
        saved = body;
      },
    });
    await gotoEdit(page);

    await page.getByRole("combobox", { name: /Search for a Big Brother/ }).fill("Brown");
    await page.getByRole("option", { name: /Robert Brown '79/ }).click();
    // The pick becomes a chip linking to his profile.
    await expect(page.getByRole("link", { name: /Robert Brown '79/ })).toBeVisible();

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/brother\/5247$/);
    expect(saved).toMatchObject({ bigBrotherId: 5001 });
  });
});

test.describe("profile 4b-1 — country-driven address", () => {
  test("clears an invalid subdivision when the country changes, with a note", async ({ page }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);

    // US → Canada: Massachusetts isn't a Canadian province, so it clears with a note.
    await page.getByLabel("Country").selectOption("CA");
    await expect(page.getByText(/didn't match the new country/)).toBeVisible();
    await expect(page.getByLabel("State / Province", { exact: true })).toHaveValue("");
  });

  test("switches the subdivision to free text for a non-US/CA country", async ({ page }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);

    await page.getByLabel("Country").selectOption("GB");
    // The controlled dropdown gives way to a free-text region field.
    await expect(page.getByLabel(/State \/ Province \/ Region/)).toBeVisible();
  });
});

test.describe("profile 4b-1 — repeatables", () => {
  test("progressively discloses a link row, fills it, and saves", async ({ page }) => {
    let saved: Record<string, unknown> | null = null;
    await mockProfile(page, {
      meDoc: me("brother", 5247),
      record: ownerRecord(),
      onPatch: (body) => {
        saved = body;
      },
    });
    await gotoEdit(page);

    await page.getByRole("button", { name: "Add a link" }).click();
    await page.getByLabel("Label").fill("LinkedIn");
    await page.getByLabel("URL").fill("https://www.linkedin.com/in/jsmyth");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/brother\/5247$/);
    expect(saved).toMatchObject({
      links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/jsmyth" }],
    });
  });

  test("adds the second emergency contact, then the Add control disappears at the cap", async ({
    page,
  }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);

    await page.getByRole("button", { name: "Add an emergency contact" }).click();
    await expect(page.getByText("Secondary")).toBeVisible();
    // One filled + one freshly-added blank row = the cap of 2; Add is gone.
    await expect(page.getByRole("button", { name: "Add an emergency contact" })).toHaveCount(0);
  });
});

test.describe("profile 4b-1 — accessibility", () => {
  test("the edit form with all special controls has no axe violations (WCAG 2.2 AA)", async ({
    page,
  }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);
    await expect(page.getByText("Little Brothers")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
