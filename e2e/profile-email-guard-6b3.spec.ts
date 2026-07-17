import AxeBuilder from "@axe-core/playwright";
import { type Page, type Route, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The 6b-3 email-clear confirmation (OFC-272). Clearing a brother's only sign-in
 * credential locks them out of both the Address Book and PBE News, so a Save that
 * removes a previously-set email must raise an "are you sure" dialog first — on
 * every edit path (self, manager, admin). This drives the real SPA with the backend
 * mocked at the network layer, asserts the PATCH is withheld until the user
 * confirms, gates the open dialog on WCAG 2.2 AA (D79), and covers the graceful
 * last-admin refusal (409 → specific banner, the N86 client-mapping gap this closed).
 */

function targetRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 5247,
    firstName: "James",
    lastName: "Smyth",
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
    allowShareWithMITAA: false,
    lastModified: "2026-03-14T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

/** The session doc. `selfId === 5247` is the self-edit path; otherwise staff-on-other. */
function meDoc(role: "brother" | "manager" | "admin", selfId: number) {
  return {
    profileId: selfId,
    role,
    realRole: role,
    impersonating: false,
    stars: [],
    profile: { ...targetRecord(), id: selfId, firstName: "Ada", lastName: "Admin" },
  };
}

async function mockProfile(
  page: Page,
  options: {
    me: ReturnType<typeof meDoc>;
    record?: ReturnType<typeof targetRecord>;
    onPatch?: (body: Record<string, unknown>) => void;
    patch?: (route: Route, body: Record<string, unknown>) => boolean;
  },
) {
  const state = { record: options.record ?? targetRecord(), etag: 'W/"v1"' };
  await page.route("**/api/me", (route) => route.fulfill({ json: options.me }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [state.record], majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    if (route.request().method() === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      options.onPatch?.(body);
      if (options.patch?.(route, body)) {
        return;
      }
      state.record = { ...state.record, ...body };
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

const emailField = (page: Page) => page.getByLabel("Email", { exact: true });
const clearEmailDialog = (page: Page) => page.getByRole("dialog", { name: /email address\?$/ });

test.describe("profile 6b-3 — email-clear confirmation", () => {
  test("self-edit: clearing your own email prompts, and confirming saves the clear", async ({
    page,
  }) => {
    let saved: Record<string, unknown> | null = null;
    await mockProfile(page, {
      me: meDoc("brother", 5247),
      onPatch: (b) => {
        saved = b;
      },
    });
    await gotoEdit(page);

    await emailField(page).fill("");
    await page.getByRole("button", { name: "Save changes" }).click();

    // The PATCH is withheld until the brother confirms.
    const dialog = clearEmailDialog(page);
    await expect(dialog).toBeVisible();
    expect(saved).toBeNull();

    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/brother\/5247$/);
    // The clear reaches the wire as the null sentinel (OFC-107), not a dropped key.
    expect(saved).toHaveProperty("email", null);
  });

  test("admin-on-other: prompts, and Keep editing aborts without sending the PATCH", async ({
    page,
  }) => {
    let saved: Record<string, unknown> | null = null;
    await mockProfile(page, {
      me: meDoc("admin", 5001),
      onPatch: (b) => {
        saved = b;
      },
    });
    await gotoEdit(page);

    await emailField(page).fill("");
    await page.getByRole("button", { name: "Save changes" }).click();

    const dialog = clearEmailDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();

    // Dialog dismissed, still on the edit form, and nothing was saved.
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
    expect(saved).toBeNull();
  });

  test("manager-on-other (email shared): clearing a shared email also prompts", async ({
    page,
  }) => {
    await mockProfile(page, { me: meDoc("manager", 5001) });
    await gotoEdit(page);

    await emailField(page).fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(clearEmailDialog(page)).toBeVisible();
  });

  test("no prompt when the email is untouched and another field changed", async ({ page }) => {
    let saved: Record<string, unknown> | null = null;
    await mockProfile(page, {
      me: meDoc("brother", 5247),
      onPatch: (b) => {
        saved = b;
      },
    });
    await gotoEdit(page);

    await page.getByLabel("Telephone", { exact: true }).fill("617-555-0199");
    await page.getByRole("button", { name: "Save changes" }).click();

    // Straight through to save — no confirmation, email absent from the patch.
    await expect(page).toHaveURL(/\/brother\/5247$/);
    await expect(clearEmailDialog(page)).toHaveCount(0);
    expect(saved).not.toHaveProperty("email");
  });

  test("no prompt when the email is changed to a different address", async ({ page }) => {
    let saved: Record<string, unknown> | null = null;
    await mockProfile(page, {
      me: meDoc("brother", 5247),
      onPatch: (b) => {
        saved = b;
      },
    });
    await gotoEdit(page);

    await emailField(page).fill("jim@example.test");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/brother\/5247$/);
    expect(saved).toHaveProperty("email", "jim@example.test");
  });

  test("surfaces the last-admin refusal after confirming (409 → specific banner)", async ({
    page,
  }) => {
    await mockProfile(page, {
      me: meDoc("admin", 5001),
      // The server refuses clearing the sole usable admin's email (D129/N86).
      patch: (route, body) => {
        if ("email" in body && body.email === null) {
          route.fulfill({ status: 409, json: { error: "last_admin" } });
          return true;
        }
        return false;
      },
    });
    await gotoEdit(page);

    await emailField(page).fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await clearEmailDialog(page).getByRole("button", { name: "Save", exact: true }).click();

    // The specific message — not the opaque generic banner the old fall-through raised.
    await expect(page.getByRole("alert")).toContainText(/last administrator/i);
    // Still on the edit form; the edit is kept so the admin can fix it.
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
  });

  test("the open confirmation dialog has no axe violations (WCAG 2.2 AA)", async ({ page }) => {
    await mockProfile(page, { me: meDoc("admin", 5001) });
    await gotoEdit(page);

    await emailField(page).fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(clearEmailDialog(page)).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
