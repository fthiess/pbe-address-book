import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Session 6b-5 — Profile-surface UI batch (OFC-270, OFC-271). The backend is mocked
 * at the network layer so this drives the real SPA. It locks the two *structural*
 * changes that could silently regress:
 *
 *  - OFC-270: the emergency-contact and spouse/partner share switches were moved out
 *    from beside their fields into the Privacy & consent section, joining email /
 *    address / phone. Their off-copy now names the field so each row is self-
 *    identifying away from the field it protects.
 *  - OFC-271: the Admin Note moved out of Record status into its own Administrative
 *    section, which renders only for staff and only when a note exists.
 *
 * (The OFC-260 spacing/alignment nits are purely visual and left to the axe/visual
 * pass, not asserted here.)
 */

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 5247,
    firstName: "James",
    middleName: "Allen",
    lastName: "Smyth",
    fullLegalName: "James Allen Smyth",
    mugName: "Smitty",
    classYear: 1984,
    email: "james@example.test",
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
    links: [{ label: "LinkedIn", url: "https://linkedin.com/in/example" }],
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
    allowShareWithMITAA: false,
    lastVerifiedDate: "2026-03-14",
    verifiedBy: 5247,
    lastModified: "2026-03-14T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-03-14T12:00:00.000Z",
    adminNote: "Prefers phone contact. Dues waived for 2025 per board vote.",
    ...overrides,
  };
}

function me(role: "brother" | "manager" | "admin", profileId: number) {
  return {
    profileId,
    role,
    realRole: role,
    impersonating: false,
    stars: [],
    profile: record({ id: profileId }),
  };
}

async function mock(page: Page, meDoc: ReturnType<typeof me>, target: ReturnType<typeof record>) {
  await page.route("**/api/me", (route) => route.fulfill({ json: meDoc }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: [], majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, (route) =>
    route.fulfill({ headers: { ETag: 'W/"v1"' }, json: target }),
  );
}

function section(page: Page, name: string) {
  return page.locator("section", { has: page.getByRole("heading", { name }) });
}

test.describe("profile 6b-5 — OFC-270 share-toggle placement (edit)", () => {
  test("emergency + spouse switches live in Privacy & consent, not beside their fields", async ({
    page,
  }) => {
    await mock(page, me("admin", 5247), record());
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    const privacy = section(page, "Privacy & consent");
    // All five share switches are together in the privacy section now.
    await expect(privacy.getByRole("switch", { name: /Share email with brothers/ })).toBeVisible();
    await expect(
      privacy.getByRole("switch", { name: /Share emergency contacts with brothers/ }),
    ).toBeVisible();
    await expect(
      privacy.getByRole("switch", { name: /Share spouse \/ partner with brothers/ }),
    ).toBeVisible();

    // …and no switch is left stranded beside the fields they protect.
    await expect(section(page, "Emergency contacts").getByRole("switch")).toHaveCount(0);
    await expect(section(page, "Professional & personal").getByRole("switch")).toHaveCount(0);
  });

  test("the moved switches name their field in the off state", async ({ page }) => {
    // Off-copy must be self-identifying now that the field isn't adjacent.
    await mock(page, me("admin", 5247), record());
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    await expect(
      page.getByText("Your emergency contacts are visible to administrators only."),
    ).toBeVisible();
    await expect(
      page.getByText("Your spouse / partner is visible to administrators only."),
    ).toBeVisible();
  });
});

test.describe("profile 6b-5 — OFC-271 Administrative section (view)", () => {
  test("staff see the Admin Note in its own Administrative section, not in Record status", async ({
    page,
  }) => {
    await mock(page, me("admin", 9001), record());
    await page.goto("/brother/5247");
    await expect(page.getByRole("heading", { level: 1, name: /James Smyth/ })).toBeVisible();

    const admin = section(page, "Administrative");
    await expect(admin.getByRole("heading", { name: "Administrative" })).toBeVisible();
    await expect(admin.getByText(/Dues waived for 2025/)).toBeVisible();
    // The note no longer lives under Record status.
    await expect(section(page, "Record status").getByText(/Dues waived/)).toHaveCount(0);
  });

  test("a brother viewing another brother never sees the Administrative section", async ({
    page,
  }) => {
    // Even if a note is present on the wire, the client role-guard hides the section.
    await mock(page, me("brother", 9001), record());
    await page.goto("/brother/5247");
    await expect(page.getByRole("heading", { level: 1, name: /James Smyth/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Administrative" })).toHaveCount(0);
  });

  test("no Administrative section when the note is empty", async ({ page }) => {
    await mock(page, me("admin", 9001), record({ adminNote: undefined }));
    await page.goto("/brother/5247");
    await expect(page.getByRole("heading", { level: 1, name: /James Smyth/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Administrative" })).toHaveCount(0);
  });

  test("the restructured restricted block has no accessibility violations", async ({ page }) => {
    await mock(page, me("admin", 9001), record());
    await page.goto("/brother/5247");
    await expect(page.getByRole("heading", { name: "Administrative" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
