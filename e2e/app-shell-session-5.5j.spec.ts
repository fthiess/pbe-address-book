import { type Page, expect, test } from "@playwright/test";

/**
 * Phase 5.5j — the full D109 non-destructive session recovery (OFC-236) and the
 * read-path recovery it reuses (OFC-153). These specs drive the client half against a
 * network-mocked backend (the 5.5c approach). The re-auth **child window** is exercised
 * for real: `POST /api/auth/start` returns a same-origin `signInUrl` pointing at Book's
 * own `/auth/callback`, so the popup runs the actual AuthCallback popup-mode code —
 * `completeSignIn` → `postMessage(pbe-reauth-success)` → `window.close()` — and the
 * opener resumes the held request. Routes are registered on the **context** so they
 * apply to the popup page too.
 *
 * Covered: the happy-path re-auth-and-resume of a mid-edit Save (OFC-236); the blocked-
 * popup fallback that keeps the form (D109); the directory bulk-read recovering in place
 * without a full reload (OFC-153); and the guard that a first-load 401 never spawns a
 * popup (the was-authenticated gate).
 */

const OWN_ID = 5002;

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

function meDoc() {
  return {
    profileId: OWN_ID,
    role: "admin",
    realRole: "admin",
    impersonating: false,
    stars: [] as number[],
    profile: ownProfile,
  };
}

/** Wire the re-auth handshake so the popup drives Book's own same-origin callback. */
async function routeReauthHandshake(page: Page) {
  const context = page.context();
  // The relay URL is Book's own `/auth/callback` (same origin) instead of the external
  // Ghost bridge, so the popup exercises the real AuthCallback popup-mode path.
  await context.route("**/api/auth/start", (route) =>
    route.fulfill({
      json: { signInUrl: "/auth/callback#token=faketoken&state=nonce-1", state: "nonce-1" },
    }),
  );
  // The session POST the popup runs to re-establish the `__session` cookie.
  await context.route("**/api/auth/session", (route) => route.fulfill({ status: 204, body: "" }));
}

test.describe("5.5j D109 full recovery (OFC-236 / OFC-153)", () => {
  test("OFC-236/D109: a mid-edit Save 401 re-auths in a child window and resumes the Save", async ({
    page,
  }) => {
    const context = page.context();
    await context.route("**/api/me", (route) => route.fulfill({ json: meDoc() }));
    await context.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: [ownProfile], majors: [] } }),
    );

    let patchCount = 0;
    await context.route(/\/api\/profiles\/\d+$/, (route) => {
      if (route.request().method() === "PATCH") {
        patchCount += 1;
        // First attempt lapses; the resumed attempt (after re-auth) succeeds.
        if (patchCount === 1) {
          return route.fulfill({ status: 401, json: { error: "unauthenticated" } });
        }
        return route.fulfill({
          headers: { ETag: 'W/"v2"' },
          json: profileDoc({ firstName: "Devin" }),
        });
      }
      return route.fulfill({ headers: { ETag: 'W/"v1"' }, json: ownProfile });
    });
    await routeReauthHandshake(page);

    await page.goto(`/brother/${OWN_ID}/edit`);
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
    await page.getByLabel("First name").fill("Devin");

    // The Save opens the re-auth child window; it self-drives and closes.
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Save changes" }).click();
    const popup = await popupPromise;
    await popup.waitForEvent("close");

    // The held Save resumed on the restored session and completed: it left edit mode
    // for the view (exitEdit), the PATCH was retried exactly once more, and the app was
    // NEVER bounced to sign-in nor shown the "expired" fallback.
    await expect(page).toHaveURL(new RegExp(`/brother/${OWN_ID}$`));
    await expect(page.getByText("Your session expired.", { exact: false })).toBeHidden();
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
    expect(patchCount).toBe(2);
  });

  test("D109: a blocked re-auth popup keeps the form with the recover-here message", async ({
    page,
  }) => {
    const context = page.context();
    // A slow save can outrun the browser's user-gesture window: window.open is blocked
    // (returns null). The form must survive with the honest recovery copy (Forrest's
    // approved fallback), never bounced.
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await context.route("**/api/me", (route) => route.fulfill({ json: meDoc() }));
    await context.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: [ownProfile], majors: [] } }),
    );
    await context.route(/\/api\/profiles\/\d+$/, (route) => {
      if (route.request().method() === "PATCH") {
        return route.fulfill({ status: 401, json: { error: "unauthenticated" } });
      }
      return route.fulfill({ headers: { ETag: 'W/"v1"' }, json: ownProfile });
    });
    await routeReauthHandshake(page);

    await page.goto(`/brother/${OWN_ID}/edit`);
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
    await page.getByLabel("First name").fill("Devin");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Your session expired.", { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByLabel("First name")).toHaveValue("Devin");
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  });

  test("D109: dismissing the re-auth window keeps the form and does NOT bounce (probe has no side effect)", async ({
    page,
  }) => {
    const context = page.context();
    // The session truly lapsed: /api/me 401s once the edit began. The user opens the
    // re-auth window and closes it without signing in. The coordinator's close-probe
    // must tell "gave up" from "succeeded" WITHOUT firing the app-wide 401 bounce —
    // else the editor form (the whole point of D109) would be destroyed.
    let lapsed = false;
    await context.route("**/api/me", (route) =>
      lapsed
        ? route.fulfill({ status: 401, json: { error: "unauthenticated" } })
        : route.fulfill({ json: meDoc() }),
    );
    await context.route("**/api/profiles", (route) =>
      route.fulfill({ json: { profiles: [ownProfile], majors: [] } }),
    );
    await context.route(/\/api\/profiles\/\d+$/, (route) => {
      if (route.request().method() === "PATCH") {
        lapsed = true;
        return route.fulfill({ status: 401, json: { error: "unauthenticated" } });
      }
      return route.fulfill({ headers: { ETag: 'W/"v1"' }, json: ownProfile });
    });
    // The re-auth window loads the app home (not the callback), so it never posts a
    // success message — simulating a user who opens it and gives up.
    await context.route("**/api/auth/start", (route) =>
      route.fulfill({ json: { signInUrl: "/", state: "nonce-1" } }),
    );

    await page.goto(`/brother/${OWN_ID}/edit`);
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
    await page.getByLabel("First name").fill("Devin");

    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Save changes" }).click();
    const popup = await popupPromise;
    await popup.close();

    // The close-probe resolved "gave up" without bouncing: the form survives with the
    // recover-here message, still on the edit page, no sign-in screen.
    await expect(page.getByText("Your session expired.", { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByLabel("First name")).toHaveValue("Devin");
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  });

  test("OFC-153: a directory bulk-read 401 recovers in place without a full reload", async ({
    page,
  }) => {
    const context = page.context();
    await context.route("**/api/me", (route) => route.fulfill({ json: meDoc() }));

    let profilesCount = 0;
    await context.route("**/api/profiles", (route) => {
      profilesCount += 1;
      // The first bulk read lapses; after the child-window re-auth it is re-fetched in
      // place and the directory renders — no bounce, no full reload + re-download.
      if (profilesCount === 1) {
        return route.fulfill({ status: 401, json: { error: "unauthenticated" } });
      }
      return route.fulfill({ json: { profiles: [ownProfile], majors: [] } });
    });
    await routeReauthHandshake(page);

    const popupPromise = page.waitForEvent("popup");
    await page.goto("/");
    const popup = await popupPromise;
    await popup.waitForEvent("close");

    // The directory rendered after the in-place recovery; the sign-in screen never showed.
    await expect(page.locator("summary").filter({ hasText: "Dev Admin" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
    expect(profilesCount).toBe(2);
  });

  test("the gate: a first-load 401 shows sign-in and never opens a re-auth popup", async ({
    page,
  }) => {
    const context = page.context();
    // Count any popup attempt: a first-load 401 (never-authenticated) must resolve to the
    // sign-in screen via `refresh`, not spawn the D109 child window.
    await page.addInitScript(() => {
      (window as unknown as { __opens: number }).__opens = 0;
      const realOpen = window.open;
      window.open = (...args: Parameters<typeof window.open>) => {
        (window as unknown as { __opens: number }).__opens += 1;
        return realOpen.apply(window, args);
      };
    });
    // Never authenticated: /api/me 401s on first load.
    await context.route("**/api/me", (route) =>
      route.fulfill({ status: 401, json: { error: "unauthenticated" } }),
    );
    await routeReauthHandshake(page);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    const opens = await page.evaluate(() => (window as unknown as { __opens: number }).__opens);
    expect(opens).toBe(0);
  });
});
