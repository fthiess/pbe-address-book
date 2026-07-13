import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Prev/next-through-the-Directory navigation (Phase 4d, OFC-67 / DECISIONS N45).
 * Against the mocked backend, this drives the real SPA's data-router navigation:
 *
 *  - the three Directory entry points stash the displayed (search ∩ filter ∩
 *    sort) id-list, so the Profile page can step Prev/Next through it;
 *  - "← Directory" pops the whole `directoryDelta` chain back to the true
 *    Directory entry (not just one step) after a Prev/Next walk;
 *  - a stale stashed id shows the not-found state with prev/next still working
 *    (no auto-skip); and
 *  - a cold deep-link hides the prev/next controls (graceful degradation).
 *
 * The default sort is Canonical Name ascending, so the fixed three-row list
 * orders Adams (5300) → Smyth (5247) → Young (5301) — positions 1/2/3 of 3.
 */

function baseRecord(id: number, firstName: string, lastName: string, classYear: number) {
  return {
    id,
    firstName,
    lastName,
    classYear,
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
  };
}

const RECORDS: Record<number, ReturnType<typeof baseRecord>> = {
  5300: baseRecord(5300, "Aaron", "Adams", 1980),
  5247: baseRecord(5247, "James", "Smyth", 1984),
  5301: baseRecord(5301, "Carl", "Young", 1990),
};

// The caller is an ordinary brother viewing the directory (no edit affordances
// needed for these tests).
const ME = {
  profileId: 5247,
  role: "brother" as const,
  realRole: "brother" as const,
  impersonating: false,
  stars: [],
  profile: RECORDS[5247],
};

const LIST = {
  profiles: Object.values(RECORDS).map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    classYear: r.classYear,
    deceased: { isDeceased: false },
    hasHeadshot: false,
  })),
  majors: [],
};

/**
 * Wire the mocks. `stale` holds ids whose single-record GET returns 404 (a record
 * that stopped resolving between stash and click — deleted/unlisted/etc.).
 */
async function mock(page: Page, stale: Set<number> = new Set()) {
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: LIST }));
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    const id = Number(
      route
        .request()
        .url()
        .match(/\/(\d+)$/)?.[1],
    );
    if (stale.has(id) || !RECORDS[id]) {
      return route.fulfill({ status: 404, json: { error: "not_found" } });
    }
    return route.fulfill({ headers: { ETag: 'W/"v1"' }, json: RECORDS[id] });
  });
}

/**
 * An admin variant: the caller is an admin viewing the directory, so the Profile
 * page shows the Staff controls (incl. Delete). Adds the DELETE route and the
 * Role control's GET so the delete-after-a-chain return path can be exercised.
 * Returns a `del` counter.
 */
async function mockAdmin(page: Page): Promise<{ del: () => number }> {
  let del = 0;
  const admin = {
    profileId: 5001,
    role: "admin" as const,
    realRole: "admin" as const,
    impersonating: false,
    stars: [],
    profile: { ...baseRecord(5001, "Ada", "Admin", 1979) },
  };
  await page.route("**/api/me", (route) => route.fulfill({ json: admin }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: LIST }));
  // Change-role re-pathed to PUT /api/profiles/:id/role (OFC-139/D128).
  await page.route(/\/api\/profiles\/\d+\/role$/, (route) =>
    route.fulfill({ json: { id: 5301, role: "brother" } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    if (route.request().method() === "DELETE") {
      del += 1;
      return route.fulfill({ status: 204, body: "" });
    }
    const id = Number(
      route
        .request()
        .url()
        .match(/\/(\d+)$/)?.[1],
    );
    if (!RECORDS[id]) {
      return route.fulfill({ status: 404, json: { error: "not_found" } });
    }
    return route.fulfill({ headers: { ETag: 'W/"v1"' }, json: RECORDS[id] });
  });
  return { del: () => del };
}

async function gotoDirectory(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

/** Open a brother's profile by clicking its Directory row link. */
async function openRow(page: Page, lastName: string) {
  await page
    .getByRole("rowheader", { name: new RegExp(lastName) })
    .getByRole("link")
    .click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(lastName) })).toBeVisible();
}

test.describe("prev/next through the directory (4d)", () => {
  test("steps forward and back through the displayed set, disabling the ends", async ({ page }) => {
    await mock(page);
    await gotoDirectory(page);
    await openRow(page, "Adams");

    // First in the set: Prev disabled, position 1 of 3.
    await expect(page.getByText("1 of 3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous brother" })).toBeDisabled();

    await page.getByRole("button", { name: "Next brother" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();
    await expect(page.getByText("2 of 3")).toBeVisible();
    // Focus follows the step to the (still-enabled) Next button, so a keyboard
    // user can hold Enter to keep stepping (OFC-144) — the bar remounts each step.
    await expect(page.getByRole("button", { name: "Next brother" })).toBeFocused();

    await page.getByRole("button", { name: "Next brother" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Young/ })).toBeVisible();
    await expect(page.getByText("3 of 3")).toBeVisible();
    // Last in the set: Next disabled — focus falls back to the opposite control
    // rather than dropping to <body> (OFC-144).
    await expect(page.getByRole("button", { name: "Next brother" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Previous brother" })).toBeFocused();

    // Prev walks back.
    await page.getByRole("button", { name: "Previous brother" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();
    await expect(page.getByText("2 of 3")).toBeVisible();
  });

  test("'← Directory' pops the whole prev/next chain back to the Directory", async ({ page }) => {
    await mock(page);
    await gotoDirectory(page);
    await openRow(page, "Adams"); // delta 1

    await page.getByRole("button", { name: "Next brother" }).click(); // → Smyth, delta 2
    await expect(page.getByText("2 of 3")).toBeVisible();
    await page.getByRole("button", { name: "Next brother" }).click(); // → Young, delta 3
    await expect(page.getByText("3 of 3")).toBeVisible();

    // navigate(-3) lands on the Directory entry itself — not one profile back
    // (which would still show a profile heading).
    await page.getByRole("button", { name: /Directory/ }).click();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("a stale stashed id shows not-found with prev/next still working (no auto-skip)", async ({
    page,
  }) => {
    // Young (5301) has gone stale since the stash was taken.
    await mock(page, new Set([5301]));
    await gotoDirectory(page);
    await openRow(page, "Smyth"); // 2 of 3

    await page.getByRole("button", { name: "Next brother" }).click(); // → 5301, now 404
    await expect(page.getByRole("heading", { name: "Brother not found" })).toBeVisible();
    // The controls persist (the id is still a member of the stashed set), so the
    // user can step past it, and the position readout still orients them.
    await expect(page.getByText("3 of 3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next brother" })).toBeDisabled();

    await page.getByRole("button", { name: "Previous brother" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();
  });

  test("a cold deep-link hides the prev/next controls but keeps ← Directory", async ({ page }) => {
    await mock(page);
    await page.goto("/brother/5247");
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();

    await expect(page.getByRole("button", { name: "Next brother" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Previous brother" })).toHaveCount(0);
    // With nothing to pop (delta 0), ← Directory is a real <a href="/"> anchor,
    // not a JS-only button — a genuine escape hatch (OFC-145). It still works.
    const back = page.getByRole("link", { name: /Directory/ });
    await expect(back).toHaveAttribute("href", "/");
    await back.click();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
  });

  test("deleting a brother after a prev/next chain returns to the Directory", async ({ page }) => {
    // The post-delete return uses the same directoryDelta pop as ← Directory
    // (OFC-143); this guards that a chain-walk before a destructive delete still
    // lands on the Directory, not one step into the chain (OFC-142).
    const { del } = await mockAdmin(page);
    await gotoDirectory(page);
    await openRow(page, "Adams"); // delta 1

    await page.getByRole("button", { name: "Next brother" }).click(); // → Smyth, delta 2
    await expect(page.getByText("2 of 3")).toBeVisible();
    await page.getByRole("button", { name: "Next brother" }).click(); // → Young, delta 3
    await expect(page.getByRole("heading", { level: 1, name: /Young/ })).toBeVisible();

    await page.getByRole("button", { name: "Delete brother…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this brother?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete permanently" }).click();

    // navigate(-3) lands on the Directory, not an intermediate profile.
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    expect(del()).toBe(1);
  });

  test("searching/filtering writes no stash entries; navigating writes exactly one (OFC-141 follow-up)", async ({
    page,
  }) => {
    await mock(page);
    await gotoDirectory(page);

    const stashCount = () =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter(
            (k) => k.startsWith("pbe:dirnav:") && k !== "pbe:dirnav:index",
          ).length,
      );

    // Changing the displayed set (search) repeatedly, without opening a profile,
    // must NOT accumulate stash entries — that was the reported leak.
    await page.getByRole("searchbox").fill("young");
    await page.getByRole("searchbox").fill("adams");
    await page.getByRole("searchbox").fill("");
    expect(await stashCount()).toBe(0);

    // Opening a profile writes exactly one stash…
    await openRow(page, "Adams");
    expect(await stashCount()).toBe(1);

    // …and stepping reuses it — a Prev/Next chain doesn't add keys.
    await page.getByRole("button", { name: "Next brother" }).click();
    await expect(page.getByText("2 of 3")).toBeVisible();
    expect(await stashCount()).toBe(1);

    // Returning to the Directory clears the stash — it's dead weight there, and
    // the next click-through regenerates one. So repeated Directory→profile→
    // Directory→profile does NOT accumulate identical stashes (OFC-141 follow-up).
    await page.getByRole("button", { name: /Directory/ }).click();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    expect(await stashCount()).toBe(0);

    await openRow(page, "Adams");
    expect(await stashCount()).toBe(1); // one, not two
    await page.getByRole("button", { name: /Directory/ }).click();
    await openRow(page, "Adams");
    expect(await stashCount()).toBe(1); // still one, not three
  });

  test("the profile view with the prev/next bar has no a11y violations (axe, WCAG 2.2 AA)", async ({
    page,
  }) => {
    await mock(page);
    await gotoDirectory(page);
    await openRow(page, "Adams");
    await expect(page.getByRole("button", { name: "Next brother" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
