import { type Page, expect, test } from "@playwright/test";

/**
 * OFC-263 (6b-2) — impersonation must not corrupt the column lens's notion of
 * "default", and the fix (N104) must not regress the OFC-101 shared-link
 * protection it refines. This spec is the repro + the regression guard for both.
 *
 * Root cause: `useColumnLens` decided "did I arrive via a foreign shared `?cols=`
 * link?" purely by whether the URL carried `cols` at mount. But "View as" start/
 * stop does a **hard reload** (SessionContext, N31) that preserves the user's OWN
 * URL — including the `?cols=` that `apply()` reflected there when they customised
 * columns — so after the reload their own view was misclassified as a foreign
 * shared link, and "Reset to default columns" (and further edits) stopped
 * persisting. N104 decides "foreign" by comparing the incoming `cols` to the saved
 * localStorage value instead, which the own view always matches after a reload.
 *
 * The backend is mocked with a **stateful effective role**, exactly as
 * impersonate-4a2.spec.ts does: the impersonate POST/DELETE mutate it and the next
 * `/api/me` reflects it, so the hard reload re-reads the new role.
 */

const OWN_ID = 5002;
const STORAGE_KEY = "pbe.book.directory.columns.v1";

function meDoc(effective: "manager" | "brother" | null) {
  const role = effective ?? "admin";
  return {
    profileId: OWN_ID,
    role,
    realRole: "admin",
    impersonating: effective !== null,
    stars: [] as number[],
    profile: {
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
    },
  };
}

const ROSTER = {
  profiles: [
    {
      id: 5001,
      firstName: "Aaron",
      lastName: "Adams",
      classYear: 1984,
      majors: ["6-3"],
      email: "aaron.adams@example.test",
      phone: "617-555-0101",
      address: { city: "Cambridge", stateProvince: "MA", country: "US" },
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
    meDoc(null).profile,
  ],
  majors: [],
};

/** Wire the stateful auth mock; a hard reload re-reads `/api/me` and reflects it. */
async function wireMocks(page: Page) {
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
  await page.route("**/api/profiles", (route) => route.fulfill({ json: ROSTER }));
  await page.route("**/img/thumbnails/**", (route) => route.fulfill({ status: 404 }));
}

const openColumns = (page: Page) => page.getByText("Columns", { exact: true }).click();
const openAvatarMenu = (page: Page) =>
  page.locator("summary").filter({ hasText: "Dev Admin" }).click();
const readSaved = (page: Page) => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);

test.describe("OFC-263 — impersonation and the column lens", () => {
  test("Reset to default still works after a View-as round trip", async ({ page }) => {
    await wireMocks(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();

    // 1–2. Customise: drop two default columns. The grid reflects it, and the
    // lens reflects to the URL (`?cols=`) — the value the reload will preserve.
    await expect(page.getByRole("columnheader", { name: /Telephone/ })).toBeVisible();
    await openColumns(page);
    await page.getByRole("checkbox", { name: "Telephone" }).uncheck();
    await page.getByRole("checkbox", { name: "City" }).uncheck();
    await expect(page.getByRole("columnheader", { name: /Telephone/ })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: /City/ })).toHaveCount(0);
    await expect(page).toHaveURL(/cols=/);

    // 3. View as Brother (hard reload). Columns unchanged across the switch.
    await openAvatarMenu(page);
    await page.getByRole("button", { name: "View as Brother" }).click();
    await expect(page.getByText("Viewing as Brother", { exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Telephone/ })).toHaveCount(0);

    // 4. Stop viewing (hard reload back to admin).
    await openAvatarMenu(page);
    await page.getByRole("button", { name: "Stop viewing as Brother" }).click();
    await expect(page.getByText("Admin", { exact: true })).toBeVisible();

    // 5. Reset to default columns — the dropped defaults MUST come back.
    await openColumns(page);
    await page.getByRole("button", { name: /reset to default columns/i }).click();
    await expect(page.getByRole("columnheader", { name: /Telephone/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /City/ })).toBeVisible();
    // And the picker's own checkboxes reflect the restored default.
    await expect(page.getByRole("checkbox", { name: "Telephone" })).toBeChecked();
  });

  test("a foreign shared-link view never clobbers the saved default (OFC-101 guard)", async ({
    page,
  }) => {
    await wireMocks(page);
    // The recipient has their OWN saved lens (Class + Email only).
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      STORAGE_KEY,
      "classYear,email",
    ] as const);
    // They open someone else's shared link — a DIFFERENT lens (Class + Telephone).
    await page.goto("/?cols=classYear,phone");
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    // The shared link's columns are what's shown (URL is the active lens)…
    await expect(page.getByRole("columnheader", { name: /Telephone/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Email/ })).toHaveCount(0);
    // …but the recipient's saved default is untouched by merely viewing it.
    expect(await readSaved(page)).toBe("classYear,email");

    // Tweaking a column on the shared-link view updates the URL (stays shareable)…
    await openColumns(page);
    await page.getByRole("checkbox", { name: "City" }).check();
    await expect(page.getByRole("columnheader", { name: /City/ })).toBeVisible();
    // …and STILL must not write back to the recipient's own saved default (D30/D31).
    expect(await readSaved(page)).toBe("classYear,email");
  });
});
