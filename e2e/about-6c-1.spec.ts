import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Phase 6c-1 — the About page (OFC-244, N116). Driven against a network-mocked
 * backend, the same approach as 5.5c.
 *
 * The load-bearing test is the deep link: it proves the whole build-time chain —
 * `src/content/about.md` → `compileAboutHtml` → the `virtual:about-html` module →
 * the bundle → the rendered page — in the **production preview build** Playwright
 * serves, which is the artifact that actually ships. Unit tests cover the compiler
 * in isolation; only this proves it is wired in.
 */

const OWN_ID = 5002;

const ownProfile = {
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
};

const meDoc = {
  profileId: OWN_ID,
  role: "brother",
  realRole: "brother",
  impersonating: false,
  stars: [] as number[],
  profile: ownProfile,
};

/** Open the avatar menu (a native `<details>` keyed by the own name). */
function openAvatarMenu(page: Page) {
  return page.locator("summary").filter({ hasText: "Dev Admin" }).click();
}

async function signedIn(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: meDoc }));
  await page.route("**/api/profiles*", (route) => route.fulfill({ json: { profiles: [] } }));
  await page.route("**/api/banner", (route) => route.fulfill({ json: { banner: null } }));
}

test.describe("6c-1 About page (OFC-244)", () => {
  test("the avatar menu links to About, and closes on follow", async ({ page }) => {
    await signedIn(page);
    await page.goto("/");
    await openAvatarMenu(page);

    // The Directory has other `<details>` menus (Columns, filters), so anchor on the
    // one whose summary carries the signed-in brother's name.
    const menu = page
      .locator("details")
      .filter({ has: page.locator("summary").filter({ hasText: "Dev Admin" }) });
    await expect(menu).toHaveAttribute("open", "");

    await page.getByRole("link", { name: "About", exact: true }).click();

    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About the PBE Address Book");
    // An in-SPA <Link> is not dismissed by the outside-pointerdown handler, so the
    // menu closes only because of the explicit `closeMenu` — which regresses
    // silently if someone copies the row without it.
    await expect(menu).not.toHaveAttribute("open", "");
  });

  test("a deep link renders the compiled Markdown", async ({ page }) => {
    await signedIn(page);
    await page.goto("/about");

    // Headings start at h2 — the page owns the only h1 (compiler-enforced).
    await expect(page.getByRole("heading", { level: 2, name: "What this is" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Privacy" })).toBeVisible();
    await expect(
      page.getByText("private directory for the brothers of Phi Beta Epsilon"),
    ).toBeVisible();

    // about.md may contain no HTML comments at all (the compiler rejects them, and
    // the authoring guidance lives in src/content/README.md), so none can reach the
    // DOM as raw markup.
    expect(await page.locator(".about-prose").innerHTML()).not.toContain("<!--");

    // External links carry the new-tab treatment the compiler adds.
    const gitHub = page.getByRole("link", { name: /github\.com\/fthiess\/pbe-address-book/ });
    await expect(gitHub.first()).toHaveAttribute("rel", "noopener noreferrer");
    await expect(gitHub.first()).toHaveAttribute("target", "_blank");
  });

  test("the profile link routes in-app (no full reload) via /brother/me/edit", async ({ page }) => {
    await signedIn(page);
    await page.route(`**/api/profiles/${OWN_ID}`, (route) => route.fulfill({ json: ownProfile }));
    await page.goto("/about");

    // A full page reload would clear this, which is exactly what we're guarding
    // against: a plain <a href="/…"> in injected HTML reloads the whole app.
    await page.evaluate(() => {
      (window as unknown as { __noReload?: boolean }).__noReload = true;
    });

    await page.getByRole("link", { name: "your own profile" }).click();

    // /brother/me/edit resolves to the real record and drops out of history.
    await expect(page).toHaveURL(new RegExp(`/brother/${OWN_ID}/edit$`));
    expect(
      await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
    ).toBe(true);

    // `replace` means Back skips the alias and returns to About, not into a loop.
    await page.goBack();
    await expect(page).toHaveURL(/\/about$/);
  });

  test("/brother/me redirects to one's own profile", async ({ page }) => {
    await signedIn(page);
    await page.route(`**/api/profiles/${OWN_ID}`, (route) => route.fulfill({ json: ownProfile }));

    await page.goto("/brother/me");

    // A static route ranked above `brother/:id` — "me" must never be read as a
    // Constitution ID (the `brother/new` bug this shape exists to avoid).
    await expect(page).toHaveURL(new RegExp(`/brother/${OWN_ID}$`));
  });

  test("has no axe violations (WCAG 2.2 AA)", async ({ page }) => {
    await signedIn(page);
    await page.goto("/about");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
