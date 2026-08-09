import { type Locator, type Page, expect, test } from "@playwright/test";

/**
 * The Mug Name / Nickname split (OFC-409). The backend is mocked at the network
 * layer so this drives the real SPA.
 *
 * The behaviour worth pinning is the *swap*, which no unit test reaches:
 *
 *  - the name quoted under the Canonical Name is the **nickname**, not the mug
 *    name — the single visible change a brother will notice, and the reason the
 *    staging backfill exists;
 *  - the mug name keeps a labelled read-out of its own. Before the split it had
 *    **no** labelled display anywhere — it was only ever that quoted line — so
 *    without this it would be a field you can edit and never see;
 *  - both fields are independently editable, and neither copies into the other:
 *    a brother who wants his mug name used must type it into Nickname himself.
 */

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 5247,
    firstName: "James",
    middleName: "Allen",
    lastName: "Smyth",
    classYear: 1984,
    email: "james@example.test",
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

async function mock(
  page: Page,
  meDoc: ReturnType<typeof me>,
  target: ReturnType<typeof record>,
  roster: ReturnType<typeof record>[] = [],
) {
  await page.route("**/api/me", (route) => route.fulfill({ json: meDoc }));
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: { profiles: roster, majors: [] } }),
  );
  await page.route(/\/api\/profiles\/\d+$/, (route) =>
    route.fulfill({ headers: { ETag: 'W/"v1"' }, json: target }),
  );
}

/**
 * A field's text input by accessible name. ⚠ `getByLabel` is wrong here — it also
 * matches the `?` button (aria-label "Help: Nickname" *contains* the field name)
 * and, on the Directory, the column-picker checkbox. Name the role, pin `exact`.
 */
function textbox(scope: Page | Locator, name: string) {
  return scope.getByRole("textbox", { name, exact: true });
}

test.describe("profile view — which name is quoted", () => {
  test("quotes the NICKNAME under the Canonical Name, not the mug name", async ({ page }) => {
    await mock(page, me("admin", 5247), record({ mugName: "Quantum All-Star", nickname: "Bob" }));
    await page.goto("/brother/5247");

    // ⚠ `exact: true` on both: the mug name also appears on this page, inside the
    // labelled "Mug name: “…”" line, and a substring match would find it there and
    // report a failure that is really the feature working. What is being asserted
    // is specifically that the BARE quoted line — the one under the Canonical Name
    // — holds the nickname and not the mug name.
    await expect(page.getByText("“Bob”", { exact: true })).toBeVisible();
    await expect(page.getByText("“Quantum All-Star”", { exact: true })).toHaveCount(0);
  });

  test("shows the mug name under its own label, so it is not editable-but-invisible", async ({
    page,
  }) => {
    await mock(page, me("admin", 5247), record({ mugName: "Quantum All-Star", nickname: "Bob" }));
    await page.goto("/brother/5247");

    await expect(page.getByText(/Mug name:\s*“Quantum All-Star”/)).toBeVisible();
  });

  test("a brother with a mug name but NO nickname quotes nothing", async ({ page }) => {
    // The state every record is in until its owner fills Nickname in — and, on
    // staging, until the backfill runs. The mug name must NOT silently stand in
    // for the nickname: that substitution is exactly what OFC-409 removed.
    await mock(page, me("admin", 5247), record({ mugName: "Quantum All-Star" }));
    await page.goto("/brother/5247");

    // Bare-quoted (exact) means the Canonical Name line; the labelled line below
    // still carries it, which the second assertion pins.
    await expect(page.getByText("“Quantum All-Star”", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Mug name:\s*“Quantum All-Star”/)).toBeVisible();
  });

  test("omits the mug-name line entirely when unset", async ({ page }) => {
    await mock(page, me("admin", 5247), record({ nickname: "Bob" }));
    await page.goto("/brother/5247");

    await expect(page.getByText("“Bob”", { exact: true })).toBeVisible();
    await expect(page.getByText(/Mug name:/)).toHaveCount(0);
  });
});

test.describe("profile edit — two independent fields", () => {
  test("both fields render in Identity, each with its own inline helper", async ({ page }) => {
    await mock(page, me("admin", 5247), record({ mugName: "Quantum All-Star", nickname: "Bob" }));
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    const identity = page.locator("section", {
      has: page.getByRole("heading", { name: "Identity" }),
    });
    await expect(textbox(identity, "Nickname")).toHaveValue("Bob");
    await expect(textbox(identity, "Mug name")).toHaveValue("Quantum All-Star");

    // helperText, not a `?` popover (Forrest's call): the only thing a brother
    // needs is to tell the two adjacent fields apart, which must not need a click.
    await expect(
      page.getByText("The name you would like other brothers to call you by."),
    ).toBeVisible();
    await expect(page.getByText("The name printed on your PBE mug.")).toBeVisible();
  });

  // ⚠ The regression guard for the bug review caught in this change. `NameRecord[]`
  // is hand-built at TWO sites — the Directory and this picker — and the matcher
  // indexes whatever those objects carry, not whatever `NAME_FIELDS` names. The
  // first cut added `nickname` only to the Directory's builder, which left a
  // brother findable by nickname there and NOT here: no type error, no failing
  // test. Nothing else in the suite searches this picker by a non-given name.
  test("the Big Brother picker finds a brother by his nickname, like the Directory does", async ({
    page,
  }) => {
    // ⚠ The nickname must be UNREACHABLE by any other route, or this proves
    // nothing. The first draft used Robert/"Bob" and passed with the fix reverted:
    // "Bob" finds "Robert" through the common-nickname dictionary (D123), never
    // touching the `nickname` field at all. "Starlord" matches no given name, no
    // surname and no dictionary entry, so only the field can produce this hit.
    const roster = [
      record({ id: 5248, firstName: "Peter", lastName: "Quill", nickname: "Starlord" }),
    ];
    await mock(page, me("admin", 5247), record(), roster);
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    await page.getByRole("combobox", { name: /Search for a Big Brother/ }).fill("starlord");
    await expect(page.getByRole("option", { name: /Peter Quill/ })).toBeVisible();
  });

  test("the Big Brother picker still finds a brother by his mug name", async ({ page }) => {
    // The other half of D174's "both fields stay searched" — asserted here too,
    // because this picker's index is built separately from the Directory's.
    const roster = [
      record({ id: 5248, firstName: "Peter", lastName: "Quill", mugName: "Quantum All-Star" }),
    ];
    await mock(page, me("admin", 5247), record(), roster);
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    await page.getByRole("combobox", { name: /Search for a Big Brother/ }).fill("quantum");
    await expect(page.getByRole("option", { name: /Peter Quill/ })).toBeVisible();
  });

  test("editing one field does not touch the other", async ({ page }) => {
    // There is deliberately no copy in either direction — a brother who wants his
    // mug name used as his nickname types it into both.
    await mock(page, me("admin", 5247), record({ mugName: "Quantum All-Star" }));
    await page.goto("/brother/5247/edit");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    await textbox(page, "Nickname").fill("Bob");
    await expect(textbox(page, "Mug name")).toHaveValue("Quantum All-Star");
  });
});
