import AxeBuilder from "@axe-core/playwright";
import { type Page, type Route, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The Profile page (Phase 4a — view/edit spine). The backend is mocked at the
 * network layer (`/api/me` + `GET`/`PATCH /api/profiles/:id`), so this exercises
 * the real SPA — the four role projections, the privacy/consent switches, inline
 * validation, the PATCH-first save with the 412 reconcile, and the unsaved-
 * changes guard — and gates the page on WCAG 2.2 AA (D79).
 */

/** The fake exemplar, James Smyth '84 (#5247) — a full owner record. */
function ownerRecord() {
  return {
    id: 5247,
    firstName: "James",
    middleName: "Allen",
    lastName: "Smyth",
    fullLegalName: "James Allen Smyth",
    mugName: "Smitty",
    classYear: 1984,
    email: "james@example.test",
    alternateEmail: "jas@alum.example.test",
    phone: "+1 (617) 555-0142",
    address: {
      street1: "114 Memorial Drive",
      city: "Cambridge",
      stateProvince: "MA",
      postalCode: "02142",
      country: "US",
    },
    emergencyContacts: [{ name: "Susan Smyth", phone: "(617) 555-0188", email: "" }],
    employerName: "Akamai Technologies",
    jobTitle: "Principal Engineer",
    spousePartnerName: "Susan Smyth",
    majors: ["6-3", "2"],
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
    lastVerifiedDate: "2026-03-14",
    verifiedBy: 5247,
    lastModified: "2026-03-14T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-03-14T12:00:00.000Z",
  };
}

function me(role: "brother" | "manager" | "admin", profileId: number) {
  return {
    profileId,
    role,
    realRole: role,
    impersonating: false,
    stars: [],
    profile: { ...ownerRecord(), id: profileId },
  };
}

/**
 * Mock the Profile endpoints with a stateful record: `GET` returns the current
 * record, `PATCH` merges the body and bumps the ETag (so a save-then-reload shows
 * the new data). `patchStatus` can force a 422 / 412 to exercise those branches.
 */
async function mockProfile(
  page: Page,
  options: {
    meDoc: ReturnType<typeof me>;
    record: ReturnType<typeof ownerRecord>;
    patch?: (route: Route, body: Record<string, unknown>) => boolean;
  },
) {
  const state = { record: options.record, etag: 'W/"v1"' };
  await page.route("**/api/me", (route) => route.fulfill({ json: options.meDoc }));
  // The Profile container loads the bulk roster (4b-1, for Big Brother / Little
  // Brothers). These 4a cases don't exercise it — an empty roster keeps the page
  // behaviour identical and avoids the dead dev-proxy call.
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [], majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (options.patch?.(route, body)) {
        return; // the test's handler fulfilled it (e.g. a 412/422)
      }
      state.record = { ...state.record, ...body, lastVerifiedDate: "2026-06-29" };
      state.etag = 'W/"v2"';
      return route.fulfill({ headers: { ETag: state.etag }, json: state.record });
    }
    return route.fulfill({ headers: { ETag: state.etag }, json: state.record });
  });
}

test.describe("profile — view mode", () => {
  test("the owner sees their full record and an Edit button", async ({ page }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await page.goto("/brother/5247");

    await expect(page.getByRole("heading", { level: 1, name: /James Smyth/ })).toBeVisible();
    // Scope to the profile article — the same email also sits in the masthead menu.
    await expect(page.getByRole("article").getByText("james@example.test")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contact", exact: true })).toBeVisible();
    // The restricted block is visible to the owner.
    await expect(page.getByRole("heading", { name: /Record status/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit profile" })).toBeVisible();
  });

  test("a peer sees no restricted block and no Edit button", async ({ page }) => {
    // A peer's projection omits the restricted fields and the off-toggle values.
    const peerView = {
      ...ownerRecord(),
      email: undefined,
      alternateEmail: undefined,
      emergencyContacts: undefined,
      spousePartnerName: undefined,
      privacy: undefined,
      allowNewsletterEmail: undefined,
      allowCommentReplyEmail: undefined,
      allowShareWithMITAA: undefined,
      lastVerifiedDate: undefined,
      verifiedBy: undefined,
      lastModified: undefined,
    } as unknown as ReturnType<typeof ownerRecord>;
    await mockProfile(page, { meDoc: me("brother", 9001), record: peerView });
    await page.goto("/brother/5247");

    await expect(page.getByRole("heading", { level: 1, name: /James Smyth/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit profile" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Record status/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Preferences/ })).toHaveCount(0);
  });

  test("a manager sees the private marker for an off-toggle field", async ({ page }) => {
    // shareEmail off → the value is omitted, the privacy flags arrive; the manager
    // sees that the field exists and is private (§5.7.2).
    const managerView = {
      ...ownerRecord(),
      email: undefined,
      alternateEmail: undefined,
      emergencyContacts: undefined,
      spousePartnerName: undefined,
      privacy: {
        shareEmail: false,
        sharePhone: true,
        shareAddress: true,
        shareEmergency: false,
        shareSpousePartner: false,
      },
    } as ReturnType<typeof ownerRecord>;
    await mockProfile(page, { meDoc: me("manager", 9002), record: managerView });
    await page.goto("/brother/5247");

    // The off-toggle email value is omitted; the manager sees the private marker.
    await expect(page.getByText(/This field is private/).first()).toBeVisible();
  });

  test("has no accessibility violations (axe, WCAG 2.2 AA)", async ({ page }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await page.goto("/brother/5247");
    await expect(page.getByRole("heading", { level: 1, name: /James Smyth/ })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("profile — edit mode", () => {
  async function gotoEdit(page: Page) {
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
  }

  test("the owner edits a field and saves, landing back on the view with a toast", async ({
    page,
  }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);

    const firstName = page.getByLabel("First name");
    await firstName.fill("Jim");
    await page.getByRole("button", { name: "Save changes" }).click();

    // Scope to the toast: the majors editor's dnd-kit context also has a role=status
    // live region (empty), so match the save-confirmation status specifically.
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toContainText(
      "Saved — verified as of today",
    );
    await expect(page).toHaveURL(/\/brother\/5247$/);
    await expect(page.getByRole("heading", { level: 1, name: /Jim Smyth/ })).toBeVisible();
  });

  test("blanking a required field blocks the save and shows an inline error", async ({ page }) => {
    let patchCalled = false;
    await mockProfile(page, {
      meDoc: me("brother", 5247),
      record: ownerRecord(),
      patch: () => {
        patchCalled = true;
        return false;
      },
    });
    await gotoEdit(page);

    await page.getByLabel("First name").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("First name is required.")).toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
    expect(patchCalled).toBe(false);
  });

  test("alternate email is disabled until a primary email is present", async ({ page }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);

    await expect(page.getByLabel("Alternate email")).toBeEnabled();
    // Scope to the Contact section: the emergency-contact editor (4b-1) also has an "Email".
    await page
      .getByRole("region", { name: "Contact", exact: true })
      .getByLabel("Email", { exact: true })
      .fill("");
    await expect(page.getByLabel("Alternate email")).toBeDisabled();
  });

  test("a 412 keeps the edits and shows the reconcile notice", async ({ page }) => {
    await mockProfile(page, {
      meDoc: me("brother", 5247),
      record: ownerRecord(),
      patch: (route) => {
        route.fulfill({ status: 412, json: { error: "stale_write", message: "changed" } });
        return true;
      },
    });
    await gotoEdit(page);

    await page.getByLabel("First name").fill("Jim");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText(/changed while you were editing/i)).toBeVisible();
    // The user's edit is preserved (never clobbered).
    await expect(page.getByLabel("First name")).toHaveValue("Jim");
    await expect(page).toHaveURL(/\/edit$/);
  });

  test("Cancel after a change asks to confirm before discarding", async ({ page }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);

    await page.getByLabel("First name").fill("Jim");
    await page.getByRole("button", { name: "Cancel" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Discard changes" }).click();
    await expect(page).toHaveURL(/\/brother\/5247$/);
  });

  test("a manager editing another brother sees the consent switches locked", async ({ page }) => {
    await mockProfile(page, { meDoc: me("manager", 9002), record: ownerRecord() });
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    // The reachability switch is present but non-interactive for a manager-on-another.
    const emailSwitch = page.getByRole("switch", { name: /Brothers can reach you by email/ });
    await expect(emailSwitch).toBeDisabled();
    // …while an ordinary directory field stays editable.
    await expect(page.getByLabel("Employer")).toBeEnabled();
  });

  test("the edit form has no accessibility violations (axe, WCAG 2.2 AA)", async ({ page }) => {
    await mockProfile(page, { meDoc: me("brother", 5247), record: ownerRecord() });
    await gotoEdit(page);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
