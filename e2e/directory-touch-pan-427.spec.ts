import { type Locator, type Page, expect, test } from "@playwright/test";

/**
 * Touch panning on the Directory grid from a tablet (OFC-427).
 *
 * The pinned identity columns (Select, Star, Thumbnail, Name) are `position: sticky`
 * inside the same scroll container as the data columns, so a vertical swipe that
 * started on them and drifted even slightly sideways also panned the data columns
 * left and right. A swipe that starts on a column that cannot itself move sideways
 * must not move the others sideways either.
 *
 * Touches are injected through CDP `Input.dispatchTouchEvent`, which enters
 * Chromium's real input pipeline — gesture recognition, touch-action and the
 * compositor's scrolling — rather than synthesizing DOM events a page could only
 * observe. Two positive controls keep a zero from passing vacuously (N141): the same
 * harness must pan sideways when the swipe starts on a data column, and must still
 * scroll vertically when it starts on a pinned one.
 *
 * ⚠ **The swipe angle matters.** Chromium "rails" a touch scroll that starts within
 * roughly 27° of vertical, locking it to the vertical axis — so a nearly-vertical
 * swipe passes even on the unfixed grid, and only a steeper diagonal reproduces the
 * bug here (measured: a 45° swipe from the Name cell panned the data columns 246px
 * before the fix). iPadOS Safari evidently rails far less, which is why a slight
 * drift was enough on the reporter's tablet. The tests therefore swipe at 45°.
 *
 * ⚠ Chromium only (the Android-tablet engine). iPadOS Safari cannot be driven from
 * this machine (N154–N157); it is confirmed by hand on the device.
 */

const ME = {
  profileId: 5002,
  role: "admin" as const,
  realRole: "admin" as const,
  impersonating: false,
  stars: [],
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

const GENERATED = Array.from({ length: 200 }, (_, i) => ({
  id: 6000 + i,
  firstName: "William",
  lastName: `Webster${String(i + 1).padStart(4, "0")}`,
  classYear: 1970 + (i % 40),
  deceased: { isDeceased: false },
  hasHeadshot: false,
  email: `test${i + 1}@example.test`,
  address: { city: "Cambridge", stateProvince: "MA", country: "US" },
}));

// A portrait tablet: narrow enough that the default admin columns overflow.
test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

async function gotoDirectory(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: GENERATED, majors: [] } }),
  );
  await page.route("**/img/thumbnails/**", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
  await page.getByTestId("directory-scroll").getByRole("link").first().waitFor();
}

/** One finger, pressed at `from` and dragged by (dx, dy) in small steps, then lifted. */
async function swipe(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  const steps = 20;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y }],
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + (dx * i) / steps, y: from.y + (dy * i) / steps }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** The centre of a locator's box, which must be on screen. */
async function centreOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("no box");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const scrollOf = (scroller: Locator) =>
  scroller.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));

// A body row a little way down, so a swipe has room in both directions.
const sampleRow = (page: Page) => page.getByRole("row", { name: /Webster0003/ });

test("a swipe starting on a pinned column scrolls vertically and never sideways", async ({
  page,
}) => {
  await gotoDirectory(page);
  const scroller = page.getByTestId("directory-scroll");
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  // Up and sideways at once, at 45° so Chromium's rails cannot mask it (see above).
  const name = sampleRow(page).getByRole("rowheader");
  await swipe(page, await centreOf(name), -250, -250);

  const after = await scrollOf(scroller);
  expect(after.top, "the vertical half of the swipe still scrolls").toBeGreaterThan(0);
  expect(after.left, "the sideways half moves nothing").toBe(0);
});

test("the same swipe on the Select column does not pan sideways either", async ({ page }) => {
  await gotoDirectory(page);
  const scroller = page.getByTestId("directory-scroll");
  const select = sampleRow(page).getByRole("checkbox");
  await swipe(page, await centreOf(select), -250, -250);
  expect((await scrollOf(scroller)).left).toBe(0);
});

test("a purely sideways swipe on a pinned column moves nothing", async ({ page }) => {
  await gotoDirectory(page);
  const scroller = page.getByTestId("directory-scroll");
  const name = sampleRow(page).getByRole("rowheader");
  await swipe(page, await centreOf(name), -300, 0);
  expect(await scrollOf(scroller)).toEqual({ left: 0, top: 0 });
});

test("positive control: a sideways swipe on a data column still pans", async ({ page }) => {
  await gotoDirectory(page);
  const scroller = page.getByTestId("directory-scroll");
  // The last cell in the row is a data column, never a pinned one.
  const dataCell = sampleRow(page).getByRole("cell").last();
  const box = await scroller.boundingBox();
  const cell = await centreOf(dataCell);
  // Start inside the visible part of the grid, on that cell's row.
  const from = { x: Math.min(cell.x, (box?.x ?? 0) + (box?.width ?? 0) - 40), y: cell.y };
  await swipe(page, from, -250, 0);
  await expect.poll(async () => (await scrollOf(scroller)).left).toBeGreaterThan(0);
});
