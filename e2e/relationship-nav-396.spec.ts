import { type Page, expect, test } from "@playwright/test";

/**
 * Following a Big/Little Brother link must not lose the Directory you came from
 * (OFC-396).
 *
 * The relationship links were bare `<Link to={"/brother/:id"}>` with no
 * `location.state`, so on the brother they landed on `deriveDirectoryNav` saw a
 * null state and computed `delta === 0` — a cold deep-link. "← Directory" then
 * degraded to its `<Link to="/">` escape-hatch form (OFC-145, a correct branch fed
 * the wrong input) and returned a fresh, unfiltered Directory at the top, losing
 * search, filters, sort, scroll and the Prev/Next set. Prev/Next disappeared for
 * the same reason. The user-visible complaint is the same one OFC-395 produced
 * ("I lose my filter/sort") from an entirely different cause, and it sits on the
 * exact path the UAT reporter was walking when he hit OFC-395: chasing big-brother
 * links.
 *
 * These run against the real SPA with the network mocked, so they exercise the
 * actual history behaviour rather than a component in isolation.
 *
 * The default sort is Canonical Name ascending, so the three-row list orders
 * Adams (5300) → Smyth (5247) → Young (5301) — positions 1/2/3 of 3.
 */

function baseRecord(
  id: number,
  firstName: string,
  lastName: string,
  classYear: number,
  overrides: Record<string, unknown> = {},
) {
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
    ...overrides,
  };
}

// Adams's Big Brother is Smyth, so following the link from Adams lands on a
// brother who is himself in the directory set.
const RECORDS: Record<number, ReturnType<typeof baseRecord>> = {
  5300: baseRecord(5300, "Aaron", "Adams", 1980, { bigBrotherId: 5247 }),
  5247: baseRecord(5247, "James", "Smyth", 1984),
  5301: baseRecord(5301, "Carl", "Young", 1990),
};

/** The caller is an ordinary brother — Young, so "My profile" goes to 5301. */
const ME = {
  profileId: 5301,
  role: "brother" as const,
  realRole: "brother" as const,
  impersonating: false,
  stars: [],
  profile: RECORDS[5301],
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

async function mock(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: LIST }));
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    const id = Number(
      route
        .request()
        .url()
        .match(/\/(\d+)$/)?.[1],
    );
    const record = RECORDS[id];
    if (!record) {
      return route.fulfill({ status: 404, json: { error: "not_found" } });
    }
    return route.fulfill({ headers: { ETag: 'W/"v1"' }, json: record });
  });
}

/** Open a brother's profile by clicking its Directory row link. */
async function openRow(page: Page, lastName: string) {
  await page
    .getByRole("rowheader", { name: new RegExp(lastName) })
    .getByRole("link")
    .click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(lastName) })).toBeVisible();
}

test.describe("relationship links carry the directory-return state (OFC-396)", () => {
  test("'← Directory' after a Big Brother hop returns the filtered view, not a clean one", async ({
    page,
  }) => {
    await mock(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();

    // A filtered view narrowed to one row, so a clean Directory is unmistakably
    // distinguishable from the one the user was working in.
    await page.getByRole("searchbox").fill("adams");
    await openRow(page, "Adams");

    // Follow the Big Brother link out of the filtered set.
    await page.getByRole("link", { name: /Smyth/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();

    // The tell: with the state carried, "← Directory" is the history-walking
    // <button>, not the cold-deep-link <a href="/"> escape hatch.
    await expect(page.getByRole("link", { name: /Directory/ })).toHaveCount(0);
    await page.getByRole("button", { name: /Directory/ }).click();

    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveValue("adams");
  });

  test("the hop re-carries the stashed set, so Prev/Next resume at the target's position", async ({
    page,
  }) => {
    // Forrest's call on the ticket's first sub-decision: the stash travels with the
    // hop. The brother you land on is a member of the set you were browsing, so he
    // gets Prev/Next at HIS index rather than losing the affordance entirely.
    await mock(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();

    await openRow(page, "Adams");
    await expect(page.getByText("1 of 3")).toBeVisible();

    await page.getByRole("link", { name: /Smyth/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();
    // Smyth is position 2 of the same stashed set.
    await expect(page.getByText("2 of 3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next brother" })).toBeEnabled();
  });

  test("a relationship hop stays a push, so Back returns to the brother you came from", async ({
    page,
  }) => {
    // Unlike a Prev/Next step (which replaces — D169), a relationship hop is a
    // genuine branch off the walk, so it pushes and increments the delta.
    await mock(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();

    await openRow(page, "Adams");
    await page.getByRole("link", { name: /Smyth/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: /Adams/ })).toBeVisible();
  });

  test("a cold deep-link's relationship hop still degrades to the plain escape hatch", async ({
    page,
  }) => {
    // Nothing to carry: arriving cold there is no Directory entry one push back, so
    // claiming one would be a lie. "← Directory" stays the real <a href="/"> anchor
    // OFC-145 built for exactly this case.
    await mock(page);
    await page.goto("/brother/5300");
    await expect(page.getByRole("heading", { level: 1, name: /Adams/ })).toBeVisible();

    await page.getByRole("link", { name: /Smyth/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();

    const back = page.getByRole("link", { name: /Directory/ });
    await expect(back).toHaveAttribute("href", "/");
  });

  test("the avatar menu's 'My profile' keeps the Directory you were working in", async ({
    page,
  }) => {
    await mock(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();

    await page.getByRole("searchbox").fill("adams");
    await openRow(page, "Adams");

    // The avatar menu is a <details>/<summary> disclosure carrying the signed-in
    // brother's name — matched the way the other shell specs match it.
    await page.locator("summary").filter({ hasText: "Young" }).click();
    await page.getByRole("link", { name: "My profile" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Young/ })).toBeVisible();

    await page.getByRole("button", { name: /Directory/ }).click();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveValue("adams");
  });
});
