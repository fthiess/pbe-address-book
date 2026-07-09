import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const OWN_ID = 5001;

/**
 * Phase 5b-2 client surfaces: the two admin download-only reports (Book/Ghost
 * alignment audit → Markdown, email bounce report → CSV) and the D118
 * maintenance/outage screen. The backend is mocked at the network layer — the
 * server-side audit/bounce joins and the admin gate are proven in the API unit
 * suite; here we prove the client half (download flow, calm states, a11y) and that
 * a `5xx` reads as an outage, not as "signed out".
 */

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
      lastName: "Admin",
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

/** Base auth + directory + queue mocks so the Admin page renders for an admin. */
async function baseMocks(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: meDoc("admin") }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [meDoc("admin").profile], majors: [] } }),
  );
  await page.route("**/api/banner", (route) => route.fulfill({ json: { active: false } }));
  await page.route("**/api/admin/bug-reports", (route) => route.fulfill({ json: { reports: [] } }));
}

test.describe("Admin Ghost reports (5b-2)", () => {
  test("Run audit downloads a Markdown report and shows the difference count", async ({ page }) => {
    await baseMocks(page);
    await page.route("**/api/admin/ghost-audit", (route) =>
      route.fulfill({
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({
          generatedAt: "2026-07-09T09:14:00.000Z",
          discrepancies: [
            { category: "unmatchedGhostMember", ghostMemberId: "g2", ghostValue: "x@example.test" },
          ],
        }),
      }),
    );
    await page.goto("/admin");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Run audit" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("book-ghost-audit-2026-07-09.md");
    await expect(page.getByText(/1 difference to review/)).toBeVisible();
  });

  test("a clean audit reports alignment with no download noise", async ({ page }) => {
    await baseMocks(page);
    await page.route("**/api/admin/ghost-audit", (route) =>
      route.fulfill({
        json: { generatedAt: "2026-07-09T09:14:00.000Z", discrepancies: [] },
      }),
    );
    await page.goto("/admin");
    await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Run audit" }).click(),
    ]);
    await expect(page.getByText(/no differences found/i)).toBeVisible();
  });

  test("Download report downloads the bounce CSV", async ({ page }) => {
    await baseMocks(page);
    await page.route("**/api/admin/bounce-report", (route) =>
      route.fulfill({
        json: {
          generatedAt: "2026-07-09T09:14:00.000Z",
          skipped: 0,
          rows: [
            {
              email: "a@example.test",
              bounce_count: 2,
              last_bounce_at: "2026-06-01T00:00:00.000Z",
              last_bounce_newsletter: "Summer Issue",
            },
          ],
        },
      }),
    );
    await page.goto("/admin");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download report" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("book-bounce-report-2026-07-09.csv");
    await expect(page.getByText(/1 bouncing address/)).toBeVisible();
  });

  test("a 503 (Ghost unconfigured) shows a calm message, not a scary error", async ({ page }) => {
    await baseMocks(page);
    await page.route("**/api/admin/ghost-audit", (route) =>
      route.fulfill({ status: 503, json: { error: "ghost_unconfigured" } }),
    );
    await page.goto("/admin");
    await page.getByRole("button", { name: "Run audit" }).click();
    await expect(page.getByText(/isn't configured in this environment/)).toBeVisible();
  });

  test("the Admin page has no a11y violations with the new cards (axe, WCAG 2.2 AA)", async ({
    page,
  }) => {
    await baseMocks(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Book / Ghost alignment audit" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("Maintenance / outage screen (D118)", () => {
  test("a 5xx from /api/me shows the outage screen, not the sign-in screen", async ({ page }) => {
    // A 503 (down for maintenance/outage) must NOT read as signed-out — the D118
    // fix in SessionContext routes it to the retryable outage screen.
    await page.route("**/api/me", (route) => route.fulfill({ status: 503, body: "{}" }));
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Book is temporarily unavailable" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    // Crucially, it did NOT bounce to the Ghost sign-in screen.
    await expect(page.getByRole("button", { name: /Sign in/i })).toHaveCount(0);
  });

  test("the outage screen has no a11y violations (axe, WCAG 2.2 AA)", async ({ page }) => {
    await page.route("**/api/me", (route) => route.fulfill({ status: 503, body: "{}" }));
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Book is temporarily unavailable" }),
    ).toBeVisible({ timeout: 15_000 });
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
