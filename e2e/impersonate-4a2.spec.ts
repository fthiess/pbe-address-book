import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * "View as" role impersonation, the SPA loop (Phase 4a-2; DECISIONS N31). The
 * backend is mocked at the network layer with a **stateful effective role**: the
 * impersonate POST/DELETE mutate it and the next `/api/me` reflects it, exactly as
 * the server-side session does. This proves the client half — the avatar-menu
 * controls, the masthead indicator, and the hard reload that re-fetches at the new
 * projection — while the server-side enforcement (the lower projection actually
 * downloaded, the lower powers actually denied) is proven in the API unit suite.
 */

const OWN_ID = 5002;

function meDoc(effective: "manager" | "brother" | null) {
  const role = effective ?? "admin";
  return {
    profileId: OWN_ID,
    role,
    realRole: "admin",
    impersonating: effective !== null,
    stars: [] as number[],
    profile: {
      id: OWN_ID,
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
      allowCommentReplyEmail: true,
      allowShareWithMITAA: false,
      lastModified: "2026-06-03T12:00:00.000Z",
      newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
    },
  };
}

/**
 * Wire the stateful auth mock. `effective` is the impersonation overlay the
 * endpoints drive; a hard reload re-reads `/api/me` and so reflects it — the same
 * round trip N31 specifies (a soft refresh would not re-download the directory).
 */
async function gotoApp(page: Page, path = "/") {
  let effective: "manager" | "brother" | null = null;
  await page.route("**/api/me", (route) => route.fulfill({ json: meDoc(effective) }));
  await page.route("**/api/me/impersonate", (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      effective = body.role;
    } else if (method === "DELETE") {
      effective = null;
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [meDoc(null).profile], majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, (route) =>
    route.fulfill({ headers: { ETag: "v1" }, json: meDoc(null).profile }),
  );
  await page.goto(path);
  // Wait for the authenticated shell — the avatar summary carries the own name.
  await expect(page.locator("summary").filter({ hasText: "Dev Admin" })).toBeVisible();
}

/** Open the avatar menu (a native `<details>` disclosure keyed by the own name). */
function openAvatarMenu(page: Page) {
  return page.locator("summary").filter({ hasText: "Dev Admin" }).click();
}

test.describe("View as impersonation (N31)", () => {
  test("an admin steps down to brother and back through the avatar menu", async ({ page }) => {
    // Run on the calm Profile page so no virtualized grid sits under the menu
    // popover; the masthead/menu are identical on every authenticated route.
    await gotoApp(page, "/brother/5002");

    // Real admin: the solid role badge, and the step-down items are offered.
    await expect(page.getByText("Admin", { exact: true })).toBeVisible();
    await openAvatarMenu(page);
    await expect(page.getByRole("button", { name: "View as Manager" })).toBeVisible();

    await page.getByRole("button", { name: "View as Brother" }).click();

    // The hard reload re-fetches /api/me as brother: the masthead now warns, and
    // the menu offers the way back (keyed on the real admin role).
    await expect(page.getByText("Viewing as Brother", { exact: true })).toBeVisible();
    await openAvatarMenu(page);
    await expect(page.getByRole("button", { name: "Stop viewing as Brother" })).toBeVisible();

    await page.getByRole("button", { name: "Stop viewing as Brother" }).click();

    // Back to the real role: the warning pill is gone, the badge returns.
    await expect(page.getByText("Viewing as Brother", { exact: true })).toBeHidden();
    await expect(page.getByText("Admin", { exact: true })).toBeVisible();
  });

  test("the Profile shortcut navigates to one's own record", async ({ page }) => {
    await gotoApp(page);
    await openAvatarMenu(page);
    await page.getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/brother\/5002$/);
  });

  test("the impersonating masthead indicator has no a11y violations (axe, WCAG 2.2 AA)", async ({
    page,
  }) => {
    // Scan the resting state with the warning pill shown (the persistent new UI);
    // axe over a transient dropdown opened on top of other interactive content
    // measures overlay overlap, not our controls, which are semantic and labelled.
    await gotoApp(page, "/brother/5002");
    await openAvatarMenu(page);
    await page.getByRole("button", { name: "View as Brother" }).click();
    await expect(page.getByText("Viewing as Brother", { exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
