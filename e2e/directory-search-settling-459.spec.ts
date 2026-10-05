import AxeBuilder from "@axe-core/playwright";
import { type Page, type Route, expect, test } from "@playwright/test";

/**
 * The Directory must not claim "No brothers match" while Name Search is still
 * working (OFC-459, diagnosed on OFC-458).
 *
 * Name Search answers in two layers (D110): a main-thread substring match at
 * once, then the Web Worker's fuzzy + phonetic + nickname match when its index is
 * built. For a misspelling the interim substring set is legitimately EMPTY — so
 * before the fix the page rendered its empty state (and a "0 of N" count in the
 * polite live region) until the worker answered: a false "no such brother".
 *
 * The worker's script request is held at the network layer, which reproduces
 * the window deterministically at any machine speed: a reload with `?q=`, and
 * Back from a profile (the Directory terminates its worker on unmount, so the
 * index rebuilds). "smyth" is the probe: no substring of any name, but the
 * worker's Beider-Morse arm finds Karl Smith.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const PRIVACY = {
  shareEmail: true,
  sharePhone: true,
  shareAddress: true,
  shareEmergency: false,
  shareSpousePartner: false,
};

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
    privacy: PRIVACY,
    unlisted: false,
    allowNewsletterEmail: true,
    allowShareWithMITAA: false,
    lastModified: "2026-06-03T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
  },
};

const BROTHERS = [
  { id: 5002, firstName: "Dev", lastName: "Admin", classYear: 1990 },
  { id: 5007, firstName: "Karl", lastName: "Smith", classYear: 1992 },
  { id: 5008, firstName: "Aaron", lastName: "Adams", classYear: 1984 },
].map((b) => ({ ...b, deceased: { isDeceased: false }, hasHeadshot: false }));

const TOTAL = BROTHERS.length;

/** The search worker's script, as Vite emits it into the production bundle. */
const WORKER_SCRIPT = /search\.worker[^/]*\.js(\?.*)?$/;

/** Holds every worker-script request until `release()`; `failNext` aborts instead. */
function workerGate() {
  let held: Route[] = [];
  let holding = false;
  let failing = false;
  return {
    hold() {
      holding = true;
    },
    fail() {
      failing = true;
    },
    async handle(route: Route) {
      if (failing) {
        return route.abort();
      }
      if (holding) {
        held.push(route);
        return;
      }
      return route.continue();
    },
    async release() {
      holding = false;
      const pending = held;
      held = [];
      for (const route of pending) {
        await route.continue();
      }
    },
  };
}

async function mockApi(page: Page, gate: ReturnType<typeof workerGate>) {
  await page.route(WORKER_SCRIPT, (route) => gate.handle(route));
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: BROTHERS, majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    const id = Number(/(\d+)$/.exec(route.request().url())?.[1]);
    const b = BROTHERS.find((p) => p.id === id) ?? BROTHERS[0];
    route.fulfill({
      headers: { ETag: "v1" },
      json: {
        ...b,
        debrothered: { isDebrothered: false },
        privacy: PRIVACY,
        unlisted: false,
        allowNewsletterEmail: true,
        allowShareWithMITAA: false,
        lastModified: "2026-06-03T12:00:00.000Z",
        newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
      },
    });
  });
}

/** The count line under the Directory heading — the polite live region. */
function countLine(page: Page) {
  return page.getByRole("heading", { name: "Directory" }).locator("xpath=following-sibling::p[1]");
}

test("a reload with ?q= shows 'Searching…', never a false 'No brothers match'", async ({
  page,
}) => {
  const gate = workerGate();
  gate.hold();
  await mockApi(page, gate);
  await page.goto("/?q=smyth");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();

  // The roster is in; the worker is not. The interim substring set is empty.
  await expect(page.getByText("Searching…", { exact: true }).first()).toBeVisible();
  await expect(countLine(page)).toHaveText("Searching…");
  await expect(page.getByText(/No brothers match/)).toHaveCount(0);
  const a11y = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(a11y.violations).toEqual([]);

  await gate.release();
  await expect(page.getByRole("rowheader", { name: /Karl Smith/ })).toBeVisible();
  await expect(countLine(page)).toHaveText(`1 of ${TOTAL} brothers`);
  await expect(page.getByText("Searching…", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/No brothers match/)).toHaveCount(0);
});

test("Back from a profile shows 'Searching…' while the index rebuilds", async ({ page }) => {
  const gate = workerGate();
  await mockApi(page, gate);
  await page.goto("/?q=smyth");
  await page
    .getByRole("rowheader", { name: /Karl Smith/ })
    .getByRole("link")
    .click();
  await expect(page.getByRole("heading", { level: 1, name: /Karl/ })).toBeVisible();

  // The Directory remounts with the roster retained but a fresh worker to build.
  gate.hold();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
  await expect(countLine(page)).toHaveText("Searching…");
  await expect(page.getByText(/No brothers match/)).toHaveCount(0);

  await gate.release();
  await expect(page.getByRole("rowheader", { name: /Karl Smith/ })).toBeVisible();
});

test("a query that genuinely matches nobody still says so, once settled", async ({ page }) => {
  const gate = workerGate();
  await mockApi(page, gate);
  await page.goto("/?q=zzqxv");
  await expect(page.locator("[data-search-ready='true']")).toBeAttached();
  await expect(page.getByText("No brothers match “zzqxv”.")).toBeVisible();
  await expect(countLine(page)).toHaveText(`0 of ${TOTAL} brothers`);
  await expect(page.getByText("Searching…", { exact: true })).toHaveCount(0);
});

test("if the search worker cannot load, the substring answer stands — no endless 'Searching…'", async ({
  page,
}) => {
  const gate = workerGate();
  gate.fail();
  await mockApi(page, gate);
  await page.goto("/?q=smyth");
  // Progressive enhancement (D110): without the worker, substring matching is the
  // whole answer, so the page must settle on it rather than wait forever.
  await expect(page.getByText("No brothers match “smyth”.")).toBeVisible();
  await expect(countLine(page)).toHaveText(`0 of ${TOTAL} brothers`);
  await page.getByRole("searchbox", { name: /name search/i }).fill("smi");
  await expect(page.getByRole("rowheader", { name: /Karl Smith/ })).toBeVisible();
});
