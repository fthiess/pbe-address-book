import AxeBuilder from "@axe-core/playwright";
import { type Page, type Route, expect, test } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Phase 5.5k / OFC-256 — the personal Star on the Profile page. The star set is now
 * hoisted into a shell-level provider (StarsContext) shared by the Directory and the
 * Profile, so a toggle on one surface is reflected on the other **without a reload**.
 * This spec drives the real SPA over a mocked backend and proves that round-trip in
 * both directions, then gates the new header control on WCAG 2.2 AA at a phone
 * viewport (the N93 icon-control-loses-its-name trap only the mobile axe pass catches).
 *
 * The shared set lives in memory, so the round-trip must use SPA navigation (a row
 * click and history Back) — never `page.goto`, which reloads and reseeds from
 * `/api/me`.
 */

function meBrother() {
  return {
    profileId: 5002,
    role: "brother" as const,
    realRole: "brother" as const,
    impersonating: false,
    stars: [] as number[],
    profile: {
      id: 5002,
      firstName: "Dev",
      lastName: "Brother",
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
}

// Named without a fullLegalName/suffix so the Canonical Name is exactly
// "Aaron Adams" on both surfaces — the star's accessible label matches verbatim.
const PROFILES = {
  profiles: [
    {
      id: 5001,
      firstName: "Aaron",
      lastName: "Adams",
      classYear: 1984,
      majors: ["6-3"],
      deceased: { isDeceased: false },
      hasHeadshot: false,
      email: "aaron.adams@example.test",
    },
    {
      id: 5002,
      firstName: "Dev",
      lastName: "Brother",
      classYear: 1990,
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
    {
      id: 5006,
      firstName: "William",
      lastName: "Webster",
      classYear: 1988,
      deceased: { isDeceased: false },
      hasHeadshot: false,
    },
  ],
  majors: [],
};

async function mockBackend(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: meBrother() }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: PROFILES }));
  // A single-record read for the Profile page a row links to, synthesized from the id.
  await page.route(/\/api\/profiles\/\d+$/, (route) => {
    const id = Number(/(\d+)$/.exec(route.request().url())?.[1]);
    const named = PROFILES.profiles.find((p) => p.id === id);
    route.fulfill({
      headers: { ETag: "v1" },
      json: {
        id,
        firstName: named?.firstName ?? "Test",
        lastName: named?.lastName ?? "Brother",
        classYear: named?.classYear ?? 1990,
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
    });
  });
  await page.route("**/img/thumbnails/**", (route) => route.fulfill({ status: 404 }));
  // Star writes echo the resulting list, as the real endpoint does, so the SPA can
  // reconcile its optimistic set to the server's authoritative array (OFC-103).
  const starred = new Set<number>();
  await page.route("**/api/me/stars/**", (route: Route) => {
    const request = route.request();
    const id = Number(request.url().split("/").pop());
    if (request.method() === "DELETE") {
      starred.delete(id);
    } else {
      starred.add(id);
    }
    return route.fulfill({ json: { stars: [...starred] } });
  });
}

test.describe("Profile 5.5k — star on the Profile page (OFC-256)", () => {
  test("a star reflects between the Directory and the Profile without a reload", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();

    // Star Aaron on the DIRECTORY.
    await page.getByRole("button", { name: /^Star Aaron Adams/ }).click();
    await expect(page.getByRole("button", { name: /^Starred: Aaron Adams/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Open his Profile via SPA navigation — the shared set must survive the hop.
    await page
      .getByRole("rowheader", { name: /Aaron Adams/ })
      .getByRole("link")
      .click();
    await page.waitForURL(/\/brother\/5001$/);

    // The Profile shows him starred (Directory → Profile reflection).
    const profileStar = page.getByRole("button", { name: /Aaron Adams/ });
    await expect(profileStar).toHaveAttribute("aria-pressed", "true");

    // Unstar on the PROFILE; the optimistic flip is immediate.
    await profileStar.click();
    await expect(page.getByRole("button", { name: /^Star Aaron Adams/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Back to the Directory (history pop, client-side): the row reflects the unstar
    // done on the Profile (Profile → Directory reflection, shared set).
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Star Aaron Adams/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("the Profile star keeps its accessible name and passes axe on a phone viewport (N93)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockBackend(page);
    await page.goto("/brother/5001");

    // Present, unpressed, and named for assistive tech (the icon control must never
    // collapse to a nameless button — WCAG 4.1.2, the N93 trap).
    const star = page.getByRole("button", { name: /^Star Aaron Adams/ });
    await expect(star).toHaveAttribute("aria-pressed", "false");

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
});
