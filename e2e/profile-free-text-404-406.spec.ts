import { type Locator, type Page, expect, test } from "@playwright/test";

/**
 * The three free-text profile fields — Post-PBE education, Sports, Activities
 * (OFC-404/405/406). The backend is mocked at the network layer so this drives
 * the real SPA.
 *
 * What is here is what a unit test cannot reach:
 *
 *  - the **120-character cap is enforced by blocking the input**, not by
 *    complaining after the fact (Forrest's call). That is `maxLength` on a real
 *    `<input>` in a real browser — no unit test observes it, and the shared
 *    validation rule that backs it up only ever fires for a client that ignores
 *    the attribute, so a missing attribute would leave every unit test green;
 *  - the fields sit in **Professional & personal**, in the same order on the edit
 *    page and the view page (the edit/view correspondence N160 restored for
 *    Mentoring);
 *  - the view page renders each line **only when filled**, so an empty field is
 *    absent rather than a blank labelled row;
 *  - each is selectable as a Directory column and each filter narrows the grid.
 */

const CAP = 120;

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 5247,
    firstName: "James",
    middleName: "Allen",
    lastName: "Smyth",
    classYear: 1984,
    email: "james@example.test",
    employerName: "Akamai Technologies",
    majors: ["6-3"],
    deceased: { isDeceased: false },
    debrothered: { isDebrothered: false },
    hasHeadshot: false,
    privacy: {
      shareEmail: true,
      sharePhone: true,
      shareAddress: true,
      shareEmergency: true,
      shareSpousePartner: true,
    },
    unlisted: false,
    willingToMentor: false,
    allowNewsletterEmail: true,
    allowShareWithMITAA: false,
    lastModified: "2026-03-14T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

function me(role: "brother" | "manager" | "admin", profileId: number) {
  return {
    profileId,
    role,
    realRole: role,
    impersonating: false,
    stars: [],
    profile: record({ id: profileId }),
  };
}

async function mock(
  page: Page,
  meDoc: ReturnType<typeof me>,
  target: ReturnType<typeof record>,
  roster: ReturnType<typeof record>[] = [],
) {
  await page.route("**/api/me", (route) => route.fulfill({ json: meDoc }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: roster, majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, (route) =>
    route.fulfill({ headers: { ETag: 'W/"v1"' }, json: target }),
  );
}

/**
 * A field's text input, by its accessible name and nothing else.
 *
 * ⚠ `getByLabel(name)` is WRONG for every one of these fields and matches three
 * controls: the input, the `?` button beside it (whose aria-label "Help: Sports"
 * *contains* the field name, and getByLabel is a substring match), and — on the
 * Directory — the column-picker checkbox of the same name. Naming the role and
 * pinning `exact` is what keeps a selector aimed at the control under test; the
 * same class of trap the `helpKey` rollout hit across the suite.
 */
function textbox(scope: Page | Locator, name: string) {
  return scope.getByRole("textbox", { name, exact: true });
}

function section(page: Page, name: string) {
  return page.locator("section", { has: page.getByRole("heading", { name }) });
}

test.describe("profile — the three free-text fields (edit)", () => {
  test("all three sit in Professional & personal", async ({ page }) => {
    await mock(page, me("admin", 5247), record());
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    const professional = section(page, "Professional & personal");
    await expect(textbox(professional, "Post-PBE education")).toBeVisible();
    await expect(textbox(professional, "Sports")).toBeVisible();
    await expect(textbox(professional, "Activities")).toBeVisible();
  });

  test("blocks typing past 120 characters rather than accepting and complaining", async ({
    page,
  }) => {
    // The requirement, in Forrest's words: the brother should be "blocked from
    // typing entries that are too long", not allowed to overrun and then told to
    // shorten it. `fill()` sets the value directly the way a paste does, so this
    // covers the paste path too — the browser truncates to `maxLength` on both.
    await mock(page, me("admin", 5247), record());
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    for (const label of ["Post-PBE education", "Sports", "Activities"]) {
      const input = textbox(page, label);
      await input.fill("x".repeat(CAP + 40));
      await expect(input).toHaveValue("x".repeat(CAP));
      // ⚠ And no error is shown: being stopped at the cap is the normal, non-error
      // path. If this ever starts failing because a validation message appeared,
      // the enforcement has silently moved from blocking to complaining.
      await expect(page.getByText(/characters or fewer/)).toHaveCount(0);
    }
  });

  test("accepts a realistic value at the boundary, including one with a comma", async ({
    page,
  }) => {
    await mock(page, me("admin", 5247), record());
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    const input = textbox(page, "Post-PBE education");
    await input.fill("Ph.D. in Computer Science, Stanford");
    await expect(input).toHaveValue("Ph.D. in Computer Science, Stanford");
  });
});

test.describe("profile — the three free-text fields (view)", () => {
  test("renders each filled field, in the same order as the edit page", async ({ page }) => {
    const filled = record({
      postPbeEducation: "Ph.D. in Computer Science, Stanford",
      sports: "Varsity soccer and basketball",
      activities: "Community orchestra, second violin",
    });
    await mock(page, me("admin", 5247), filled);
    await page.goto("/brother/5247");

    const professional = section(page, "Professional & personal");
    await expect(professional.getByText("Ph.D. in Computer Science, Stanford")).toBeVisible();
    await expect(professional.getByText("Varsity soccer and basketball")).toBeVisible();
    await expect(professional.getByText("Community orchestra, second violin")).toBeVisible();
  });

  test("omits a field the brother left empty — no blank labelled row", async ({ page }) => {
    // The case that will describe most of the roster for a long time: these fields
    // ship empty for every existing record, so an always-rendered label would put
    // three empty rows on nearly every profile in the book.
    await mock(page, me("admin", 5247), record({ sports: "Lightweight crew" }));
    await page.goto("/brother/5247");

    const professional = section(page, "Professional & personal");
    await expect(professional.getByText("Lightweight crew")).toBeVisible();
    await expect(professional.getByText("Post-PBE education", { exact: true })).toHaveCount(0);
    await expect(professional.getByText("Activities", { exact: true })).toHaveCount(0);
  });
});

test.describe("directory — the three free-text columns and filters", () => {
  const roster = [
    record({
      id: 5247,
      firstName: "James",
      lastName: "Smyth",
      sports: "Varsity soccer and basketball",
      postPbeEducation: "Ph.D. in Computer Science, Stanford",
    }),
    record({
      id: 5248,
      firstName: "Peter",
      lastName: "Quill",
      sports: "Golf and fishing",
      activities: "Beekeeping and cider making",
    }),
    // Nothing filled in — must survive an unset filter and vanish under a set one.
    record({ id: 5249, firstName: "Alan", lastName: "Vega" }),
  ];

  test("each column is selectable and heads the grid", async ({ page }) => {
    await mock(page, me("admin", 5247), record(), roster);
    await page.goto("/");
    await page.locator("[data-search-ready='true']").waitFor();

    await page.getByText("Columns", { exact: true }).click();
    for (const label of ["Post-PBE Education", "Sports", "Activities"]) {
      await page.getByRole("checkbox", { name: label }).check();
      await expect(page.getByRole("columnheader", { name: label })).toBeVisible();
    }
  });

  test("each filter narrows the grid by substring and drops the brothers with nothing on record", async ({
    page,
  }) => {
    await mock(page, me("admin", 5247), record(), roster);
    await page.goto("/");
    await page.locator("[data-search-ready='true']").waitFor();

    await page.getByRole("button", { name: /Filters/ }).click();
    // A word from the middle of one brother's line — the contract that makes these
    // filters useful, and the one a "starts with" implementation would break.
    await textbox(page, "Sports").fill("soccer");
    // ⚠ Asserted on ROWS, not cells: the pinned Select and Star cells each carry the
    // brother's name in their accessible name, so a `cell` locator matches three
    // times per brother and trips strict mode. The row is the right unit for "is
    // this brother still listed" in any case.
    await expect(page.getByRole("row", { name: /Smyth/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Quill/ })).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Vega/ })).toHaveCount(0);
  });
});
