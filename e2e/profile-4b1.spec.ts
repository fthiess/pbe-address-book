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
    // A "William" so the Big-Brother typeahead can prove nickname matching (Bill → William).
    { id: 5222, firstName: "William", lastName: "Hayes", classYear: 1982 },
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

  test("finds a Big Brother by nickname — the same Name Search the Directory uses (Bill → William)", async ({
    page,
  }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);

    // "Bill" is not a substring of "William" — only the worker's nickname
    // expansion (D123), shared with the Directory, surfaces William Hayes. The
    // option appears once the worker is ready (Playwright retries until then).
    await page.getByRole("combobox", { name: /Search for a Big Brother/ }).fill("Bill");
    await expect(page.getByRole("option", { name: /William Hayes '82/ })).toBeVisible();
  });

  test("a newly-set Big Brother shows the brother as a Little Brother on his page", async ({
    page,
  }) => {
    // Little Brothers are *derived* from the cached roster, so a save must patch
    // that cache or the Big Brother's page would still show the pre-save edge.
    const records: Record<number, ReturnType<typeof ownerRecord>> = {
      5247: ownerRecord(),
      5001: {
        ...ownerRecord(),
        id: 5001,
        firstName: "Robert",
        lastName: "Brown",
        fullLegalName: "Robert Brown",
        classYear: 1979,
        majors: [],
        emergencyContacts: undefined,
      } as ReturnType<typeof ownerRecord>,
    };
    await page.route("**/api/me", (route) => route.fulfill({ json: me("brother", 5247) }));
    await page.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: roster(), majors: [] } }),
    );
    await page.route(/\/api\/profiles\/\d+$/, async (route) => {
      const id = Number(
        route
          .request()
          .url()
          .match(/\/profiles\/(\d+)/)?.[1],
      );
      const current = records[id] ?? ownerRecord();
      if (route.request().method() === "PATCH") {
        const body = JSON.parse(route.request().postData() ?? "{}");
        records[id] = { ...current, ...body, lastVerifiedDate: "2026-06-30" };
        return route.fulfill({ headers: { ETag: 'W/"v2"' }, json: records[id] });
      }
      return route.fulfill({ headers: { ETag: 'W/"v1"' }, json: current });
    });

    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: /Search for a Big Brother/ }).fill("Brown");
    await page.getByRole("option", { name: /Robert Brown '79/ }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/brother\/5247$/);

    // Follow the Big-Brother chip to Robert's profile; it now lists James beneath
    // Little Brothers (computed from the patched roster, no second download).
    await page.getByRole("link", { name: /Robert Brown '79/ }).click();
    await expect(page).toHaveURL(/\/brother\/5001$/);
    await expect(page.getByRole("heading", { level: 1, name: /Robert Brown/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /James Smyth '84/ })).toBeVisible();
  });
});

test.describe("profile 4b-1 — country-driven address", () => {
  test("clears an invalid subdivision when the country changes, with a note", async ({ page }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);

    // US → Canada: Massachusetts isn't a Canadian province, so it clears with a note.
    await page.getByLabel("Country").selectOption("CA");
    await expect(page.getByText(/didn't match the new country/)).toBeVisible();
    await expect(page.getByLabel("State/Province", { exact: true })).toHaveValue("");
  });

  test("switches to a free-text region for a non-US/CA country and drops the stranded code", async ({
    page,
  }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);

    // US "MA" → United Kingdom: the controlled dropdown gives way to a free-text
    // region field, and the now-meaningless "MA" is cleared (not left behind).
    await page.getByLabel("Country").selectOption("GB");
    const region = page.getByLabel(/State\/Province\/Region/);
    await expect(region).toBeVisible();
    await expect(region).toHaveValue("");
    await expect(page.getByText(/didn't match the new country/)).toBeVisible();
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
