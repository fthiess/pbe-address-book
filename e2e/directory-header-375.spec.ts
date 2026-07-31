import { type Page, expect, test } from "@playwright/test";

/**
 * OFC-375 — the Directory header's control row must not move when a filter
 * changes.
 *
 * The header lays the heading block and the control group (search, the two
 * quick toggles, Columns) out with `justify-between`. While it also carried
 * `flex-wrap`, whether the control group sat *beside* the heading or wrapped
 * *below* it depended on how wide the heading block rendered — and that block
 * carries the count line, whose text changes with the filter state:
 *
 *   deceased excluded → "1089 of 1207 brothers"   (wide  → group wraps below)
 *   deceased included → "1207 brothers"           (narrow → group fits beside)
 *
 * At iPad-portrait width the header sits within a few px of that wrap point, so
 * ticking "Include deceased" jumped the entire control row up onto the heading
 * line — a 60px shift.
 *
 * The deceased box was never actually the cause: the count text was. "Starred
 * only" narrows the same line ("0 of 1207 brothers") and, as the second test
 * below showed on the unfixed build, moved the row by the identical 60px. The
 * tester simply never landed on a starred count wide enough to tip it, which is
 * why the report singled out the deceased checkbox.
 *
 * The fixture reproduces the reported counts exactly (1207 records, 118 of them
 * deceased) because the bug is a function of the rendered text width: a handful
 * of short-count rows would leave the heading block narrower than the "Directory"
 * h1 in *both* states, and nothing would move.
 */

/** iPad Pro 11" portrait — the device the finding was reported on. */
const IPAD_PORTRAIT = { width: 834, height: 1194 };

const TOTAL = 1207;
const DECEASED = 118;
const LIVING = TOTAL - DECEASED; // 1089 — the "N of" in the unchecked count

const ME = {
  profileId: 5001,
  role: "admin" as const,
  realRole: "admin" as const,
  impersonating: false,
  stars: [],
  profile: {
    id: 5001,
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
    allowShareWithMITAA: false,
    lastModified: "2026-06-03T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
  },
};

/** A roster whose size drives the count strings; the rows themselves are incidental. */
const PROFILES = {
  profiles: Array.from({ length: TOTAL }, (_, i) => ({
    id: 5001 + i,
    firstName: "Test",
    lastName: `Brother${String(i).padStart(4, "0")}`,
    classYear: 1960 + (i % 60),
    deceased: { isDeceased: i >= LIVING },
    hasHeadshot: false,
  })),
  majors: [],
};

async function gotoDirectory(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: PROFILES }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

const searchBox = (page: Page) => page.getByRole("searchbox", { name: /Name Search/i });

async function topOf(page: Page, locator = searchBox(page)): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("control row is not laid out");
  }
  return box.y;
}

test.describe("directory header — OFC-375", () => {
  test("the control row holds its position when Include deceased is ticked", async ({ page }) => {
    await gotoDirectory(page, IPAD_PORTRAIT);

    // Guard: the fixture really does produce the two different count strings, or
    // this test proves nothing about the layout.
    await expect(page.getByText(`${LIVING} of ${TOTAL} brothers`)).toBeVisible();
    const before = await topOf(page);

    await page.getByRole("checkbox", { name: "Include deceased" }).check();
    await expect(page.getByText(`${TOTAL} brothers`, { exact: true })).toBeVisible();
    const after = await topOf(page);

    // The whole point: a filter change must not relayout the header.
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  // The tester reported this as specific to "Include deceased", but it never was:
  // Starred only shortens the count the same way ("0 of 1207 brothers"), and this
  // case jumped the row by the same 60px before the fix. He simply didn't land on
  // a starred count wide enough to tip it. Guarding both keeps the real invariant
  // — no filter relayouts the header — rather than the reported symptom.
  test("the control row also holds position for Starred only", async ({ page }) => {
    await gotoDirectory(page, IPAD_PORTRAIT);
    const before = await topOf(page);

    await page.getByRole("checkbox", { name: "Starred only" }).check();
    const after = await topOf(page);

    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  test("below lg the control row sits under the heading, whatever the count reads", async ({
    page,
  }) => {
    await gotoDirectory(page, IPAD_PORTRAIT);

    const heading = await page.getByRole("heading", { name: "Directory" }).boundingBox();
    const search = await searchBox(page).boundingBox();
    expect(search?.y ?? 0).toBeGreaterThan((heading?.y ?? 0) + (heading?.height ?? 0));
  });

  test("at lg and above the control row still shares the heading line", async ({ page }) => {
    // The fix must not cost desktop its compact two-column header — at 1280 the
    // longest count string and the full control group fit side by side with room
    // to spare, so they should stay there.
    await gotoDirectory(page, { width: 1280, height: 900 });

    const heading = await page.getByRole("heading", { name: "Directory" }).boundingBox();
    const search = await searchBox(page).boundingBox();
    expect(search?.y ?? 0).toBeLessThan((heading?.y ?? 0) + (heading?.height ?? 0));
  });
});
