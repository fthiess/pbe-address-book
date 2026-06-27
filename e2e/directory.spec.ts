import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// A real committed placeholder thumbnail (authored by `author:thumbnails`),
// served from the mocked `/img` route so the image path runs against actual WEBP
// bytes — the same fixtures the staging seeder uploads to the live bucket.
const THUMB_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "tools",
  "fake-data",
  "fixtures",
  "thumbnails",
  "placeholder-0.webp",
);

/**
 * The signed-in Directory (Phase 3a — the virtualized grid). The backend is
 * mocked at the network layer (`/api/me` + `/api/profiles`), so this exercises
 * the real SPA — the grid's columns, sorting, the column lens, virtualization,
 * row navigation, and scroll restoration — and gates the page on WCAG 2.2 AA
 * (D79) without standing up the API and emulator.
 */

// `/api/me` returns the caller's own full Profile; the directory rows are the
// brother-role projection (DirectoryProfile). The Canonical Name is derived
// client-side, so the stubs carry only stored fields, not a `canonicalName`.
const ME = {
  profileId: 5002,
  role: "admin" as const,
  stars: [],
  profile: {
    id: 5002,
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

// Two named brothers that sort to the top (Adams, Admin) plus a tail of
// generated brothers, so the list is tall enough to virtualize and scroll.
const NAMED = [
  // A living brother WITH a headshot (exercises the thumbnail image path).
  {
    id: 5001,
    firstName: "Aaron",
    lastName: "Adams",
    classYear: 1984,
    majors: ["6-3"],
    fullLegalName: "Aaron Bartholomew Adams Jr.",
    deceased: { isDeceased: false },
    hasHeadshot: true,
    headshotVersion: "v1",
    email: "aaron.adams@example.test",
  },
  // A DECEASED brother with a headshot (the In-Memoriam alt + corner bar).
  {
    id: 5003,
    firstName: "Grace",
    lastName: "Abbott",
    classYear: 1979,
    majors: ["18"],
    deceased: { isDeceased: true },
    hasHeadshot: true,
    headshotVersion: "v2",
  },
  // An UNLISTED brother (staff-visible badge, D124).
  {
    id: 5004,
    firstName: "Bob",
    lastName: "Acker",
    classYear: 2001,
    majors: ["2"],
    deceased: { isDeceased: false },
    hasHeadshot: false,
    unlisted: true,
  },
  // A DE-BROTHERED brother (struck-through + badge + red ✕, D115).
  {
    id: 5005,
    firstName: "Carl",
    lastName: "Ash",
    classYear: 1995,
    majors: ["10"],
    deceased: { isDeceased: false },
    hasHeadshot: false,
    debrothered: { isDebrothered: true },
  },
  // The caller's own row, no headshot (exercises the avatar fallback).
  {
    id: 5002,
    firstName: "Dev",
    lastName: "Admin",
    classYear: 1990,
    deceased: { isDeceased: false },
    hasHeadshot: false,
  },
];

const GENERATED = Array.from({ length: 60 }, (_, i) => ({
  id: 5100 + i,
  firstName: "Test",
  lastName: `Brother${String(i + 1).padStart(3, "0")}`,
  classYear: 1970 + (i % 40),
  deceased: { isDeceased: false },
  hasHeadshot: false,
  email: `test${i + 1}@example.test`,
}));

const PROFILES = { profiles: [...NAMED, ...GENERATED], majors: [] };
const TOTAL_ROWS = PROFILES.profiles.length;

async function gotoDirectory(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: PROFILES }));
  // The image-serving path: every thumbnail request gets a real WEBP fixture.
  await page.route("**/img/thumbnails/**", (route) => route.fulfill({ path: THUMB_FIXTURE }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

/** The rendered pixel width of a column, by its visible header text. */
async function columnWidth(page: Page, headerText: string): Promise<number> {
  const header = page.getByRole("columnheader").filter({ hasText: headerText }).first();
  const box = await header.boundingBox();
  return box?.width ?? 0;
}

test.describe("signed-in directory", () => {
  test("renders the grid: identity columns, own-row marker, and true row count", async ({
    page,
  }) => {
    await gotoDirectory(page);

    // The default-sort top rows (Adams, then Admin) are in the virtual window.
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    // The caller's own row carries the "You" marker (the split-read overlay, D82).
    await expect(page.getByRole("rowheader", { name: /Dev Admin/ })).toContainText("You");

    // Default data columns are present and identical for every role.
    await expect(page.getByRole("columnheader", { name: /Class/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Email/ })).toBeVisible();

    // Virtualization: the full set's size is reported to assistive tech (U6),
    // even though only the near-viewport rows are in the DOM.
    await expect(page.getByRole("table", { name: "Brothers directory" })).toHaveAttribute(
      "aria-rowcount",
      String(TOTAL_ROWS + 1),
    );
    expect(await page.getByRole("row").count()).toBeLessThan(TOTAL_ROWS);
  });

  test("name search filters the list", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("searchbox", { name: /name search/i }).fill("aaron");
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Dev Admin/ })).toHaveCount(0);
  });

  test("clicking a column header sorts, toggling direction and updating the URL", async ({
    page,
  }) => {
    await gotoDirectory(page);
    const classHeader = page.getByRole("columnheader").filter({ hasText: "Class" });

    await page.getByRole("button", { name: "Class", exact: true }).click();
    await expect(classHeader).toHaveAttribute("aria-sort", "ascending");
    await expect(page).toHaveURL(/sort=classYear/);

    await page.getByRole("button", { name: "Class", exact: true }).click();
    await expect(classHeader).toHaveAttribute("aria-sort", "descending");
    await expect(page).toHaveURL(/dir=desc/);
  });

  test("the column lens adds and removes columns", async ({ page }) => {
    await gotoDirectory(page);
    await expect(page.getByRole("columnheader", { name: /Email/ })).toBeVisible();

    await page.getByText("Columns", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Email" }).uncheck();
    await expect(page.getByRole("columnheader", { name: /Email/ })).toHaveCount(0);

    await page.getByRole("button", { name: /reset to default columns/i }).click();
    await expect(page.getByRole("columnheader", { name: /Email/ })).toBeVisible();
  });

  test("each reorderable header exposes a keyboard-operable reorder handle", async ({ page }) => {
    await gotoDirectory(page);
    // The drag handle is a real, named, focusable control (dnd-kit keyboard
    // sensor) — reorder is operable without a pointer (§5.6.1, D79).
    await expect(page.getByRole("button", { name: /reorder the class column/i })).toBeVisible();
  });

  test("a row opens the profile, and Back restores the scroll position", async ({ page }) => {
    await gotoDirectory(page);

    // Plain navigation: the Canonical Name anchor opens the full profile (§5.6.7).
    await page
      .getByRole("rowheader", { name: /Aaron Adams/ })
      .getByRole("link")
      .click();
    await expect(page.getByRole("heading", { name: /Brother #5001/ })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();

    // Scroll restoration (D31): scroll deep, open a profile, come back — the
    // virtualized offset is restored rather than reset to the top.
    const scroller = page.getByTestId("directory-scroll");
    await scroller.evaluate((el) => el.scrollTo(0, 1500));
    await page.waitForTimeout(150); // let the rAF-throttled save write history state
    await scroller.getByRole("link").nth(6).click();
    await expect(page).toHaveURL(/\/brother\/\d+/);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect
      .poll(() => page.getByTestId("directory-scroll").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(800);
  });

  test("retrieves and displays thumbnails for brothers with a headshot", async ({ page }) => {
    // The retrieval path must actually fire a request to the `/img` serving route.
    const thumbRequest = page.waitForRequest(/\/img\/thumbnails\/5001\/v1\.webp/);
    await gotoDirectory(page);

    const photo = page.getByRole("img", { name: /Aaron Adams/ });
    await expect(photo).toBeVisible();
    // Lazy loading is what keeps the initial render cheap on slow links (§5.6.9).
    await expect(photo).toHaveAttribute("loading", "lazy");
    await thumbRequest;
  });

  test("a deceased brother's thumbnail carries In Memoriam in its accessible name", async ({
    page,
  }) => {
    await gotoDirectory(page);
    await expect(page.getByRole("img", { name: /Grace Abbott.*In Memoriam/ })).toBeVisible();
  });

  test("falls back to the avatar when a thumbnail fails to load", async ({ page }) => {
    // Set up routing inline (not via gotoDirectory) so the failing image route is
    // the one in effect: the headshot row must degrade to the initials avatar
    // rather than show a broken image (§5.6.9).
    await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
    await page.route("**/api/profiles", (route) => route.fulfill({ json: PROFILES }));
    await page.route("**/img/thumbnails/**", (route) => route.fulfill({ status: 404 }));
    await page.goto("/");
    await expect(page.getByRole("rowheader", { name: /Aaron Adams/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /Aaron Adams/ })).toHaveCount(0);
  });

  test("renders the course column as a chip and the staff status badges", async ({ page }) => {
    await gotoDirectory(page);
    // The Course column header (renamed from "Major") and a course chip.
    await expect(page.getByRole("columnheader", { name: /Course/ })).toBeVisible();
    await expect(page.getByText("6-3", { exact: true })).toBeVisible();
    // Status badges (admin view): In Memoriam, Unlisted, De-brothered.
    await expect(page.getByText("In Memoriam", { exact: true })).toBeVisible();
    await expect(page.getByText("Unlisted", { exact: true })).toBeVisible();
    await expect(page.getByText("De-brothered", { exact: true })).toBeVisible();
  });

  test("the column lens offers the Full Name column and shows its data", async ({ page }) => {
    await gotoDirectory(page);
    await expect(page.getByRole("columnheader", { name: /Full Name/ })).toHaveCount(0);
    await page.getByText("Columns", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Full Name" }).check();
    await expect(page.getByRole("columnheader", { name: /Full Name/ })).toBeVisible();
    await expect(page.getByText("Aaron Bartholomew Adams Jr.", { exact: true })).toBeVisible();
  });

  test("the Columns menu closes on an outside click", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByText("Columns", { exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Email" })).toBeVisible();
    // Clicking outside the popover dismisses it (native <details> doesn't do this).
    await page.getByRole("heading", { name: "Directory" }).click();
    await expect(page.getByRole("checkbox", { name: "Email" })).toBeHidden();
  });

  test("a column header exposes a keyboard-operable resize separator", async ({ page }) => {
    await gotoDirectory(page);
    const resizer = page.getByRole("separator", { name: /resize the email column/i });
    await expect(resizer).toBeVisible();
    // Keyboard resize (WCAG 2.5.7 alternative to dragging) widens the column.
    const before = await columnWidth(page, "Email");
    await resizer.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => columnWidth(page, "Email")).toBeGreaterThan(before);
  });

  test("changing the sort pushes history, so Back restores the previous sort", async ({ page }) => {
    await gotoDirectory(page);
    const classHeader = page.getByRole("columnheader").filter({ hasText: "Class" });

    await page.getByRole("button", { name: "Class", exact: true }).click();
    await expect(page).toHaveURL(/sort=classYear/);
    await expect(classHeader).toHaveAttribute("aria-sort", "ascending");

    await page.goBack();
    // Back returns to the default Canonical-Name sort (clean URL), not off-page.
    await expect(page).not.toHaveURL(/sort=classYear/);
    await expect(page.getByRole("columnheader").filter({ hasText: "Name" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  test("hiding a column writes it to the URL (shareable view)", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByText("Columns", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Email" }).uncheck();
    // The lens is mirrored into the URL so the view is shareable + history-walkable.
    await expect(page).toHaveURL(/cols=/);
  });

  test("the theme toggle switches between light and dark", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("button", { name: "Dark theme" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Light theme" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("has no detectable accessibility violations (axe, WCAG 2.2 AA)", async ({ page }) => {
    await gotoDirectory(page);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
