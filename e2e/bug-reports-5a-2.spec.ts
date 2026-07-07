import AxeBuilder from "@axe-core/playwright";
import { type Page, type Route, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The bug-report loop (Phase 5a-2; D121). The backend is mocked at the network
 * layer. Proves the client halves: the masthead "Report a bug" filing dialog (any
 * member) and the admin review queue (view / copy / delete, with the new→reviewed
 * unread marker). Server-side enforcement (auth, validation, audit) is proven in
 * the API unit suite.
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

async function wireAuth(page: Page, role: "admin" | "brother") {
  await page.route("**/api/me", (route) => route.fulfill({ json: meDoc(role) }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [meDoc(role).profile], majors: [] } }),
  );
  await page.route("**/api/banner", (route) => route.fulfill({ json: { active: false } }));
}

test.describe("Report a bug — filing (any member)", () => {
  test("a brother files a report from the masthead and sees a confirmation", async ({ page }) => {
    await wireAuth(page, "brother");
    let captured: unknown = null;
    await page.route("**/api/bug-report", (route) => {
      captured = JSON.parse(route.request().postData() ?? "{}");
      return route.fulfill({ status: 201, json: { id: "bug-1", status: "new" } });
    });
    await page.goto("/");
    await expect(page.locator("summary").filter({ hasText: "Dev" })).toBeVisible();

    await page.getByRole("button", { name: "Report a bug" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Report a bug" })).toBeVisible();

    await dialog.getByLabel("What happened?").fill("The star column didn't update on my iPad.");
    await dialog.getByRole("button", { name: "Send report" }).click();

    await expect(page.getByRole("heading", { name: "Thanks — report sent" })).toBeVisible();
    // The route, absolute URL, and client context were captured automatically.
    expect(captured).toMatchObject({
      page: "/",
      description: "The star column didn't update on my iPad.",
    });
    const body = captured as {
      url: string;
      clientContext: { viewport: string; userAgent: string; webVersion: string; device: string };
    };
    expect(body.url).toContain("http");
    expect(body.clientContext.viewport).toMatch(/^\d+x\d+$/);
    expect(body.clientContext.userAgent.length).toBeGreaterThan(0);
    // The richer capture: a build id and a device class are always present.
    expect(body.clientContext.webVersion.length).toBeGreaterThan(0);
    expect(["Mobile", "Tablet", "Desktop"]).toContain(body.clientContext.device);

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Send is disabled until there is a description; Escape closes the dialog", async ({
    page,
  }) => {
    await wireAuth(page, "brother");
    await page.goto("/");
    await expect(page.locator("summary").filter({ hasText: "Dev" })).toBeVisible();

    await page.getByRole("button", { name: "Report a bug" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Send report" })).toBeDisabled();
    await dialog.getByLabel("What happened?").fill("Something broke.");
    await expect(dialog.getByRole("button", { name: "Send report" })).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the filing dialog has no a11y violations (axe, WCAG 2.2 AA)", async ({ page }) => {
    await wireAuth(page, "brother");
    await page.goto("/");
    await page.getByRole("button", { name: "Report a bug" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});

type QueuedReport = {
  id: string;
  submitterId: number;
  submitterName: string;
  submittedAt: string;
  page: string;
  url?: string;
  description: string;
  clientContext?: {
    userAgent?: string;
    viewport?: string;
    webVersion?: string;
    device?: string;
    os?: string;
    browser?: string;
    network?: string;
  };
  apiVersion?: string;
  status: "new" | "reviewed";
};

const REPORTS: QueuedReport[] = [
  {
    id: "bug-2",
    submitterId: 5002,
    submitterName: "Karen Nelson '05",
    submittedAt: "2026-06-13T10:00:00.000Z",
    page: "/",
    url: "https://book.pbe400.org/",
    description: "The star column doesn't update right away on my iPad.",
    clientContext: {
      userAgent: "Safari/iPad",
      viewport: "820x1180",
      webVersion: "web-abc",
      device: "Tablet",
      os: "iPadOS 17.5",
      browser: "Safari 17.5",
      network: "Wi-Fi · 4g",
    },
    apiVersion: "api-def",
    status: "new",
  },
  {
    id: "bug-1",
    submitterId: 5247,
    submitterName: "James Smyth '84",
    submittedAt: "2026-06-12T14:02:00.000Z",
    page: "/brother/5247",
    description: "A profile photo looked stretched.",
    status: "reviewed",
  },
];

/** Wire the admin queue mocks; returns handles to observe mark-reviewed + delete calls. */
async function wireQueue(page: Page, reports: QueuedReport[]) {
  const state = { markReviewedIds: [] as string[], deleted: [] as string[] };
  let current = [...reports];
  await page.route("**/api/admin/bug-reports", (route: Route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { reports: current } });
    }
    return route.fallback();
  });
  await page.route("**/api/admin/bug-reports/mark-reviewed", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    state.markReviewedIds = body.ids ?? [];
    return route.fulfill({ json: { reviewed: state.markReviewedIds.length } });
  });
  await page.route("**/api/admin/bug-reports/*", (route) => {
    if (route.request().method() === "DELETE") {
      const id = decodeURIComponent(route.request().url().split("/").pop() ?? "");
      state.deleted.push(id);
      current = current.filter((r) => r.id !== id);
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fallback();
  });
  return state;
}

test.describe("Bug reports — admin queue", () => {
  test("lists reports newest-first, filters by tab, and marks new ones reviewed on load", async ({
    page,
  }) => {
    await wireAuth(page, "admin");
    const state = await wireQueue(page, REPORTS);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Bug reports" })).toBeVisible();

    // The one unread report was marked reviewed for next time (best-effort, on load).
    await expect.poll(() => state.markReviewedIds).toEqual(["bug-2"]);

    // Default "New" tab shows only the unread one, with its NEW badge.
    await expect(page.getByText("Karen Nelson '05")).toBeVisible();
    await expect(page.getByText("James Smyth '84")).toHaveCount(0);
    await expect(page.getByText("NEW", { exact: true })).toBeVisible();

    // "All" shows both, newest first.
    await page.getByRole("button", { name: /^All/ }).click();
    await expect(page.getByText("Karen Nelson '05")).toBeVisible();
    await expect(page.getByText("James Smyth '84")).toBeVisible();

    // "Reviewed" shows only the already-seen one.
    await page.getByRole("button", { name: /^Reviewed/ }).click();
    await expect(page.getByText("James Smyth '84")).toBeVisible();
    await expect(page.getByText("Karen Nelson '05")).toHaveCount(0);
  });

  test("Copy report puts a formatted block on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await wireAuth(page, "admin");
    await wireQueue(page, REPORTS);
    await page.goto("/admin");
    await page.getByRole("button", { name: /^All/ }).click();

    await page.getByRole("button", { name: "Copy report" }).first().click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("Bug report from Karen Nelson '05 (#5002)");
    expect(clip).toContain("Viewport: 820x1180");
    expect(clip).toContain("OS: iPadOS 17.5");
    expect(clip).toContain("Web version: web-abc");
    expect(clip).toContain("API version: api-def");
    expect(clip).toContain("The star column doesn't update right away on my iPad.");
  });

  test("Delete asks for confirmation, then removes the report", async ({ page }) => {
    await wireAuth(page, "admin");
    const state = await wireQueue(page, REPORTS);
    await page.goto("/admin");
    await page.getByRole("button", { name: /^All/ }).click();

    // The first row is the newest (Karen). Delete → confirm.
    await page.getByRole("button", { name: "Delete", exact: true }).first().click();
    await page.getByRole("button", { name: "Confirm delete" }).click();

    await expect.poll(() => state.deleted).toEqual(["bug-2"]);
    await expect(page.getByText("Karen Nelson '05")).toHaveCount(0);
    await expect(page.getByText("James Smyth '84")).toBeVisible();
  });

  test("the queue has no a11y violations (axe, WCAG 2.2 AA)", async ({ page }) => {
    await wireAuth(page, "admin");
    await wireQueue(page, REPORTS);
    await page.goto("/admin");
    await page.getByRole("button", { name: /^All/ }).click();
    await expect(page.getByText("James Smyth '84")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
