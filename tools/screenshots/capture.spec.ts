import { fileURLToPath } from "node:url";

import { type Page, expect, test } from "@playwright/test";

import type { Profile } from "../../packages/shared/src/types.js";
import { COLLISION_COUNT, generateProfiles } from "../fake-data/src/generate.js";

/**
 * Captures the USER-MANUAL and root-README illustrations (N119). Run with
 * `npm run docs:screenshots`; see `playwright.screenshots.config.ts` for why
 * this lives outside the e2e suite.
 *
 * Everything here is deterministic on purpose — a fixed generator seed, a fixed
 * roster size, a fixed viewport, and animations disabled — so re-running it
 * produces byte-identical files unless the UI actually changed. That makes
 * `git status` after a run a genuine signal ("the interface moved") rather than
 * noise, which is the only thing that keeps illustrations honest over time.
 *
 * **No real member data can appear here.** The roster comes from
 * `tools/fake-data`, whose records carry `example.test` emails and Constitution
 * IDs above the #5000 fake floor, and the app is driven against network mocks —
 * it never reaches a real API. This matters: the repo is public.
 */

const OUT = fileURLToPath(new URL("../../docs/images/", import.meta.url));

/** Enough brothers to fill the viewport and show the scroll affordance. */
const ROSTER_SIZE = 60;
const SEED = 0x6c2;

const roster = buildRoster();
const subject = pickSubject();

/**
 * A roster with photos on, so the Directory and Profile shots show the avatar
 * treatment rather than a column of initials. The generator's own headshot
 * flags are sparse by design (they model reality, where most brothers have no
 * photo on file); for an illustration we want the populated case.
 */
function buildRoster(): Profile[] {
  const profiles = generateProfiles({ count: ROSTER_SIZE, seed: SEED });

  return profiles.map((profile, i) => ({
    ...profile,
    // Every third brother without a photo, so the mixed state — the one a
    // reader will actually see — is what the illustration shows.
    hasHeadshot: i % 3 !== 0,
    headshotVersion: "v1",
  }));
}

/**
 * The brother the Profile shots are taken of, chosen from the roster rather than
 * synthesized — so his row in the Directory shot and his profile page are the
 * same record, id and all. Three constraints, each for a reason:
 *
 *  - **not one of the planted pair.** `generateProfiles` deliberately gives its
 *    first `COLLISION_COUNT` records an identical name to exercise the canonical-
 *    name disambiguator, so those render as "William Evan '19 (#5001)". A
 *    deliberate edge case is the wrong thing to illustrate the ordinary profile.
 *  - **a plain brother**, so the shots don't carry a Manager/Administrator badge
 *    in sections of the manual addressed to every member.
 *  - **fully populated**, so the illustration shows the fields §4 describes
 *    rather than a page of blanks.
 */
function pickSubject(): Profile {
  const candidate = roster
    .slice(COLLISION_COUNT)
    .find(
      (p) =>
        p.role === "brother" &&
        p.hasHeadshot &&
        p.address &&
        p.employerName &&
        p.majors?.length &&
        !p.deceased.isDeceased &&
        !p.debrothered.isDebrothered &&
        !p.unlisted,
    );

  if (!candidate) {
    throw new Error(
      "[screenshots] no fully-populated plain brother in the generated roster — " +
        "raise ROSTER_SIZE or relax the constraints in pickSubject().",
    );
  }

  return candidate;
}

/**
 * Wire the session, roster, and image mocks, force dark mode, and clear the
 * persisted column lens so the Directory always shows its default columns.
 */
async function open(
  page: Page,
  path: string,
  options: { role?: "brother" | "admin"; viewport?: { width: number; height: number } } = {},
): Promise<void> {
  const role = options.role ?? "brother";
  const viewport = options.viewport ?? { width: 1280, height: 800 };

  await page.setViewportSize(viewport);

  await page.addInitScript(() => {
    // The app's own no-FOUC reader (apps/web/index.html) keys off this, so
    // setting it before first paint avoids a light-mode flash in the capture.
    localStorage.setItem("book-theme", "dark");
    localStorage.removeItem("book-font-size");
    localStorage.removeItem("pbe.book.directory.columns.v1");
  });

  const me = {
    profileId: subject.id,
    role,
    realRole: role,
    impersonating: false,
    stars: [] as number[],
    profile: subject,
  };

  await page.route("**/api/me", (route) => route.fulfill({ json: me }));
  await page.route("**/api/banner", (route) => route.fulfill({ json: { active: false } }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: roster, majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, (route) =>
    route.fulfill({ headers: { ETag: 'W/"v1"' }, json: subject }),
  );
  await page.route("**/api/admin/bug-reports", (route) => route.fulfill({ json: { reports: [] } }));

  // Real WEBP bytes from the committed fake-data fixtures, so the avatars look
  // like photographs rather than broken-image fallbacks.
  await page.route("**/img/thumbnails/**", (route) =>
    route.fulfill({ path: fixture("thumbnails", route.request().url()) }),
  );
  await page.route("**/img/headshots/**", (route) =>
    route.fulfill({ path: fixture("headshots", route.request().url()) }),
  );

  // Reduced motion is emulated *before* the first paint, and the belt-and-braces
  // stylesheet goes in immediately after load — before any test interacts with
  // the page. Injecting it only at capture time is not enough: a fold opened by
  // a click would still animate, and the shot would land mid-transition at a
  // slightly different point each run (this cost the mobile shot its
  // reproducibility until the ordering was fixed).
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto(path);
  await freezeMotion(page);
}

async function freezeMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
      scroll-behavior: auto !important;
    }`,
  });
}

/** Pick a placeholder deterministically from the requested id, so a brother keeps one face. */
function fixture(kind: "thumbnails" | "headshots", url: string): string {
  const id = Number(url.match(/\/(\d+)\//)?.[1] ?? 0);
  const index = id % 8;

  return fileURLToPath(
    new URL(`../fake-data/fixtures/${kind}/placeholder-${index}.webp`, import.meta.url),
  );
}

/**
 * Settle the page before capturing: fonts loaded, images decoded, animations
 * off. Without this the shots vary run to run in ways that look like UI changes.
 */
async function settle(page: Page): Promise<void> {
  // Re-applied because a client-side route change can remount the tree; cheap,
  // and it keeps the guarantee if a shot ever navigates after `open()`.
  await freezeMotion(page);

  // Hide the footer's build-id line. It carries the deployed commit SHA (plus
  // "-dirty" in a working tree), so leaving it in would change every shot on
  // every commit — turning a real "the UI moved" signal into constant churn,
  // and shipping a meaningless-to-members build id into the manual. The rest of
  // the footer, including the privacy notice, stays.
  await page.evaluate(() => {
    for (const p of document.querySelectorAll("footer p")) {
      if (p.textContent?.trimStart().startsWith("Version ")) {
        (p as HTMLElement).style.visibility = "hidden";
      }
    }
  });

  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
}

async function shoot(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: options.fullPage ?? false });
}

test("directory", async ({ page }) => {
  await open(page, "/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
  await expect(page.getByRole("row").nth(3)).toBeVisible();

  await shoot(page, "directory");
});

// Full-page for the two content pages: §4/§5 and §7 describe them section by
// section, and a viewport crop would cut the later sections off mid-sentence.
test("profile view", async ({ page }) => {
  await open(page, `/brother/${subject.id}`);
  await expect(page.getByRole("link", { name: "Edit profile" })).toBeVisible();

  await shoot(page, "profile-view", { fullPage: true });
});

test("profile edit — privacy and consent switches", async ({ page }) => {
  await open(page, `/brother/${subject.id}/edit`);

  const heading = page.getByText("Privacy & consent", { exact: false }).first();
  await expect(heading).toBeVisible();

  // Put the section's heading at the top of the frame rather than wherever
  // scrollIntoViewIfNeeded happens to leave it — otherwise the shot opens on a
  // half-cropped field from the section above.
  await heading.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
  await page.evaluate(() => window.scrollBy(0, -32));

  await shoot(page, "profile-edit-privacy");
});

test("admin page", async ({ page }) => {
  await open(page, "/admin", { role: "admin" });
  await expect(
    page.getByRole("heading", { name: "Administrative Tools", exact: true }),
  ).toBeVisible();

  await shoot(page, "admin", { fullPage: true });
});

test("directory on a phone, with the Options fold open", async ({ page }) => {
  await open(page, "/", { viewport: { width: 390, height: 844 } });
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();

  // §3 of the manual describes this fold by name, so the illustration shows it
  // open rather than collapsed.
  await page.getByRole("button", { name: /^Options/ }).click();

  await shoot(page, "directory-mobile-options");
});
