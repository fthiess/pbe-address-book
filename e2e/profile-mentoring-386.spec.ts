import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The mentoring opt-in on the Profile surfaces (D166, OFC-386). The backend is
 * mocked at the network layer so this drives the real SPA.
 *
 * Four things here can regress silently and none is caught by a unit test:
 *
 *  - the switch sits in Privacy & consent, between the PBE News and Directory-listing
 *    subgroups, and carries the public-facing on-copy;
 *  - the view page shows the "Mentoring" line **only** when the opt-in is on — there
 *    is deliberately no "not willing" state to render;
 *  - a **deceased** brother's stored opt-in is suppressed on the view page, which is
 *    the whole reason `isWillingToMentor` exists;
 *  - the switch locks for a **manager** editing another brother, because the field is
 *    `consent`-class on write despite being public on read.
 */

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 5247,
    firstName: "James",
    middleName: "Allen",
    lastName: "Smyth",
    classYear: 1984,
    email: "james@example.test",
    employerName: "Akamai Technologies",
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

test.describe("profile — mentoring switch (edit)", () => {
  test("sits in Professional & personal and states the public consequence when on", async ({
    page,
  }) => {
    await mock(page, me("admin", 5247), record({ willingToMentor: true }));
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    // N160: the edit control sits where the view page's read-out sits, beneath
    // Courses — not in Privacy & consent, which is what prompted the move.
    const professional = section(page, "Professional & personal");
    await expect(professional.getByRole("switch", { name: /Willing to mentor/ })).toBeVisible();
    await expect(
      section(page, "Privacy & consent").getByRole("switch", { name: /Willing to mentor/ }),
    ).toHaveCount(0);

    // The on-copy names what OTHER brothers will read — this is the one switch here
    // whose value is public, so it cannot be phrased as "hidden from…" like its
    // neighbours.
    await expect(
      page.getByText(
        "You are willing to provide professional information and advice to other brothers.",
      ),
    ).toBeVisible();
  });

  test("shows the opt-in-later copy when off", async ({ page }) => {
    await mock(page, me("admin", 5247), record({ willingToMentor: false }));
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    await expect(
      page.getByText("You're not in a position to help right now, but may opt in later."),
    ).toBeVisible();
  });

  test("the `?` says the switch does nothing yet", async ({ page }) => {
    // The honesty that justifies shipping the control ahead of the programme: a
    // brother flipping it must not think he has joined something that exists.
    await mock(page, me("admin", 5247), record());
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Help: Willing to mentor" }).click();
    await expect(
      page.getByText(/eventually be connected to a PBE Mentoring program/i),
    ).toBeVisible();
  });

  test("locks for a manager editing another brother — consent-class write (D166)", async ({
    page,
  }) => {
    // Public on READ, but a manager must not volunteer another brother's time.
    // ⚠ Since N160 this control no longer sits inside the locked Privacy & consent
    // Section, so the lock is passed to it explicitly. That makes this the assertion
    // that would catch the lock being dropped in the move — the switch now sits among
    // fields a manager CAN edit, so nothing else would flag it.
    await mock(page, me("manager", 9001), record({ id: 5247, willingToMentor: true }));
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    const professional = section(page, "Professional & personal");
    await expect(professional.getByRole("switch", { name: /Willing to mentor/ })).toBeDisabled();
    // …while a genuinely editable field in the same section stays writable, so this
    // proves the lock is per-control and not an accidental section-wide freeze.
    await expect(professional.getByLabel("Employer")).toBeEnabled();
  });
});

test.describe("profile — mentoring line (view)", () => {
  test("shows under Professional & personal when the brother has opted in", async ({ page }) => {
    await mock(page, me("brother", 9001), record({ id: 5247, willingToMentor: true }));
    await page.goto("/brother/5247");

    const professional = section(page, "Professional & personal");
    await expect(professional.getByText("Mentoring")).toBeVisible();
    await expect(
      professional.getByText("Willing to provide professional information and advice"),
    ).toBeVisible();
  });

  test("the opted-in line has no accessibility violations (axe, WCAG 2.2 AA)", async ({ page }) => {
    // The line carries a decorative success dot beside the sentence. It is
    // aria-hidden and the sentence holds the whole meaning, so nothing rides on
    // colour (D32) — but WCAG AA is CI-gated here, so the claim gets checked
    // rather than asserted.
    await mock(page, me("brother", 9001), record({ id: 5247, willingToMentor: true }));
    await page.goto("/brother/5247");
    await expect(
      page.getByText("Willing to provide professional information and advice"),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test("renders NOTHING — not even the heading — when he has not", async ({ page }) => {
    await mock(page, me("brother", 9001), record({ id: 5247, willingToMentor: false }));
    await page.goto("/brother/5247");

    const professional = section(page, "Professional & personal");
    await expect(professional.getByText("Employer")).toBeVisible(); // the section did render
    await expect(professional.getByText("Mentoring")).toHaveCount(0);
  });

  test("suppresses a DECEASED brother's stored opt-in (isWillingToMentor, D166)", async ({
    page,
  }) => {
    // The case the predicate exists for: his answer is kept, but "willing to provide
    // advice" is present-tense and must not appear on a memorial profile.
    await mock(
      page,
      me("brother", 9001),
      record({
        id: 5247,
        willingToMentor: true,
        deceased: { isDeceased: true, dateOfDeath: "2020-05-01" },
      }),
    );
    await page.goto("/brother/5247");

    await expect(section(page, "Professional & personal").getByText("Mentoring")).toHaveCount(0);
  });
});
