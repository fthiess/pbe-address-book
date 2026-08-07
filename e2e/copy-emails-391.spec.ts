import { type Page, type Route, expect, test } from "@playwright/test";

/**
 * The Directory's **Copy Emails** action (D167; OFC-391) against the mocked
 * backend: what actually lands on the clipboard, what the result toast reports,
 * and the staff gate.
 *
 * The exclusion rules themselves are unit-tested in
 * `packages/shared/src/email-recipients.test.ts`; what only a browser can prove is
 * the part in between — that the button writes the built string to the real
 * clipboard, that the toast is announced, and that an ordinary brother has no
 * button at all.
 */

const PRIVACY_SHARING = {
  shareEmail: true,
  sharePhone: true,
  shareAddress: true,
  shareEmergency: false,
  shareSpousePartner: false,
};

function meFor(role: "manager" | "brother") {
  return {
    profileId: 5005,
    role,
    realRole: role,
    impersonating: false,
    stars: [] as number[],
    profile: {
      id: 5005,
      firstName: "Mona",
      lastName: "Manager",
      classYear: 1990,
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      hasHeadshot: false,
      privacy: { ...PRIVACY_SHARING },
      unlisted: false,
      allowNewsletterEmail: true,
      allowShareWithMITAA: false,
      lastModified: "2026-06-03T12:00:00.000Z",
      newsletterConsentChangedAt: "2026-06-03T12:00:00.000Z",
    },
  };
}

/** One brother per outcome, so a single select-all exercises every skip bucket. */
const PROFILES = {
  profiles: [
    {
      id: 5001,
      firstName: "Aaron",
      lastName: "Adams",
      classYear: 1984,
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      hasHeadshot: false,
      email: "aaron.adams@example.test",
      privacy: { ...PRIVACY_SHARING },
    },
    {
      id: 5006,
      // A period and an apostrophe — the characters that make the quoting
      // load-bearing rather than cosmetic (an unquoted `.` is not valid atext).
      firstName: "William",
      lastName: "O'Webster Jr.",
      classYear: 1988,
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      hasHeadshot: false,
      email: "will@example.test",
      privacy: { ...PRIVACY_SHARING },
    },
    {
      id: 5007,
      firstName: "Ned",
      lastName: "Noemail",
      classYear: 1992,
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      hasHeadshot: false,
      privacy: { ...PRIVACY_SHARING },
    },
    {
      id: 5008,
      firstName: "Pat",
      lastName: "Private",
      classYear: 1995,
      deceased: { isDeceased: false },
      debrothered: { isDebrothered: false },
      hasHeadshot: false,
      // A manager never receives the address behind an off toggle; the flag is what
      // he classifies on. An admin *would* receive it here and must still skip.
      privacy: { ...PRIVACY_SHARING, shareEmail: false },
    },
  ],
  majors: [],
};

/** A sentinel written before the action, so "the clipboard was left alone" is testable. */
const SENTINEL = "clipboard-was-not-touched";

async function gotoDirectory(page: Page, role: "manager" | "brother" = "manager") {
  await page.route("**/api/me", (route) => route.fulfill({ json: meFor(role) }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: PROFILES }));
  await page.route("**/img/thumbnails/**", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
}

/**
 * The Windows clipboard hands text back as CRLF whatever was written, so read it
 * normalized. The app writes a single line today, but an un-normalized assertion
 * would pass on Linux CI and fail only on a developer's machine — the trap already
 * documented in `bug-reports-5a-2.spec.ts`.
 */
async function readClipboard(page: Page): Promise<string> {
  const text = await page.evaluate(() => navigator.clipboard.readText());
  return text.replace(/\r\n/g, "\n");
}

test.describe("Copy Emails (D167 / OFC-391)", () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  test("copies one selected brother as a quoted RFC 5322 recipient", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("checkbox", { name: /^Select Aaron Adams/ }).check();
    await page.getByRole("button", { name: /^Copy Emails/ }).click();

    expect(await readClipboard(page)).toBe('"Aaron Adams" <aaron.adams@example.test>');
    await expect(page.getByText("1 email address copied to your clipboard.")).toBeVisible();
  });

  test("quotes a name that is not valid unquoted, and joins with a comma", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("checkbox", { name: /^Select Aaron Adams/ }).check();
    await page.getByRole("checkbox", { name: /^Select William O'Webster Jr\./ }).check();
    await page.getByRole("button", { name: /^Copy Emails/ }).click();

    const clip = await readClipboard(page);
    expect(clip).toContain('"Aaron Adams" <aaron.adams@example.test>');
    expect(clip).toContain('"William O\'Webster Jr." <will@example.test>');
    expect(clip).toContain(", ");
    await expect(page.getByText("2 email addresses copied to your clipboard.")).toBeVisible();
  });

  test("skips the private and email-less brothers, and says why", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("checkbox", { name: /select all brothers/i }).check();
    await page.getByRole("button", { name: /^Copy Emails/ }).click();

    const clip = await readClipboard(page);
    expect(clip).toContain("aaron.adams@example.test");
    // Neither the brother with no address nor the one who keeps his private appears.
    expect(clip).not.toContain("Noemail");
    expect(clip).not.toContain("Private");
    await expect(page.getByText("2 email addresses copied to your clipboard.")).toBeVisible();
    await expect(
      page.getByText("2 brothers skipped — no email address (1), address kept private (1)."),
    ).toBeVisible();
  });

  test("fires the D92 audit ping under the clipboard scope", async ({ page }) => {
    await gotoDirectory(page);
    const pings: unknown[] = [];
    await page.route("**/api/exports", (route: Route) => {
      pings.push(route.request().postDataJSON());
      return route.fulfill({ status: 204, body: "" });
    });

    await page.getByRole("checkbox", { name: /^Select Aaron Adams/ }).check();
    await page.getByRole("button", { name: /^Copy Emails/ }).click();
    await expect.poll(() => pings).toEqual([{ scope: "clipboard", count: 1 }]);
  });

  test("explains an empty selection and leaves the clipboard alone", async ({ page }) => {
    await gotoDirectory(page);
    await page.evaluate((sentinel) => navigator.clipboard.writeText(sentinel), SENTINEL);

    await page.getByRole("button", { name: /^Copy Emails/ }).click();
    await expect(page.getByText("No brothers were selected.")).toBeVisible();
    // Nothing to copy is not a copy: whatever the user already had stays put.
    expect(await readClipboard(page)).toBe(SENTINEL);
  });

  test("the result notice is a polite live region and is dismissible", async ({ page }) => {
    await gotoDirectory(page);
    await page.getByRole("checkbox", { name: /^Select Aaron Adams/ }).check();
    await page.getByRole("button", { name: /^Copy Emails/ }).click();

    // `<output>` carries an implicit role="status", so AT announces it without the
    // focus move a dialog would force. Filtered by text because dnd-kit mounts its
    // own (empty) status region for drag announcements — an unfiltered
    // `getByRole("status")` is a strict-mode violation, not a passing assertion.
    const notice = page.getByRole("status").filter({ hasText: "copied to your clipboard" });
    await expect(notice).toHaveCount(1);
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(notice).toHaveCount(0);
  });

  test("the notice sits just under the action bar, not adrift in the viewport", async ({
    page,
  }) => {
    // Both halves of the OFC-391 live-test finding. The notice is anchored to the
    // action bar (`absolute top-full`), so it lands just below the top of the grid —
    // near enough to the button to read as its answer, without covering the controls
    // still in play. Two viewport-`fixed` attempts each failed one end of the page.
    //
    // ⚠ Asserted as an ORDERING, never as coordinates: a pixel assertion would pass
    // on Windows and fail on CI's Linux font metrics (N154's lesson).
    await gotoDirectory(page);
    await page.getByRole("checkbox", { name: /^Select Aaron Adams/ }).check();
    await page.getByRole("button", { name: /^Copy Emails/ }).click();

    const button = await page.getByRole("button", { name: /^Copy Emails/ }).boundingBox();
    const notice = page.getByRole("status").filter({ hasText: "copied to your clipboard" });
    const oneLine = await notice.boundingBox();
    if (!button || !oneLine) throw new Error("expected both to be laid out");
    // Below the button that produced it, and close to it — not parked at the far
    // edge of the viewport.
    expect(oneLine.y).toBeGreaterThanOrEqual(button.y + button.height);
    expect(oneLine.y - (button.y + button.height)).toBeLessThan(40);

    // A one-line message must be SHORTER than a two-line one. It used to be the same
    // height with the text pinned to the top, which read as a blank second line.
    await page.getByRole("checkbox", { name: /^Select Pat Private/ }).check();
    await page.getByRole("button", { name: /^Copy Emails/ }).click();
    await expect(page.getByText(/address kept private/)).toBeVisible();
    const twoLine = await page
      .getByRole("status")
      .filter({ hasText: "copied to your clipboard" })
      .boundingBox();
    expect(twoLine?.height).toBeGreaterThan(oneLine.height);
  });

  test("an ordinary brother has no Copy Emails button at all", async ({ page }) => {
    await gotoDirectory(page, "brother");
    await expect(page.getByRole("button", { name: /^Copy Emails/ })).toHaveCount(0);
    // The whole staff action bar is absent, not just this control.
    await expect(page.getByRole("button", { name: /^Export CSV/ })).toHaveCount(0);
  });
});
