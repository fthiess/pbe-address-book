import { type Page, type Route, expect, test } from "@playwright/test";

/**
 * Stage 1.3 — the D119 loading overlay's escalating reassurance line (OFC-324).
 *
 * D119 specifies two thresholds, not one: the overlay appears past ~500 ms, and
 * *only if the wait runs longer* (~3–4 s) does it add the "waking the server"
 * reassurance. `LoadingOverlay` shipped the reassurance unconditionally, so every
 * wait past 500 ms — on a warm instance, at all three call sites — told the reader
 * the server was asleep. 7b-1 measured that happening on every throttled load
 * (N134).
 *
 * The delays here are mocked rather than throttled: `page.route` holds the
 * response for a chosen number of milliseconds, so both thresholds are exercised
 * deterministically instead of racing real network conditions.
 *
 * ⚠ A cold instance is genuinely possible at **all three** sites, not just at the
 * session gate. Cloud Run scales to zero (D83), so a tab left open past the idle
 * window has a loaded SPA and a shut-down backend: the next click really does wake
 * it. What makes the line honest is the *threshold*, not the call site.
 */

const OWN_ID = 5002;

const WAKE_LINE = "Waking the server — this can take a few seconds.";
const STILL_LOADING = "Still loading…";

/** Past the 500 ms overlay threshold, comfortably short of the 3.5 s escalation. */
const BELOW_ESCALATION_MS = 3000;
/** Long enough for the 3.5 s escalation to fire while the request is still open. */
const ABOVE_ESCALATION_MS = 6000;

/**
 * Assert a line is absent **at this instant**, rather than polling until it goes.
 *
 * `toBeHidden()` would be wrong here and silently useless: it waits, and every one
 * of these waits ends with the response arriving and the whole overlay unmounting,
 * so a polling assertion passes on the unmount no matter what the line did while
 * the overlay was up. The first draft of this spec passed for exactly that reason
 * against the unfixed component.
 */
async function expectNotShowing(page: Page, text: string) {
  expect(await page.getByText(text).isVisible()).toBe(false);
}

function profileDoc(over: Record<string, unknown> = {}) {
  return {
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
    allowShareWithMITAA: false,
    lastModified: "2026-06-03T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
    ...over,
  };
}

const ownProfile = profileDoc();

const meDoc = {
  profileId: OWN_ID,
  role: "admin",
  realRole: "admin",
  impersonating: false,
  stars: [] as number[],
  profile: ownProfile,
};

/** Fulfil `route` with `json`, but only after `delayMs` — a stalled response. */
async function fulfilAfter(route: Route, delayMs: number, json: unknown) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  await route.fulfill({ json });
}

const overlay = (page: Page) => page.locator("output[aria-live='polite']");

test.describe("Stage 1.3 — D119 overlay escalation (OFC-324)", () => {
  test("session gate: a short wait shows the overlay WITHOUT blaming the server", async ({
    page,
  }) => {
    await page.route("**/api/me", (route) => fulfilAfter(route, BELOW_ESCALATION_MS, meDoc));
    await page.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: [ownProfile], majors: [] } }),
    );

    await page.goto("/");

    // The overlay itself is correct behaviour past 500 ms — it is the *attribution*
    // that was wrong. This is the assertion that fails before the fix.
    await expect(overlay(page)).toContainText("Loading the directory…");
    await expectNotShowing(page, WAKE_LINE);
  });

  test("session gate: a long wait escalates to the wake-the-server line", async ({ page }) => {
    await page.route("**/api/me", (route) => fulfilAfter(route, ABOVE_ESCALATION_MS, meDoc));
    await page.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: [ownProfile], majors: [] } }),
    );

    await page.goto("/");

    await expect(overlay(page)).toContainText("Loading the directory…");
    // Hidden at first...
    await expectNotShowing(page, WAKE_LINE);
    // ...and appears once the wait passes ~3.5 s, while the request is still open.
    await expect(page.getByText(WAKE_LINE)).toBeVisible({ timeout: 5000 });
  });

  test("directory: a stalled bulk load escalates to 'Still loading…', never to the server line", async ({
    page,
  }) => {
    await page.route("**/api/me", (route) => route.fulfill({ json: meDoc }));
    await page.route("**/api/profiles", (route) =>
      fulfilAfter(route, ABOVE_ESCALATION_MS, { profiles: [ownProfile], majors: [] }),
    );

    await page.goto("/");

    await expect(page.getByText(STILL_LOADING)).toBeVisible({ timeout: 5000 });
    // The bulk payload is ~1 MB and the instance is warm by this point (the session
    // fetch just succeeded), so attributing this wait to a sleeping server would be
    // a guess — and naming the reader's connection would be a rude one.
    await expectNotShowing(page, WAKE_LINE);
  });

  test("profile: a stalled record read escalates to the wake-the-server line", async ({ page }) => {
    await page.route("**/api/me", (route) => route.fulfill({ json: meDoc }));
    await page.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: [ownProfile], majors: [] } }),
    );
    await page.route(/\/api\/profiles\/\d+$/, (route) =>
      fulfilAfter(route, ABOVE_ESCALATION_MS, ownProfile),
    );

    await page.goto(`/brother/${OWN_ID}`);

    // Below the threshold the overlay must not blame the server...
    await expect(overlay(page)).toBeVisible();
    await expectNotShowing(page, WAKE_LINE);
    // ...but a single record is a tiny payload, so a multi-second wait for one really
    // does mean a cold instance — the D83 scale-to-zero case a left-open tab hits.
    await expect(page.getByText(WAKE_LINE)).toBeVisible({ timeout: 5000 });
  });
});
