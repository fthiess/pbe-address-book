import AxeBuilder from "@axe-core/playwright";
import { type Page, type Route, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Phase 5.5c — the app shell and session error handling. These specs drive the
 * client half against a network-mocked backend (the same approach as
 * impersonate-4a2): OFC-202 the unknown-route 404 page, OFC-193 the mid-session
 * 401 bounce with an inactivity notice, OFC-63 the new-version toast, and OFC-192
 * the unlisted-record "not found" latch after a View-as round trip. For OFC-192 the
 * single-record mock is **role-aware** — it 404s an unlisted record for a brother
 * and serves it for an admin, exactly as the server projection does — so the test
 * exercises the real client latch rather than a mock that always says 200.
 */

const OWN_ID = 5002;
const UNLISTED_ID = 5099;

function profileDoc(over: Record<string, unknown>) {
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

const ownProfile = profileDoc({});
const unlistedProfile = profileDoc({
  id: UNLISTED_ID,
  firstName: "Hidden",
  lastName: "Member",
  classYear: 1963,
  email: "hidden@example.test",
  unlisted: true,
});

function meDoc(effective: "manager" | "brother" | null) {
  return {
    profileId: OWN_ID,
    role: effective ?? "admin",
    realRole: "admin",
    impersonating: effective !== null,
    stars: [] as number[],
    profile: ownProfile,
  };
}

/** Open the avatar menu (a native `<details>` keyed by the own name). */
function openAvatarMenu(page: Page) {
  return page.locator("summary").filter({ hasText: "Dev Admin" }).click();
}

function idFromUrl(route: Route): number {
  return Number(/\/(\d+)$/.exec(new URL(route.request().url()).pathname)?.[1]);
}

test.describe("5.5c app shell + session (OFC-202/193/63/192)", () => {
  test("OFC-202: an unknown URL shows the page-not-found screen, not the Directory", async ({
    page,
  }) => {
    await page.route("**/api/me", (route) => route.fulfill({ json: meDoc(null) }));
    await page.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: [ownProfile], majors: [] } }),
    );

    await page.goto("/xyzzy");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the Directory" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test("OFC-193: a mid-session 401 bounces the whole app to sign-in with an inactivity notice", async ({
    page,
  }) => {
    // The session is live for `/api/me` (the SPA believes it is authenticated) but
    // has lapsed for the gated single read — the exact state that used to surface a
    // misleading "couldn't load, refresh" instead of an honest sign-out.
    await page.route("**/api/me", (route) => route.fulfill({ json: meDoc(null) }));
    await page.route(/\/api\/profiles\/\d+$/, (route) =>
      route.fulfill({ status: 401, json: { error: "unauthenticated" } }),
    );

    await page.goto(`/brother/${OWN_ID}`);

    await expect(page.getByText("You've been signed out. Please sign in again.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    // The misleading transient-failure copy must NOT appear.
    await expect(page.getByText("Please refresh to try again")).toBeHidden();
  });

  test("OFC-193/D109: a mid-edit Save 401 keeps the form and does NOT bounce to sign-in", async ({
    page,
  }) => {
    // The owner-admin edits their own record; the session lapses so the Save PATCH
    // 401s. D109: the in-progress form must survive with an honest message — the
    // edit-form write opts out of the app-wide bounce (Option A). The full seamless
    // re-auth-and-resume (5.5j/OFC-236) is exercised in app-shell-session-5.5j; here we
    // block the popup so the fallback path is deterministic and assert the same core
    // invariant this test has always guarded: form kept, message shown, not bounced.
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await page.route("**/api/me", (route) => route.fulfill({ json: meDoc(null) }));
    await page.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: [ownProfile], majors: [] } }),
    );
    await page.route(/\/api\/profiles\/\d+$/, (route) => {
      if (route.request().method() === "PATCH") {
        return route.fulfill({ status: 401, json: { error: "unauthenticated" } });
      }
      return route.fulfill({ headers: { ETag: 'W/"v1"' }, json: ownProfile });
    });

    await page.goto(`/brother/${OWN_ID}/edit`);
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
    await page.getByLabel("First name").fill("Devin");
    await page.getByRole("button", { name: "Save changes" }).click();

    // Still on the edit form, with the honest expired message — NOT bounced.
    await expect(page.getByText("Your session expired.", { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByLabel("First name")).toHaveValue("Devin");
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  });

  test("OFC-63: a newer deployed build raises the calm update toast", async ({ page }) => {
    await page.route("**/api/me", (route) => route.fulfill({ json: meDoc(null) }));
    await page.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: [ownProfile], majors: [] } }),
    );
    // The deployed id differs from the one this preview build booted with.
    await page.route("**/version.json", (route) =>
      route.fulfill({ json: { version: "a-newer-build-id" } }),
    );

    await page.goto("/");
    await expect(page.locator("summary").filter({ hasText: "Dev Admin" })).toBeVisible();

    // The poll fires on refocus; nudge it rather than wait out the long interval.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));

    const toast = page
      .getByRole("status")
      .filter({ hasText: "A new version of PBE Address Book is available" });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole("button", { name: "Refresh" })).toBeVisible();
    // Dismiss leaves the user be.
    await toast.getByRole("button", { name: "Dismiss" }).click();
    await expect(toast).toBeHidden();
  });

  test("OFC-192: an unlisted record stays visible to an admin after a View-as round trip", async ({
    page,
  }) => {
    let effective: "manager" | "brother" | null = null;
    await page.route("**/api/me", (route) => route.fulfill({ json: meDoc(effective) }));
    await page.route("**/api/me/impersonate", (route) => {
      const method = route.request().method();
      if (method === "POST") {
        effective = JSON.parse(route.request().postData() ?? "{}").role;
      } else if (method === "DELETE") {
        effective = null;
      }
      return route.fulfill({ status: 204, body: "" });
    });
    // Bulk read: the effective role selects the projection — a brother never sees
    // the unlisted record; an admin does.
    await page.route("**/api/profiles", (route) => {
      const role = effective ?? "admin";
      const profiles = role === "brother" ? [ownProfile] : [ownProfile, unlistedProfile];
      return route.fulfill({ json: { profiles, majors: [] } });
    });
    // Single read: role-aware, exactly like the server — a brother 404s the unlisted
    // record; an admin gets it.
    await page.route(/\/api\/profiles\/\d+$/, (route) => {
      const id = idFromUrl(route);
      const role = effective ?? "admin";
      if (id === UNLISTED_ID && role === "brother") {
        return route.fulfill({ status: 404, json: { error: "not_found" } });
      }
      const profile = id === UNLISTED_ID ? unlistedProfile : ownProfile;
      return route.fulfill({ headers: { ETag: "v1" }, json: profile });
    });

    // Step 1 — as admin, the unlisted record is visible.
    await page.goto(`/brother/${UNLISTED_ID}`);
    await expect(page.getByRole("heading", { name: "Hidden Member" })).toBeVisible();

    // Step 2 — view as brother: the record is correctly not found.
    await openAvatarMenu(page);
    await page.getByRole("button", { name: "View as Brother" }).click();
    await expect(page.getByRole("heading", { name: "Brother not found" })).toBeVisible();

    // Step 3 — stop viewing as: back to admin, the record must be visible again.
    await openAvatarMenu(page);
    await page.getByRole("button", { name: "Stop viewing as Brother" }).click();
    await expect(page.getByRole("heading", { name: "Brother not found" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Hidden Member" })).toBeVisible();
  });
});
