import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * OFC-378 session B — the **Near** filter end to end: the typeahead over three
 * vocabularies, the radius selector, the URL round trip, the lazy load and its
 * two failure paths, and the accessibility pass the design calls out as the part
 * of a combobox most easily got wrong.
 *
 * ⚠ The geo tables are **route-mocked** to a handful of rows. The committed
 * tables are 41,151 ZIPs and 3,590 cities, and parsing them in every case would
 * spend seconds per test to assert nothing this file is about; the real tables'
 * integrity is `assert:geo-tables`' job, and the real resolver's is
 * `proximity.test.ts`'. One case below deliberately serves them anyway, so that
 * the fixture's shape cannot drift from what the generator actually emits.
 */

function meFor(role: "admin" | "brother") {
  return {
    profileId: 5002,
    role,
    realRole: role,
    impersonating: false,
    stars: [] as number[],
    profile: {
      id: 5002,
      firstName: "Dev",
      lastName: "Admin",
      classYear: 1990,
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

/**
 * Five brothers at known distances from Boston (42.34, -71.02):
 * Cambridge ~4 mi, Peabody ~14 mi, Northampton ~84 mi, Mountain View ~2,700 mi,
 * and one in Paris whose postal code collides with a real US ZIP.
 */
const PROFILES = {
  profiles: [
    {
      id: 5001,
      firstName: "Colin",
      lastName: "Cambridge",
      classYear: 1984,
      address: { postalCode: "02139", city: "Cambridge", stateProvince: "MA", country: "US" },
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
    {
      id: 5002,
      firstName: "Dev",
      lastName: "Admin",
      classYear: 1990,
      address: { postalCode: "01960", city: "Peabody", stateProvince: "MA", country: "US" },
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
    {
      id: 5003,
      firstName: "Nora",
      lastName: "Northampton",
      classYear: 1979,
      address: { postalCode: "01060", city: "Northampton", stateProvince: "MA", country: "US" },
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
    {
      id: 5004,
      firstName: "Vic",
      lastName: "Valley",
      classYear: 1995,
      address: { postalCode: "94041", city: "Mountain View", stateProvince: "CA", country: "US" },
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
    {
      id: 5005,
      firstName: "Pierre",
      lastName: "Paris",
      classYear: 2001,
      // 75008 is a real Paris arrondissement AND a real US ZIP. The country is
      // the only thing that keeps him out of a search near Texas.
      address: { postalCode: "75008", city: "Paris", country: "FR" },
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
  ],
  majors: [],
};

/**
 * Fixture tables in exactly the generator's shape — including the `# rows:`
 * declaration, which is not decoration: the app checks its parsed row count
 * against that line to tell a truncated download from a complete one, so a
 * fixture without it would quietly exercise the unverifiable path instead of the
 * real one.
 */
const ZIPS_CSV = [
  "# fixture",
  "# rows: 6",
  "zip,lat,lon",
  "01060,42.32,-72.65",
  "01960,42.53,-70.96",
  "02138,42.38,-71.13",
  "02139,42.36,-71.10",
  "75008,32.53,-95.45",
  "94041,37.39,-122.08",
  "",
].join("\n");

const CITIES_CSV = [
  "# fixture",
  "# rows: 4",
  "city,state,lat,lon",
  "Boston,MA,42.34,-71.02",
  "New Boston,TX,33.46,-94.42",
  "Portland,ME,43.66,-70.26",
  "Portland,OR,45.54,-122.65",
  "",
].join("\n");

/** Serve the fixture tables, or fail every request when `fail` is set. */
async function routeGeo(page: Page, options: { fail?: boolean } = {}) {
  await page.route("**/geo/*.csv", (route) => {
    if (options.fail) {
      return route.fulfill({ status: 503, body: "" });
    }
    const url = route.request().url();
    const body = url.includes("/cities.") ? CITIES_CSV : ZIPS_CSV;
    return route.fulfill({ status: 200, contentType: "text/csv", body });
  });
}

async function gotoDirectory(
  page: Page,
  { role = "admin" as const, url = "/", geo = {} as { fail?: boolean }, realGeo = false } = {},
) {
  await page.route("**/api/me", (route) => route.fulfill({ json: meFor(role) }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: PROFILES }));
  await page.route("**/img/thumbnails/**", (route) => route.fulfill({ status: 404 }));
  if (!realGeo) {
    await routeGeo(page, geo);
  }
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

const filtersFold = (page: Page) => page.getByRole("button", { name: /^Filters/ });
const nearBox = (page: Page) => page.getByRole("combobox", { name: /^Located near —/ });
/**
 * ⚠ Scoped to the Near listbox, never a bare `getByRole("option")`. The filter
 * panel is full of native `<select>`s, and every `<option>` inside one carries
 * the `option` role too — an unscoped locator matches 28 of them here and would
 * make "the dropdown is empty" unassertable.
 */
const nearOption = (page: Page, name?: RegExp) =>
  page.getByRole("listbox", { name: /^Located near —/ }).getByRole("option", name ? { name } : {});
const radius = (page: Page) => page.getByLabel("Located within", { exact: true });
const row = (page: Page, name: RegExp) => page.getByRole("rowheader", { name });
const resetButton = (page: Page) => page.getByRole("button", { name: /Reset search & filters/ });

/** Open the fold and type into Near, which is also what triggers the table fetch. */
async function typeNear(page: Page, text: string) {
  await filtersFold(page).click();
  await nearBox(page).fill(text);
}

test.describe("OFC-378 — picking an origin", () => {
  test("a city narrows the grid and travels in the URL", async ({ page }) => {
    await gotoDirectory(page);
    await typeNear(page, "boston");

    // Both Bostons are offered as plain rows — ambiguity resolved by display, not
    // by an error message (design §7).
    await expect(nearOption(page, /^Boston, MA/)).toBeVisible();
    await expect(nearOption(page, /^New Boston, TX/)).toBeVisible();
    await nearOption(page, /^Boston, MA/).click();

    await expect(page).toHaveURL(/near=c~Boston~MA/);
    // Default radius is 50 miles: Cambridge and Peabody in, Northampton out.
    await expect(row(page, /Colin Cambridge/)).toBeVisible();
    await expect(row(page, /Dev Admin/)).toBeVisible();
    await expect(row(page, /Nora Northampton/)).toHaveCount(0);
    await expect(row(page, /Vic Valley/)).toHaveCount(0);
  });

  test("a ZIP code works — the backstop for towns the city list omits", async ({ page }) => {
    // Design §8: at a population threshold of 10,000 roughly a quarter of
    // brothers cannot find their own town by name, so free ZIP entry is
    // load-bearing rather than a convenience.
    await gotoDirectory(page);
    await typeNear(page, "02138");
    await nearOption(page, /02138/).click();

    await expect(page).toHaveURL(/near=z~02138/);
    await expect(row(page, /Colin Cambridge/)).toBeVisible();
    await expect(row(page, /Vic Valley/)).toHaveCount(0);
  });

  test("another brother works as the origin", async ({ page }) => {
    await gotoDirectory(page);
    await typeNear(page, "valley");
    await nearOption(page, /Vic Valley/).click();

    await expect(page).toHaveURL(/near=b~5004/);
    // Only the brother himself is within 50 miles of Mountain View.
    await expect(row(page, /Vic Valley/)).toBeVisible();
    await expect(row(page, /Colin Cambridge/)).toHaveCount(0);
  });

  test("offers nothing until something is typed", async ({ page }) => {
    // The vocabulary is ~45,000 entries in production; showing its head on focus
    // would be both useless and thousands of DOM nodes.
    await gotoDirectory(page);
    await filtersFold(page).click();
    await nearBox(page).click();
    await expect(page.getByText("Type a city, a ZIP code, or a brother's name.")).toBeVisible();
    await expect(nearOption(page)).toHaveCount(0);
  });

  test("says so plainly when nothing matches", async ({ page }) => {
    await gotoDirectory(page);
    await typeNear(page, "zzzz");
    await expect(page.getByText("No matching place or brother.")).toBeVisible();
  });
});

test.describe("OFC-378 — the chosen origin", () => {
  test("shows as a chip that replaces the box, and clears from the label row", async ({ page }) => {
    await gotoDirectory(page, { url: "/?near=c~Boston~MA" });
    await filtersFold(page).click();

    await expect(page.getByText("Boston, MA", { exact: true })).toBeVisible();
    await expect(nearBox(page)).toHaveCount(0);

    await page.getByRole("button", { name: /Clear Located near/i }).click();

    await expect(page).not.toHaveURL(/near=/);
    await expect(nearBox(page)).toBeVisible();
    await expect(row(page, /Vic Valley/)).toBeVisible();
  });

  test("counts as one active filter — the radius is not a second", async ({ page }) => {
    await gotoDirectory(page, { url: "/?near=c~Boston~MA&radius=25" });
    await expect(page.getByText("1 active")).toBeVisible();
  });
});

test.describe("OFC-378 — the radius", () => {
  test("is disabled until an origin is chosen", async ({ page }) => {
    await gotoDirectory(page);
    await filtersFold(page).click();
    await expect(radius(page)).toBeDisabled();

    await nearBox(page).fill("boston");
    await nearOption(page, /^Boston, MA/).click();
    await expect(radius(page)).toBeEnabled();
  });

  test("widens and narrows the result set", async ({ page }) => {
    await gotoDirectory(page, { url: "/?near=c~Boston~MA" });
    await expect(row(page, /Nora Northampton/)).toHaveCount(0);

    await filtersFold(page).click();
    await radius(page).selectOption("100");
    await expect(page).toHaveURL(/radius=100/);
    await expect(row(page, /Nora Northampton/)).toBeVisible();

    await radius(page).selectOption("25");
    // Peabody is ~14 miles out and stays; Northampton is ~84 and goes.
    await expect(row(page, /Dev Admin/)).toBeVisible();
    await expect(row(page, /Nora Northampton/)).toHaveCount(0);
  });

  test("ignores a hand-edited value rather than honouring it", async ({ page }) => {
    // `?radius=37` is not one of the offered radii; the control and the filter
    // must agree, so it falls back to the default rather than quietly applying 37.
    await gotoDirectory(page, { url: "/?near=c~Boston~MA&radius=37" });
    await filtersFold(page).click();
    await expect(radius(page)).toHaveValue("50");
    await expect(row(page, /Dev Admin/)).toBeVisible();
    await expect(row(page, /Nora Northampton/)).toHaveCount(0);
  });
});

test.describe("OFC-378 — a shared proximity link", () => {
  test("narrows without the Filters fold ever being opened", async ({ page }) => {
    // The trigger no interaction provides: a link arrives with the panel closed,
    // so the URL parameter has to start the table fetch by itself.
    await gotoDirectory(page, { url: "/?near=c~Boston~MA&radius=25" });
    await expect(filtersFold(page)).toHaveAttribute("aria-expanded", "false");
    await expect(row(page, /Colin Cambridge/)).toBeVisible();
    await expect(row(page, /Vic Valley/)).toHaveCount(0);
  });

  test("leaves the view UNNARROWED and says why when the place is unknown", async ({ page }) => {
    // ⚠ The distinction the whole loading path exists to preserve: an empty grid
    // would answer "no brothers live there", which is not what happened.
    await gotoDirectory(page, { url: "/?near=c~Nowhere~ZZ" });
    await expect(page.getByText(/couldn't find that location/)).toBeVisible();
    await expect(row(page, /Vic Valley/)).toBeVisible();
    await expect(row(page, /Pierre Paris/)).toBeVisible();
  });

  test("announces the unapplied filter to a screen reader, not only on screen", async ({
    page,
  }) => {
    // ⚠ The regression this pins. In this state the Directory stays UNNARROWED by
    // design, so the result count never changes and its own polite region never
    // fires — and the Near control's copy of this message is not even mounted,
    // because the Filters fold starts collapsed. If this line is not itself a live
    // region, a screen-reader user following a shared link to an unresolvable place
    // is told nothing at all while a sighted one reads the notice. axe cannot catch
    // that: the markup is valid either way. Found in the OFC-378 review round.
    await gotoDirectory(page, { url: "/?near=c~Nowhere~ZZ" });
    const notice = page.locator("p[aria-live='polite']", {
      hasText: /couldn't find that location/,
    });
    await expect(notice).toBeVisible();
    // Mounted before the text arrives, too — a live region created *with* its
    // content is not reliably announced.
    await gotoDirectory(page, { url: "/" });
    await expect(page.locator("p[aria-live='polite']")).not.toHaveCount(0);
  });

  test("survives the tables failing to load, and says so", async ({ page }) => {
    await gotoDirectory(page, { url: "/?near=c~Boston~MA", geo: { fail: true } });
    await expect(page.getByText(/location data couldn't be loaded/i)).toBeVisible();
    // The Directory itself is untouched — proximity degrades, nothing else does.
    await expect(row(page, /Vic Valley/)).toBeVisible();
    await filtersFold(page).click();
    // ⚠ `getByRole("textbox", …)`, not `getByLabel("City")` — the latter matches
    // the Columns picker's City checkbox as well as this input, a selector trap
    // this repo has been caught by before.
    await expect(page.getByRole("textbox", { name: "City", exact: true })).toBeEditable();
  });

  test("a malformed token is simply ignored", async ({ page }) => {
    await gotoDirectory(page, { url: "/?near=nonsense" });
    await expect(row(page, /Vic Valley/)).toBeVisible();
    await filtersFold(page).click();
    // No chip, no notice: an unreadable token is not a filter at all.
    await expect(nearBox(page)).toBeVisible();
    await expect(page.getByText(/couldn't find that location/)).toHaveCount(0);
  });
});

test.describe("OFC-378 — composition and Reset", () => {
  test("ANDs with another filter", async ({ page }) => {
    await gotoDirectory(page, { url: "/?near=c~Boston~MA&radius=100&classYear=1984" });
    await expect(row(page, /Colin Cambridge/)).toBeVisible();
    // In range but the wrong year, and the right year but out of range.
    await expect(row(page, /Dev Admin/)).toHaveCount(0);
    await expect(row(page, /Vic Valley/)).toHaveCount(0);
  });

  test("excludes a brother whose country says he is not in the US", async ({ page }) => {
    // 75008 resolves to a real ZIP in Texas. Searching near it must not find Paris.
    await gotoDirectory(page, { url: "/?near=z~75008&radius=100" });
    await expect(page.getByText(/couldn't find that location/)).toHaveCount(0);
    await expect(row(page, /Pierre Paris/)).toHaveCount(0);
  });

  test("Reset clears both the origin and the radius", async ({ page }) => {
    await gotoDirectory(page, { url: "/?near=c~Boston~MA&radius=25" });
    await expect(resetButton(page)).toBeEnabled();
    await resetButton(page).click();

    await expect(page).not.toHaveURL(/near=/);
    await expect(page).not.toHaveURL(/radius=/);
    await expect(row(page, /Vic Valley/)).toBeVisible();
    await expect(resetButton(page)).toBeDisabled();
  });

  test("a stray radius alone enables Reset", async ({ page }) => {
    // It narrows nothing, but Reset would change the URL — so claiming otherwise
    // by greying the button out would be the lie OFC-394 already fixed once.
    await gotoDirectory(page, { url: "/?radius=100" });
    await expect(resetButton(page)).toBeEnabled();
  });

  test("...including a radius that is not one of the offered ones", async ({ page }) => {
    // ⚠ The regression this pins: `canReset` must test the RAW parameter, not the
    // validated one. Validation folds `37` down to the default, so a check on the
    // validated value greys Reset out on a URL Reset does in fact change. Found in
    // the OFC-378 review round; `?radius=100` above passes either way.
    await gotoDirectory(page, { url: "/?radius=37" });
    await expect(resetButton(page)).toBeEnabled();
    await resetButton(page).click();
    await expect(page).not.toHaveURL(/radius=/);
  });
});

test.describe("OFC-378 — the proximity card (live-test findings)", () => {
  test("both controls live inside one card, at the foot of the filters", async ({ page }) => {
    // They are one filter and its parameter, not two independent settings, and
    // the card is what says so. Scoping the lookups to it is also what proves
    // they are inside it rather than merely near it.
    await gotoDirectory(page);
    await filtersFold(page).click();

    const card = page
      .locator("div")
      .filter({ hasText: /^Proximity search/ })
      .last();
    await expect(card.getByRole("combobox", { name: /^Located near —/ })).toBeVisible();
    await expect(card.getByLabel("Located within", { exact: true })).toBeVisible();

    // At the foot of the all-roles filters: below every other filter control.
    // ⚠ `getByRole("combobox", …)`, not `getByLabel("Staff")` — that matches the
    // Columns picker's Staff checkbox as well as this select. Third time in this
    // file; the rule is to name the role whenever a filter shares its label with
    // a column.
    const staffBox = await page.getByRole("combobox", { name: "Staff", exact: true }).boundingBox();
    const nearBoxRect = await nearBox(page).boundingBox();
    expect(nearBoxRect?.y).toBeGreaterThan(staffBox?.y ?? 0);
  });

  test("the two controls sit on a shared line rather than stepping", async ({ page }) => {
    // ⚠ Overlapping extents, never equal coordinates (N154/N163) — a guard that
    // asserted a shared `y` once passed on Windows and failed CI by 19.5px on
    // Linux font metrics. The reported bug was a 4px step, caused by the shared
    // Combobox carrying the profile page's roomier metrics into a panel built
    // from compact ones; overlap catches that without pinning a pixel.
    await gotoDirectory(page);
    await filtersFold(page).click();

    const near = await nearBox(page).boundingBox();
    const within = await radius(page).boundingBox();
    expect(near).not.toBeNull();
    expect(within).not.toBeNull();
    const overlap =
      Math.min((near?.y ?? 0) + (near?.height ?? 0), (within?.y ?? 0) + (within?.height ?? 0)) -
      Math.max(near?.y ?? 0, within?.y ?? 0);
    expect(overlap).toBeGreaterThan(0.9 * Math.min(near?.height ?? 0, within?.height ?? 0));

    // The second half of the old bug was that the box was *bigger*, not just
    // offset. ⚠ That is asserted on the **computed metrics**, not on rendered
    // height: an `<input>` and a native `<select>` legitimately differ by a
    // pixel or two, and the first draft of this guard — which compared heights
    // with a 2px tolerance — passed on Windows and failed CI at exactly 2px on
    // Linux. That is the same "the build machine is not the test machine" trap
    // (N154/N163) the comment above cites, walked into three lines later. Font
    // size and vertical padding are what `dense` actually controls, so they are
    // what this compares: platform-independent, and a direct test of the defect
    // rather than of one of its symptoms.
    const metrics = (selector: "near" | "within") =>
      (selector === "near" ? nearBox(page) : radius(page)).evaluate((el) => {
        const s = getComputedStyle(el);
        return { fontSize: s.fontSize, top: s.paddingTop, bottom: s.paddingBottom };
      });
    expect(await metrics("near")).toEqual(await metrics("within"));
  });

  test("the help text says what happens to a private address", async ({ page }) => {
    await gotoDirectory(page);
    await filtersFold(page).click();
    await page.getByRole("button", { name: /Help: Located near/i }).click();
    await expect(
      page.getByText(/Brothers who keep their address private will not be found by this filter\./),
    ).toBeVisible();
  });
});

test.describe("OFC-378 — keyboard and accessibility", () => {
  test("is fully operable from the keyboard", async ({ page }) => {
    // The combobox is the part design §7 flags as easiest to get wrong, and the
    // repo has already had one dismissal bug that only a keyboard test found.
    await gotoDirectory(page);
    await filtersFold(page).click();
    await nearBox(page).focus();
    await page.keyboard.type("portland");

    await expect(nearOption(page, /Portland, ME/)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/near=c~Portland~/);
  });

  test("Escape closes the list without choosing anything", async ({ page }) => {
    await gotoDirectory(page);
    await filtersFold(page).click();
    await nearBox(page).focus();
    await page.keyboard.type("boston");
    await expect(nearBox(page)).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");

    await expect(nearBox(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page).not.toHaveURL(/near=/);
  });

  test("has no axe violations with the list open", async ({ page }) => {
    await gotoDirectory(page);
    await typeNear(page, "boston");
    await expect(nearOption(page, /^Boston, MA/)).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test("has no axe violations with an origin chosen", async ({ page }) => {
    await gotoDirectory(page, { url: "/?near=c~Boston~MA" });
    await filtersFold(page).click();
    await expect(page.getByText("Boston, MA", { exact: true })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("OFC-378 — against the real committed tables", () => {
  test("resolves a real city out of the shipped vocabulary", async ({ page }) => {
    // ⚠ The one case that does NOT mock the tables. Everything above would pass
    // just as well against a fixture whose column order or provenance block had
    // drifted from what `tools/geo-data` actually emits; this is what notices.
    // Brookline is one of the New England towns the D172 population-join trap
    // silently deleted, so it doubles as a live check that the join is still fixed.
    await gotoDirectory(page, { realGeo: true });
    await filtersFold(page).click();
    await nearBox(page).fill("brookline, ma");
    await expect(nearOption(page, /^Brookline, MA/)).toBeVisible();
    await nearOption(page, /^Brookline, MA/).click();

    await expect(page).toHaveURL(/near=c~Brookline~MA/);
    // 02139 is a few miles from Brookline; Mountain View is not.
    await expect(row(page, /Colin Cambridge/)).toBeVisible();
    await expect(row(page, /Vic Valley/)).toHaveCount(0);
  });
});
