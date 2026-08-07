import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Withheld Big and Little Brothers on the Profile page (D168, OFC-392).
 *
 * A brother's roster omits `unlisted` (D124) and `debrothered` (D115) records
 * wholesale, so a relationship pointing at one cannot be resolved by the client.
 * UAT found the two directions failing differently and both wrongly: a withheld
 * **Big** Brother rendered as a stranger with the invented initials "VP" (the
 * avatar takes its initials from the name it is handed, and the placeholder label
 * was "View his profile"), inviting a click that dead-ended on a confusing
 * message; a withheld **Little** Brother vanished entirely, taking the whole
 * Relationships section with it when he was the only one.
 *
 * These run against the real SPA with the network mocked, so they exercise the
 * projection's actual client-visible consequences rather than a component in
 * isolation — which is where the bug lived.
 */

/** #5247 James Smyth '84, whose Big Brother #5001 is withheld from a peer. */
function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 5247,
    firstName: "James",
    lastName: "Smyth",
    classYear: 1984,
    majors: ["6-3"],
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
    lastModified: "2026-03-14T12:00:00.000Z",
    newsletterConsentChangedAt: "2026-03-14T12:00:00.000Z",
    ...overrides,
  };
}

function me(role: "brother" | "manager", profileId: number) {
  return {
    profileId,
    role,
    realRole: role,
    impersonating: false,
    stars: [],
    profile: record({ id: profileId }),
  };
}

async function mock(
  page: Page,
  options: {
    role: "brother" | "manager";
    /** The viewed record, as the server would project it for this role. */
    viewed: Record<string, unknown>;
    /** The bulk roster this role receives — a withheld brother is simply absent. */
    roster: Record<string, unknown>[];
    /** The viewer's own Constitution id; 5247 makes him the owner of the record. */
    viewerId?: number;
  },
) {
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: me(options.role, options.viewerId ?? 9001) }),
  );
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: options.roster, majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, (route) =>
    route.fulfill({ headers: { ETag: 'W/"v1"' }, json: options.viewed }),
  );
}

test.describe("OFC-392 — a withheld Big Brother", () => {
  test("reads as private, with no invented initials and no link to follow", async ({ page }) => {
    await mock(page, {
      role: "brother",
      // The pointer survives the projection (`bigBrotherId` is public) while its
      // target does not — the exact condition that produced "VP".
      viewed: record({ bigBrotherId: 5001 }),
      roster: [{ id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 }],
    });
    await page.goto("/brother/5247");

    const section = page.getByRole("heading", { name: "Relationships" });
    await expect(section).toBeVisible();
    await expect(page.getByText("Info is private")).toBeVisible();

    // The placeholder is inert: there is no link to the record, because the only
    // page behind it would repeat what the label already says.
    await expect(page.getByRole("link", { name: /brother\/5001/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View his profile" })).toHaveCount(0);

    // And nothing on the page spells the invented initials over the avatar. The
    // avatar is aria-hidden, so assert on the rendered text, not the a11y tree.
    await expect(page.locator("text=/^VP$/")).toHaveCount(0);
  });

  test("resolves normally, badged, for a manager who sees through the hide", async ({ page }) => {
    await mock(page, {
      role: "manager",
      viewed: record({ bigBrotherId: 5001 }),
      roster: [
        { id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 },
        { id: 5001, firstName: "Robert", lastName: "Brown", classYear: 1979, unlisted: true },
      ],
    });
    await page.goto("/brother/5247");

    // The real name, linked — and the Directory's own UNLISTED badge beside it, so
    // one record reads the same on both surfaces.
    await expect(page.getByRole("link", { name: /Robert Brown '79/ })).toBeVisible();
    await expect(page.getByText("Unlisted")).toBeVisible();
    await expect(page.getByText("Info is private")).toHaveCount(0);
  });
});

test.describe("OFC-392 — a withheld Little Brother", () => {
  test("still shows that someone is there when he is the only one", async ({ page }) => {
    await mock(page, {
      role: "brother",
      // No Big Brother and no *visible* Little Brother: before D168 the whole
      // section disappeared, so an unlisted Little Brother was indistinguishable
      // from having none at all.
      viewed: record({ hiddenLittleBrothers: 1 }),
      roster: [{ id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 }],
    });
    await page.goto("/brother/5247");

    await expect(page.getByRole("heading", { name: "Relationships" })).toBeVisible();
    await expect(page.getByText("Little Brothers")).toBeVisible();
    await expect(page.getByText("Info is private")).toBeVisible();
  });

  test("lists the visible ones first, then one placeholder per withheld one", async ({ page }) => {
    await mock(page, {
      role: "brother",
      viewed: record({ hiddenLittleBrothers: 2 }),
      roster: [
        { id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 },
        { id: 5400, firstName: "Tom", lastName: "Wills", classYear: 1990, bigBrotherId: 5247 },
      ],
    });
    await page.goto("/brother/5247");

    await expect(page.getByRole("link", { name: /Tom Wills '90/ })).toBeVisible();
    await expect(page.getByText("Info is private")).toHaveCount(2);
  });

  test("leaves no empty band when there is nothing to report (OFC-318 holds)", async ({ page }) => {
    await mock(page, {
      role: "brother",
      viewed: record(),
      roster: [{ id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 }],
    });
    await page.goto("/brother/5247");

    await expect(page.getByRole("heading", { level: 1, name: /Smyth/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Relationships" })).toHaveCount(0);
  });

  test("the edit page says the same thing, and never the raw Constitution id", async ({ page }) => {
    // The owner is the ONLY viewer who meets a withheld Big Brother in edit mode —
    // a manager or admin resolves every record from his own roster. Before D168 the
    // editor's `names.get(id) ?? \`#${id}\`` fallback rendered him as the clickable
    // raw id "#5001": the same unknown/withheld conflation as "VP", in disguise.
    await mock(page, {
      role: "brother",
      viewerId: 5247,
      viewed: record({ bigBrotherId: 5001, hiddenLittleBrothers: 1 }),
      roster: [{ id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 }],
    });
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    await expect(page.getByText("Info is private")).toHaveCount(2); // Big + one Little
    await expect(page.getByText("#5001")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /5001/ })).toHaveCount(0);
    // The pointer stays the owner's to clear even though he can't see who it is,
    // and the control names no one rather than naming an id.
    await expect(page.getByRole("button", { name: "Remove Big Brother" })).toBeVisible();
  });

  test("the private placeholders keep the page WCAG 2.2 AA clean (D79)", async ({ page }) => {
    await mock(page, {
      role: "brother",
      viewed: record({ bigBrotherId: 5001, hiddenLittleBrothers: 2 }),
      roster: [{ id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 }],
    });
    await page.goto("/brother/5247");
    await expect(page.getByText("Info is private").first()).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
