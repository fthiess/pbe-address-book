import { type Page, expect, test } from "@playwright/test";

/**
 * The pinned control cells' **hit target** (OFC-397). Both the Select checkbox and
 * the Star are documented to fill their whole cell (`fill` → `size-full`, with the
 * cell at `p-0`) so that a click anywhere in the cell works the control and never
 * falls through to the row's open-profile handler (§5.6.7, WCAG 2.5.8).
 *
 * ⚠ **The pre-existing guard in `directory-3c.spec.ts` cannot see this.** It drives
 * the control with Playwright's `.check()` / `.click()`, which target the *element's*
 * centre — so it exercises the 16px checkbox and the 18px star glyph and nothing
 * around them. Every assertion here therefore clicks at an explicit **position
 * inside the cell but outside the control's own box**, which is the only way the
 * reported failure is reachable at all (the same "passes covering half the feature"
 * shape as OFC-396's roster mock).
 */

const ME = {
  profileId: 5002,
  role: "admin",
  realRole: "admin",
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

const PROFILES = {
  profiles: [
    {
      id: 5001,
      firstName: "Aaron",
      lastName: "Adams",
      classYear: 1984,
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
    {
      id: 5002,
      firstName: "Dev",
      lastName: "Admin",
      classYear: 1990,
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
  ],
  majors: [],
};

/**
 * How far inside the cell's top edge to click. Comfortably clear of any hairline
 * border guard, and comfortably clear of the vertically-centred control: in a 56px
 * row the 16px checkbox spans roughly y=20–36, so y=8 is dead space unless the
 * control genuinely fills the cell.
 */
const INSET_Y = 8;

async function gotoDirectory(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: ME }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: PROFILES }));
  await page.route("**/img/thumbnails/**", (route) => route.fulfill({ status: 404 }));
  const starred = new Set<number>();
  await page.route("**/api/me/stars/**", (route) => {
    const request = route.request();
    const id = Number(request.url().split("/").pop());
    if (request.method() === "DELETE") {
      starred.delete(id);
    } else {
      starred.add(id);
    }
    return route.fulfill({ json: { stars: [...starred] } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

/** The `<td>` holding a named control — the "grid square" the ticket is about. */
function cellHolding(page: Page, selector: string) {
  return page.locator(`td:has(${selector})`).first();
}

test.describe("OFC-397 — the pinned control cells are the hit target", () => {
  test("clicking the Select cell away from the box selects, and does not open the profile", async ({
    page,
  }) => {
    await gotoDirectory(page);
    const box = page.getByRole("checkbox", { name: /^Select Aaron Adams/ });
    const cell = cellHolding(page, 'input[aria-label^="Select Aaron Adams"]');
    const bounds = await cell.boundingBox();
    if (!bounds) {
      throw new Error("the Select cell has no layout box");
    }

    await cell.click({ position: { x: bounds.width / 2, y: INSET_Y } });

    await expect(box).toBeChecked();
    await expect(page).not.toHaveURL(/\/brother\//);
  });

  test("clicking the Star cell away from the glyph stars, and does not open the profile", async ({
    page,
  }) => {
    await gotoDirectory(page);
    const cell = cellHolding(page, 'button[aria-label*="Aaron Adams"][aria-pressed]');
    const bounds = await cell.boundingBox();
    if (!bounds) {
      throw new Error("the Star cell has no layout box");
    }

    await cell.click({ position: { x: bounds.width / 2, y: INSET_Y } });

    await expect(page.getByRole("button", { name: /^Starred: Aaron Adams/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page).not.toHaveURL(/\/brother\//);
  });

  test("each control's own box meets the 24px WCAG 2.5.8 minimum", async ({ page }) => {
    await gotoDirectory(page);
    // The control that RECEIVES the click — the checkbox's <label> wrapper and the
    // star's <button> — not the 16px input or the 18px glyph inside it. This is the
    // measurement the `fill` mechanism exists to satisfy; it is asserted here so a
    // regression that shrinks the target is a red build rather than a UAT report.
    const target = {
      select: page.locator('label:has(input[aria-label^="Select Aaron Adams"])'),
      star: page.locator('button[aria-label*="Aaron Adams"][aria-pressed]'),
    };
    for (const [name, locator] of Object.entries(target)) {
      const bounds = await locator.first().boundingBox();
      if (!bounds) {
        throw new Error(`the ${name} control has no layout box`);
      }
      expect(bounds.width, `${name} target width`).toBeGreaterThanOrEqual(24);
      expect(bounds.height, `${name} target height`).toBeGreaterThanOrEqual(24);
    }
  });
});
