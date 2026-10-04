import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The PL-5 admin-lifecycle confirmations (D191). Three warnings in front of actions
 * the server keeps accepting:
 *
 * - **OFC-295** — an administrator changing their OWN email is told sign-in links
 *   move to the new address, and the PATCH is withheld until they confirm.
 * - **OFC-419** — an administrator demoting THEMSELVES confirms first; cancelling
 *   leaves the role untouched and sends nothing.
 * - **OFC-242** — the mark-deceased, de-brother and remove-email confirmations say
 *   so when the record holds the Administrator role, which the action strands.
 *
 * Drives the real SPA with the backend mocked at the network layer. Record #5247 is
 * the page under test; `selfId` decides whether the signed-in admin owns it.
 */

function targetRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 5247,
    firstName: "James",
    lastName: "Smyth",
    classYear: 1984,
    email: "james@example.test",
    role: "admin",
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

async function mockAdmin(
  page: Page,
  options: {
    /** The signed-in admin's own profile id; 5247 makes the page their own record. */
    selfId: number;
    record?: ReturnType<typeof targetRecord>;
    /** The session's effective role — `brother` models "View as brother" (N31). */
    effectiveRole?: "brother" | "admin";
  },
) {
  const state = { record: options.record ?? targetRecord(), etag: 'W/"v1"' };
  const calls = { patches: [] as Record<string, unknown>[], roles: [] as string[] };
  const effective = options.effectiveRole ?? "admin";

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        profileId: options.selfId,
        role: effective,
        realRole: "admin",
        impersonating: effective !== "admin",
        stars: [],
        profile: { ...targetRecord(), id: options.selfId },
      },
    }),
  );
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [state.record], majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+\/role$/, (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    calls.roles.push(body.role);
    return route.fulfill({ json: { id: 5247, role: body.role } });
  });
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    if (route.request().method() === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      calls.patches.push(body);
      state.record = { ...state.record, ...body };
      state.etag = 'W/"v2"';
    }
    return route.fulfill({ headers: { ETag: state.etag }, json: state.record });
  });
  return calls;
}

async function gotoProfile(page: Page) {
  await page.goto("/brother/5247");
  await expect(page.getByRole("heading", { name: /James Smyth/ })).toBeVisible();
}

async function gotoEdit(page: Page) {
  await page.goto("/brother/5247/edit");
  await expect(page.getByText("Editing", { exact: true })).toBeVisible();
}

const emailField = (page: Page) => page.getByLabel("Email", { exact: true });
const save = (page: Page) => page.getByRole("button", { name: "Save changes" });
const ownEmailDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Change your own email address?" });
const selfDemotionDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Remove your own administrator access?" });
const strandedRoleNote = /will keep the Administrator role/;

test.describe("OFC-295 — an administrator changing their own email", () => {
  test("prompts with the new address, and withholds the PATCH until confirmed", async ({
    page,
  }) => {
    const calls = await mockAdmin(page, { selfId: 5247 });
    await gotoEdit(page);

    await emailField(page).fill("jim@example.test");
    await save(page).click();

    const dialog = ownEmailDialog(page);
    await expect(dialog).toBeVisible();
    // The address is read back, so a typo is in front of the admin before it is saved.
    await expect(dialog).toContainText("jim@example.test");
    expect(calls.patches).toEqual([]);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);

    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/brother\/5247$/);
    expect(calls.patches).toHaveLength(1);
    expect(calls.patches[0]).toHaveProperty("email", "jim@example.test");
  });

  test("Keep editing aborts: nothing is sent and the edit is kept", async ({ page }) => {
    const calls = await mockAdmin(page, { selfId: 5247 });
    await gotoEdit(page);

    await emailField(page).fill("jim@example.test");
    await save(page).click();
    await ownEmailDialog(page).getByRole("button", { name: "Keep editing" }).click();

    await expect(ownEmailDialog(page)).toHaveCount(0);
    await expect(emailField(page)).toHaveValue("jim@example.test");
    expect(calls.patches).toEqual([]);
  });

  test("still prompts under “View as brother” — it keys on the stored role", async ({ page }) => {
    await mockAdmin(page, { selfId: 5247, effectiveRole: "brother" });
    await gotoEdit(page);

    await emailField(page).fill("jim@example.test");
    await save(page).click();
    await expect(ownEmailDialog(page)).toBeVisible();
  });

  test("no prompt for a case-only change — sign-in resolves the same address", async ({ page }) => {
    const calls = await mockAdmin(page, { selfId: 5247 });
    await gotoEdit(page);

    await emailField(page).fill("James@Example.test");
    await save(page).click();

    await expect(page).toHaveURL(/\/brother\/5247$/);
    expect(calls.patches).toHaveLength(1);
  });

  test("no prompt when an administrator changes ANOTHER administrator's email", async ({
    page,
  }) => {
    const calls = await mockAdmin(page, { selfId: 5001 });
    await gotoEdit(page);

    await emailField(page).fill("jim@example.test");
    await save(page).click();

    await expect(page).toHaveURL(/\/brother\/5247$/);
    expect(calls.patches).toHaveLength(1);
  });
});

test.describe("OFC-419 — an administrator demoting themselves", () => {
  test("confirms first; Cancel leaves the role untouched and sends nothing", async ({ page }) => {
    const calls = await mockAdmin(page, { selfId: 5247 });
    await gotoProfile(page);

    const group = page.getByRole("group", { name: "Role" });
    await group.getByRole("button", { name: "Manager" }).click();

    const dialog = selfDemotionDialog(page);
    await expect(dialog).toBeVisible();
    expect(calls.roles).toEqual([]);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(group.getByRole("button", { name: "Administrator" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(calls.roles).toEqual([]);
  });

  test("confirming applies the demotion", async ({ page }) => {
    const calls = await mockAdmin(page, { selfId: 5247 });
    await gotoProfile(page);

    await page
      .getByRole("group", { name: "Role" })
      .getByRole("button", { name: "Brother" })
      .click();
    await selfDemotionDialog(page).getByRole("button", { name: "Remove my access" }).click();

    await expect(page.getByText("Role set to Brother.")).toBeVisible();
    expect(calls.roles).toEqual(["brother"]);
  });

  test("no prompt when demoting ANOTHER administrator", async ({ page }) => {
    const calls = await mockAdmin(page, { selfId: 5001 });
    await gotoProfile(page);

    await page
      .getByRole("group", { name: "Role" })
      .getByRole("button", { name: "Manager" })
      .click();

    await expect(page.getByText("Role set to Manager.")).toBeVisible();
    await expect(selfDemotionDialog(page)).toHaveCount(0);
    expect(calls.roles).toEqual(["manager"]);
  });
});

test.describe("OFC-242 — the stranded-role note on the three transitions", () => {
  test("mark deceased: shown for an administrator's record", async ({ page }) => {
    await mockAdmin(page, { selfId: 5001 });
    await gotoProfile(page);

    await page.getByRole("button", { name: "Mark as deceased…" }).click();
    await expect(page.getByRole("dialog")).toContainText(strandedRoleNote);
  });

  test("de-brother: shown for an administrator's record", async ({ page }) => {
    await mockAdmin(page, { selfId: 5001 });
    await gotoProfile(page);

    await page.getByRole("button", { name: "De-brother…" }).click();
    await expect(page.getByRole("dialog", { name: "De-brother this member?" })).toContainText(
      strandedRoleNote,
    );
  });

  test("remove email: shown for an administrator's record", async ({ page }) => {
    await mockAdmin(page, { selfId: 5001 });
    await gotoEdit(page);

    await emailField(page).fill("");
    await save(page).click();
    await expect(page.getByRole("dialog", { name: /email address\?$/ })).toContainText(
      strandedRoleNote,
    );
  });

  test("follows a role change made on the same visit, in both directions", async ({ page }) => {
    // The role control's reply must reach the record the dialogs read: without that
    // the note would describe the role the brother held when the page loaded.
    await mockAdmin(page, { selfId: 5001 });
    await gotoProfile(page);
    const group = page.getByRole("group", { name: "Role" });
    const debrother = page.getByRole("dialog", { name: "De-brother this member?" });

    await group.getByRole("button", { name: "Brother" }).click();
    await expect(page.getByText("Role set to Brother.")).toBeVisible();
    await page.getByRole("button", { name: "De-brother…" }).click();
    await expect(debrother).toContainText("This can be reversed.");
    await expect(debrother).not.toContainText(strandedRoleNote);
    await debrother.getByRole("button", { name: "Cancel" }).click();

    await group.getByRole("button", { name: "Administrator" }).click();
    await expect(page.getByText("Role set to Administrator.")).toBeVisible();
    await page.getByRole("button", { name: "De-brother…" }).click();
    await expect(debrother).toContainText(strandedRoleNote);
  });

  // Administrators only, by Forrest's call (D191): a manager's role is stranded the
  // same way, but that is deliberately not warned about.
  for (const role of ["brother", "manager"] as const) {
    test(`absent from all three for a ${role}'s record`, async ({ page }) => {
      await mockAdmin(page, { selfId: 5001, record: targetRecord({ role }) });
      await gotoProfile(page);

      await page.getByRole("button", { name: "Mark as deceased…" }).click();
      const deceased = page.getByRole("dialog");
      await expect(deceased).toContainText("In Memoriam");
      await expect(deceased).not.toContainText(strandedRoleNote);
      await deceased.getByRole("button", { name: "Cancel" }).click();

      await page.getByRole("button", { name: "De-brother…" }).click();
      const debrother = page.getByRole("dialog", { name: "De-brother this member?" });
      await expect(debrother).toContainText("This can be reversed.");
      await expect(debrother).not.toContainText(strandedRoleNote);
      await debrother.getByRole("button", { name: "Cancel" }).click();

      await gotoEdit(page);
      await emailField(page).fill("");
      await save(page).click();
      const email = page.getByRole("dialog", { name: /email address\?$/ });
      await expect(email).toContainText("until a new email");
      await expect(email).not.toContainText(strandedRoleNote);
    });
  }
});
