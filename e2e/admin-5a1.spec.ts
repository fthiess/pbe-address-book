import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The Admin page (Phase 5a-1; PRD §5.8). The backend is mocked at the network
 * layer: `/api/me` sets the role, `/api/banner` + `/api/admin/banner` are a
 * **stateful** pair (a PUT mutates the banner the next GET returns, exactly as the
 * `config/systemBanner` singleton does), and `/api/admin/backup` returns a download
 * attachment. Proves the client half — the admin-only gate, the banner set/clear
 * loop reaching the masthead, and the backup download — while the server-side
 * enforcement (admin-only, validation, audit) is proven in the API unit suite.
 */

const OWN_ID = 5001;

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
      allowCommentReplyEmail: true,
      allowShareWithMITAA: false,
      lastModified: "2026-06-03T12:00:00.000Z",
      newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
    },
  };
}

type Banner = { active: false } | { active: true; message: string; severity: "info" | "warning" };

/** Wire the auth + banner + backup mocks; `banner` is mutated by the PUT, statefully. */
async function gotoApp(page: Page, role: "admin" | "brother", path = "/") {
  let banner: Banner = { active: false };
  await page.route("**/api/me", (route) => route.fulfill({ json: meDoc(role) }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [meDoc(role).profile], majors: [] } }),
  );
  await page.route("**/api/banner", (route) => route.fulfill({ json: banner }));
  await page.route("**/api/admin/banner", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    banner = body.active
      ? { active: true, message: String(body.message).trim(), severity: body.severity ?? "info" }
      : { active: false };
    return route.fulfill({ json: { ...banner, updatedBy: OWN_ID, updatedAt: "2026-07-05" } });
  });
  await page.route("**/api/admin/backup", (route) =>
    route.fulfill({
      headers: {
        "Content-Disposition": 'attachment; filename="book-backup-2026-07-05.json"',
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: 1,
        generatedAt: "2026-07-05T09:14:00.000Z",
        collections: { profiles: [], users: [], config: [] },
      }),
    }),
  );
  await page.goto(path);
  await expect(page.locator("summary").filter({ hasText: "Dev" })).toBeVisible();
}

const openAvatarMenu = (page: Page) => page.locator("summary").filter({ hasText: "Dev" }).click();

test.describe("Admin page (5a-1)", () => {
  test("an admin reaches the page from the avatar menu and sees the four cards", async ({
    page,
  }) => {
    await gotoApp(page, "admin");
    await openAvatarMenu(page);
    await page.getByRole("link", { name: "Admin Tools" }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: "Administrative Tools", level: 1 }),
    ).toBeVisible();
    // The two live surfaces and the two placeholders all render.
    await expect(page.getByRole("heading", { name: "Download backup" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "System message banner" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Sync with Ghost/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bug reports" })).toBeVisible();
    // The placeholders are marked not-yet-available (there are exactly two).
    await expect(page.getByText("Not yet available")).toHaveCount(2);

    // The "← Directory" affordance returns to the Directory.
    await page.getByRole("link", { name: "Directory" }).click();
    await expect(page).toHaveURL(/\/(?:$|\?)/);
    await expect(page.getByRole("heading", { name: "Administrative Tools", level: 1 })).toHaveCount(
      0,
    );
  });

  test("a brother has no Administration link and is redirected away from /admin", async ({
    page,
  }) => {
    await gotoApp(page, "brother");
    await openAvatarMenu(page);
    await expect(page.getByRole("link", { name: "Admin Tools" })).toHaveCount(0);

    // Direct navigation to the admin route bounces back to the Directory.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/(?:$|\?)/);
    await expect(page.getByRole("heading", { name: "Administrative Tools", level: 1 })).toHaveCount(
      0,
    );
  });

  test("setting a banner shows it in the masthead; clearing removes it", async ({ page }) => {
    const MESSAGE = "Scheduled maintenance this Sunday evening.";
    await gotoApp(page, "admin", "/admin");

    // Only SystemBanner uses aria-live="polite": the always-on preview, plus the
    // masthead banner once it is active. So the count is a precise toggle signal.
    const liveRegions = page.locator('[aria-live="polite"]');

    await page.getByLabel("Message").fill(MESSAGE);
    // Just the preview so far (the masthead banner renders nothing when inactive).
    await expect(liveRegions).toHaveCount(1);

    await page.getByRole("button", { name: "Set banner" }).click();
    // The masthead banner now renders it too, and (being before <main>) it is first.
    await expect(liveRegions).toHaveCount(2);
    await expect(liveRegions.first()).toContainText(MESSAGE);
    await expect(page.getByText("A banner is currently live")).toBeVisible();
    await expect(page.getByText("Banner set. It's now live for everyone.")).toBeVisible();

    await page.getByRole("button", { name: "Clear current banner" }).click();
    // Cleared: the masthead banner is gone, and the reset preview is muted (an empty
    // preview renders a neutral box, not a live-region SystemBanner) — so zero remain.
    await expect(liveRegions).toHaveCount(0);
    await expect(page.getByText("A banner is currently live")).toHaveCount(0);
  });

  test("a transient banner-read failure still lets the admin clear it (OFC-183)", async ({
    page,
  }) => {
    // The on-load GET /api/banner fails; a successful clear also heals the read.
    let readFails = true;
    await page.route("**/api/me", (route) => route.fulfill({ json: meDoc("admin") }));
    await page.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: [], majors: [] } }),
    );
    await page.route("**/api/banner", (route) =>
      readFails
        ? route.fulfill({ status: 503, body: "{}" })
        : route.fulfill({ json: { active: false } }),
    );
    await page.route("**/api/admin/banner", (route) => {
      readFails = false;
      return route.fulfill({ json: { active: false } });
    });
    await page.goto("/admin");
    await expect(page.locator("summary").filter({ hasText: "Dev" })).toBeVisible();

    // The read failed — the admin sees a retryable error, and (the bug fix) the Clear
    // control stays enabled rather than being disabled by a swallowed-to-null banner.
    await expect(page.getByText("We couldn't check the current banner just now.")).toBeVisible();
    const clearButton = page.getByRole("button", { name: "Clear current banner" });
    await expect(clearButton).toBeEnabled();

    await clearButton.click();
    await expect(page.getByText("Banner cleared.")).toBeVisible();
  });

  test("Download now triggers a file download", async ({ page }) => {
    await gotoApp(page, "admin", "/admin");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download now" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("book-backup-2026-07-05.json");
    await expect(page.getByText(/backup has downloaded/)).toBeVisible();
  });

  test("the Admin page has no a11y violations (axe, WCAG 2.2 AA)", async ({ page }) => {
    await gotoApp(page, "admin", "/admin");
    // Set a banner first so the scan covers the live-banner + preview state.
    await page.getByLabel("Message").fill("Announcement for everyone.");
    await page.getByRole("button", { name: "Set banner" }).click();
    await expect(page.getByText("A banner is currently live")).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
