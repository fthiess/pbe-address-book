import { type Locator, type Page, expect, test } from "@playwright/test";

/**
 * Field alignment in the Identity grid (OFC-412).
 *
 * The block is `sm:grid-cols-2` filling ROW BY ROW, so its pairs are
 * First/Last, Middle/Full name, Class year/Nickname, Constitution number/Mug
 * name. Two of those rows reached UAT visibly stepped: a field's label shares a
 * row with the optional `?` toggle-tip, whose 24px trigger (the WCAG 2.5.8
 * target-size minimum) is taller than the 12px label's own line box — so a field
 * whose help entry carries a `toggleTip` had a taller label row and its input
 * sat several pixels below its row-mate's.
 *
 * The bug is therefore that **row alignment depended on which help entries had
 * been authored with a toggle-tip** — a content fact leaking into layout.
 * `FIELD_LABEL_CLASS` now reserves the trigger's height on every field label, so
 * a label row is the same height with or without one. These assertions pin the
 * outcome rather than the mechanism: whatever a future help entry gains or
 * loses, the two fields in a row line up.
 *
 * ⚠ Deliberately a near-equality check on `y`, against the usual N154/N163
 * caution about asserting shared coordinates across two controls. That caution
 * is about coordinates that agree only by font-metric accident — the guard that
 * passed on Windows and failed CI by 19.5px on Linux. Here both label rows are a
 * FIXED 24px independent of font metrics and both cells start at the same grid
 * row top, so agreement is structural and any residual is sub-pixel. Alignment
 * is irreducibly a coordinate claim; 1px absorbs rounding without absorbing the
 * ~6px defect this guards.
 */

const TOLERANCE_PX = 1;

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 5247,
    firstName: "James",
    middleName: "Allen",
    lastName: "Smyth",
    classYear: 1984,
    email: "james@example.test",
    majors: ["6-3"],
    deceased: { isDeceased: false },
    debrothered: { isDebrothered: false },
    hasHeadshot: false,
    privacy: {
      shareEmail: true,
      sharePhone: true,
      shareAddress: true,
      shareEmergency: true,
      shareSpousePartner: true,
    },
    unlisted: false,
    willingToMentor: false,
    allowNewsletterEmail: true,
    allowShareWithMITAA: false,
    lastModified: "2026-03-14T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

async function mock(page: Page, target: ReturnType<typeof record>) {
  const meDoc = {
    profileId: 5247,
    role: "admin",
    realRole: "admin",
    impersonating: false,
    stars: [],
    profile: target,
  };
  await page.route("**/api/me", (route) => route.fulfill({ json: meDoc }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [], majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, (route) =>
    route.fulfill({ headers: { ETag: 'W/"v1"' }, json: target }),
  );
}

/**
 * A field's text input by accessible name. ⚠ `getByLabel` is wrong here — it
 * also matches the `?` button, whose aria-label "Help: Class year" *contains*
 * the field name. Name the role, pin `exact`.
 */
function textbox(page: Page, name: string) {
  return page.getByRole("textbox", { name, exact: true });
}

/**
 * The read-only Constitution number's box. It is a `div`, not a control, so it
 * has no role to locate it by — resolve it the way the markup itself does, via
 * the label's `htmlFor`. ⚠ The id comes from React's `useId`, so it contains
 * colons and cannot go in a CSS id selector; match the attribute instead.
 */
async function lockedBox(page: Page, label: string): Promise<Locator> {
  const id = await page.locator("label", { hasText: label }).getAttribute("for");
  if (id === null) {
    throw new Error(`no label found for "${label}"`);
  }
  return page.locator(`[id="${id}"]`);
}

async function box(locator: Locator, what: string) {
  const b = await locator.boundingBox();
  if (b === null) {
    throw new Error(`${what} has no bounding box`);
  }
  return b;
}

/**
 * Two fields sit in one row of the two-column grid, tops level. The horizontal
 * check is the precondition — it fails loudly if the viewport ever drops below
 * `sm`, where the grid collapses to one column and "same row" means nothing.
 */
async function expectAlignedRow(left: Locator, right: Locator, what: string) {
  const l = await box(left, `${what} (left)`);
  const r = await box(right, `${what} (right)`);

  expect(l.x + l.width, `${what}: expected two columns, not a collapsed grid`).toBeLessThanOrEqual(
    r.x,
  );
  expect(
    Math.abs(l.y - r.y),
    `${what}: field tops are ${Math.abs(l.y - r.y)}px apart`,
  ).toBeLessThanOrEqual(TOLERANCE_PX);
}

test.describe("profile edit — Identity fields line up across each row", () => {
  test.beforeEach(async ({ page }) => {
    await mock(page, record({ nickname: "Bob", mugName: "Quantum All-Star" }));
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
  });

  test("First name / Last name — neither field carries a `?`", async ({ page }) => {
    await expectAlignedRow(textbox(page, "First name"), textbox(page, "Last name"), "First / Last");
  });

  // Reported in UAT: Full name sat below Middle name. Full name carries a
  // toggle-tip and Middle name has no help entry at all.
  test("Middle name / Full name — only the RIGHT field carries a `?`", async ({ page }) => {
    await expectAlignedRow(
      textbox(page, "Middle name"),
      textbox(page, "Full name"),
      "Middle / Full name",
    );
  });

  // Reported in UAT: Nickname sat above Class year. Class year carries a
  // toggle-tip; Nickname's entry has helper text only, so `ControlHelp` renders
  // nothing for it (D174 — the helper is what tells it from Mug name, and
  // Forrest's call was that telling the two apart must not need a click).
  test("Class year / Nickname — only the LEFT field carries a `?`", async ({ page }) => {
    await expectAlignedRow(
      textbox(page, "Class year"),
      textbox(page, "Nickname"),
      "Class year / Nickname",
    );
  });

  // Aligned before this change and after it — the regression guard for the fix
  // itself. Reserving the height in the text-input shell ALONE would have left
  // this locked read-only box behind and broken a row that was never broken.
  test("Constitution number / Mug name — a locked box beside a text input", async ({ page }) => {
    await expectAlignedRow(
      await lockedBox(page, "Constitution signer number"),
      textbox(page, "Mug name"),
      "Constitution number / Mug name",
    );
  });
});
