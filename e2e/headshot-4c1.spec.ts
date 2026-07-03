import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import sharp from "sharp";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The headshot pipeline UI (4c-1; API-SPEC §6; D47/N42): the crop-and-stage flow,
 * the JPEG/PNG accept-list with the HEIC rejection message, and the axe 2.2 AA
 * pass on the crop dialog. The backend is mocked at the network layer — `/api/me`,
 * `GET`/`PATCH /api/profiles/:id`, and `PUT /api/profiles/:id/headshot` — so this
 * drives the real SPA (the lazily-loaded react-easy-crop Radix dialog included).
 */

function ownerRecord() {
  return {
    id: 5247,
    firstName: "James",
    lastName: "Smyth",
    classYear: 1984,
    email: "james@example.test",
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
    allowCommentReplyEmail: true,
    allowShareWithMITAA: false,
    lastModified: "2026-03-14T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-03-14T12:00:00.000Z",
  };
}

/** Mock the profile surface; returns a live counter of headshot PUTs seen. */
async function mockProfile(page: Page): Promise<{ puts: () => number }> {
  let putCount = 0;
  const state = { record: ownerRecord() as Record<string, unknown>, etag: 'W/"v1"' };

  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        profileId: 5247,
        role: "admin",
        realRole: "admin",
        impersonating: false,
        stars: [],
        profile: ownerRecord(),
      },
    }),
  );
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [ownerRecord()], majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+\/headshot$/, (route) => {
    putCount += 1;
    if (route.request().method() === "PUT") {
      state.record = { ...state.record, hasHeadshot: true, headshotVersion: "v1" };
      return route.fulfill({
        headers: { ETag: 'W/"v2"' },
        json: { hasHeadshot: true, headshotVersion: "v1" },
      });
    }
    state.record = { ...state.record, hasHeadshot: false };
    return route.fulfill({ headers: { ETag: 'W/"v2"' }, json: { hasHeadshot: false } });
  });
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    if (route.request().method() === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      state.record = { ...state.record, ...body };
      state.etag = 'W/"v2"';
    }
    return route.fulfill({ headers: { ETag: state.etag }, json: state.record });
  });

  return { puts: () => putCount };
}

async function gotoEdit(page: Page) {
  await page.goto("/brother/5247/edit");
  await expect(page.getByText("Editing", { exact: true })).toBeVisible();
}

async function pickFile(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
}

test.describe("headshot 4c-1 — crop, stage, and save", () => {
  test("crops a chosen photo, stages it, and uploads it on Save", async ({ page }) => {
    const tracker = await mockProfile(page);
    await gotoEdit(page);

    const photo = await sharp({
      create: { width: 128, height: 128, channels: 3, background: { r: 200, g: 60, b: 60 } },
    })
      .png()
      .toBuffer();
    await pickFile(page, "me.png", "image/png", photo);

    // The lazily-loaded crop dialog appears.
    const dialog = page.getByRole("dialog", { name: "Adjust your photo" });
    await expect(dialog).toBeVisible();

    // Axe 2.2 AA on the crop dialog (D79).
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(WCAG_TAGS)
      .analyze();
    expect(results.violations).toEqual([]);

    // Confirm the crop → the photo stages, and the dialog closes.
    const usePhoto = dialog.getByRole("button", { name: "Use photo" });
    await expect(usePhoto).toBeEnabled();
    await usePhoto.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("New photo — Save to apply.")).toBeVisible();

    // Save → the headshot PUT fires, and we return to the view.
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/brother\/5247$/);
    expect(tracker.puts()).toBe(1);
  });

  test("rejects a HEIC file with a clear message and does not open the crop dialog", async ({
    page,
  }) => {
    await mockProfile(page);
    await gotoEdit(page);

    await pickFile(page, "iphone.heic", "image/heic", Buffer.from("not a real heic"));

    await expect(page.getByText(/Other formats \(including HEIC\) aren't supported/)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Adjust your photo" })).toBeHidden();
  });

  test("the masthead avatar shows the signed-in brother's headshot thumbnail", async ({ page }) => {
    // With a headshot on the signed-in brother's own record, the masthead avatar is
    // the thumbnail image (same as his Directory row), not the initials fallback.
    const rec = { ...ownerRecord(), hasHeadshot: true, headshotVersion: "v9" };
    await page.route("**/api/me", (route) =>
      route.fulfill({
        json: {
          profileId: 5247,
          role: "admin",
          realRole: "admin",
          impersonating: false,
          stars: [],
          profile: rec,
        },
      }),
    );
    await page.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: [rec], majors: [] } }),
    );
    await page.route(/\/api\/profiles\/\d+$/, (route) =>
      route.fulfill({ headers: { ETag: 'W/"v1"' }, json: rec }),
    );
    // Serve a real WEBP so the masthead <img> loads rather than erroring to fallback.
    const webp = await sharp({
      create: { width: 96, height: 96, channels: 3, background: { r: 80, g: 100, b: 120 } },
    })
      .webp()
      .toBuffer();
    await page.route("**/img/thumbnails/**", (route) =>
      route.fulfill({ contentType: "image/webp", body: webp }),
    );

    await page.goto("/brother/5247");
    await expect(page.locator('header img[src*="/img/thumbnails/5247/v9"]')).toBeVisible();
  });
});
