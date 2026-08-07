import { describe, expect, it } from "vitest";
import { DEFAULT_PRIVACY } from "./defaults.js";
import {
  type RecipientCandidate,
  buildRecipientList,
  formatRecipient,
  isEmittableAddress,
} from "./email-recipients.js";
import { validateProfile } from "./validation.js";

/** A living brother who shares his email — the baseline every case varies from. */
function candidate(overrides: Partial<RecipientCandidate> = {}): RecipientCandidate {
  return {
    firstName: "James",
    lastName: "Smyth",
    email: "james@example.test",
    privacy: { ...DEFAULT_PRIVACY },
    unlisted: false,
    deceased: { isDeceased: false },
    debrothered: { isDebrothered: false },
    ...overrides,
  };
}

describe("formatRecipient — RFC 5322 quoted display names (D167)", () => {
  it("wraps the display name in a quoted-string", () => {
    expect(formatRecipient("James Smyth", "james@example.test")).toBe(
      '"James Smyth" <james@example.test>',
    );
  });

  it("quotes names containing characters that are not valid atext", () => {
    // Each of these would change or lose meaning unquoted: `.` is not atext at all,
    // `(` opens an RFC 5322 comment, and `,` would split one recipient into two.
    expect(formatRecipient("James Smyth Jr.", "a@x.test")).toBe('"James Smyth Jr." <a@x.test>');
    expect(formatRecipient("Bob (Robert) Smyth", "a@x.test")).toBe(
      '"Bob (Robert) Smyth" <a@x.test>',
    );
    expect(formatRecipient("Smyth, James", "a@x.test")).toBe('"Smyth, James" <a@x.test>');
    expect(formatRecipient("D'Angelo St. John", "a@x.test")).toBe(
      '"D\'Angelo St. John" <a@x.test>',
    );
  });

  it("backslash-escapes the two characters a quoted-string cannot carry raw", () => {
    expect(formatRecipient('James "Jim" Smyth', "a@x.test")).toBe(
      '"James \\"Jim\\" Smyth" <a@x.test>',
    );
    expect(formatRecipient("James\\Smyth", "a@x.test")).toBe('"James\\\\Smyth" <a@x.test>');
  });

  it("collapses control characters to spaces — a pasted CR/LF would be header injection", () => {
    expect(formatRecipient("James\r\nBcc: evil@x.test", "a@x.test")).toBe(
      '"James Bcc: evil@x.test" <a@x.test>',
    );
    expect(formatRecipient("James\tSmyth", "a@x.test")).toBe('"James Smyth" <a@x.test>');
  });

  it("falls back to the bare address when the name reduces to nothing", () => {
    expect(formatRecipient("", "a@x.test")).toBe("a@x.test");
    expect(formatRecipient("   ", "a@x.test")).toBe("a@x.test");
  });

  it("trims surrounding whitespace off the address", () => {
    expect(formatRecipient("James Smyth", "  a@x.test  ")).toBe('"James Smyth" <a@x.test>');
  });
});

describe("isEmittableAddress — the address half cannot be escaped, so it is screened", () => {
  it("accepts an ordinary address", () => {
    expect(isEmittableAddress("james@example.test")).toBe(true);
    expect(isEmittableAddress("  james+tag@example.test  ")).toBe(true);
  });

  it("rejects the characters that would end the address early in a recipient list", () => {
    for (const bad of [
      "x@evil.com>,y.z", // closes the <...> and starts a second recipient
      "x@evil<z.test",
      "x@evil.test,y@z.test",
      "x@evil.test;y@z.test",
      'x@"evil".test',
      "x@evil\\.test",
      "x@evil.test (comment)",
      "x@evil.test\r\nBcc: y@z.test",
    ]) {
      expect(isEmittableAddress(bad), bad).toBe(false);
    }
  });

  it("rejects an empty or whitespace-only address", () => {
    expect(isEmittableAddress("")).toBe(false);
    expect(isEmittableAddress("   ")).toBe(false);
  });

  it("⚠ THE PREMISE: Book's own validator ACCEPTS the injecting address", () => {
    // Without this the screen above looks like defence against nothing. `EMAIL_RE`
    // is `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` — it rejects whitespace and a second `@`
    // and nothing else, so this really can be stored on a real record, by a brother
    // editing his own profile. If a future change tightens EMAIL_RE, this test
    // fails and tells whoever did it that the screen may now be redundant, rather
    // than leaving a dead guard nobody dares remove.
    expect(validateProfile({ email: "x@evil.com>,y.z" }).ok).toBe(true);
    expect(isEmittableAddress("x@evil.com>,y.z")).toBe(false);
  });
});

describe("buildRecipientList — the copy set and the skip tally (D167)", () => {
  it("copies a living, sharing brother with an email", () => {
    expect(buildRecipientList([candidate()])).toEqual({
      text: '"James Smyth" <james@example.test>',
      copied: 1,
      skippedNoEmail: 0,
      skippedPrivate: 0,
      skippedNotLiving: 0,
    });
  });

  it("joins several recipients with a comma and a space, preserving input order", () => {
    // The caller passes rows already sorted by the Directory's active sort, so the
    // pasted To: line matches what the user last saw — order is part of the contract.
    const list = buildRecipientList([
      candidate({ firstName: "Zach", lastName: "Zeta", email: "z@x.test" }),
      candidate({ firstName: "Adam", lastName: "Alpha", email: "a@x.test" }),
    ]);
    expect(list.text).toBe('"Zach Zeta" <z@x.test>, "Adam Alpha" <a@x.test>');
    expect(list.copied).toBe(2);
  });

  it("skips a brother with no usable email", () => {
    const list = buildRecipientList([candidate({ email: undefined }), candidate({ email: "   " })]);
    expect(list.text).toBe("");
    expect(list.copied).toBe(0);
    expect(list.skippedNoEmail).toBe(2);
  });

  it("skips a brother whose stored address would inject a second recipient", () => {
    // The repro for the review finding. Before the screen, this produced
    // `"Ivan Inject" <x@evil.com>,y.z>` — which a mail client reads as TWO
    // recipients, the second never selected by anyone. The address half sits
    // between `<` and `>` in a comma-separated list and so cannot be escaped into
    // safety the way the display name can; the only correct move is to omit it.
    const list = buildRecipientList([
      candidate({ firstName: "Ivan", lastName: "Inject", email: "x@evil.com>,y.z" }),
      candidate({ email: "good@example.test" }),
    ]);
    expect(list.text).toBe('"James Smyth" <good@example.test>');
    expect(list.text).not.toContain("y.z");
    expect(list.copied).toBe(1);
    expect(list.skippedNoEmail).toBe(1);
  });

  it("skips a brother whose shareEmail is off", () => {
    const list = buildRecipientList([
      candidate({ privacy: { ...DEFAULT_PRIVACY, shareEmail: false } }),
    ]);
    expect(list.copied).toBe(0);
    expect(list.skippedPrivate).toBe(1);
    expect(list.skippedNoEmail).toBe(0);
  });

  it("skips an UNLISTED brother, even one who left shareEmail on", () => {
    // The live-test finding (N164). An unlisted brother hides his whole record from
    // his peers — a *stronger* privacy statement than turning off `shareEmail` — so
    // honouring the weaker signal while ignoring the stronger made no sense. The
    // governing question is "may this address be republished to other brothers?",
    // not "may staff see the record?" (staff can, by D124, which is why it was
    // originally and wrongly kept in).
    const list = buildRecipientList([
      candidate({ unlisted: true, privacy: { ...DEFAULT_PRIVACY, shareEmail: true } }),
    ]);
    expect(list.text).toBe("");
    expect(list.copied).toBe(0);
    expect(list.skippedPrivate).toBe(1);
  });

  it("counts unlisted and shareEmail-off in one bucket, never twice", () => {
    // They share a bucket because they are the same answer to the user; a brother
    // who is both must still count once, or the reported total stops reconciling.
    const list = buildRecipientList([
      candidate({ unlisted: true, privacy: { ...DEFAULT_PRIVACY, shareEmail: false } }),
      candidate({ unlisted: true }),
      candidate({ privacy: { ...DEFAULT_PRIVACY, shareEmail: false } }),
    ]);
    expect(list.skippedPrivate).toBe(3);
    expect(list.copied).toBe(0);
  });

  it("treats an absent unlisted field as listed, not as a reason to withhold", () => {
    const list = buildRecipientList([candidate({ unlisted: undefined })]);
    expect(list.copied).toBe(1);
    expect(list.skippedPrivate).toBe(0);
  });

  it("skips a deceased brother and a de-brothered one, counted together", () => {
    const list = buildRecipientList([
      candidate({ deceased: { isDeceased: true } }),
      candidate({ debrothered: { isDebrothered: true } }),
    ]);
    expect(list.copied).toBe(0);
    expect(list.skippedNotLiving).toBe(2);
  });

  it("counts a record in exactly one bucket — not-living wins over private and no-email", () => {
    // Classification order is load-bearing: the tally is reported to the user, so a
    // brother counted twice would make the arithmetic visibly wrong ("3 of 2 skipped").
    const list = buildRecipientList([
      candidate({
        deceased: { isDeceased: true },
        privacy: { ...DEFAULT_PRIVACY, shareEmail: false },
        email: undefined,
      }),
    ]);
    expect(list).toEqual({
      text: "",
      copied: 0,
      skippedNoEmail: 0,
      skippedPrivate: 0,
      skippedNotLiving: 1,
    });
  });

  it("reports identical counts for the MANAGER and ADMIN shapes of the same record", () => {
    // The rule this pins (D167 fork 2). `privacy` is `restricted`, so both staff
    // roles receive it; only the ADMIN receives the `email` behind an off toggle
    // (D19). Classifying on the flag *before* the value is what makes the two
    // agree — reverse the order and the same selection tallies differently
    // depending on who is looking at it.
    const asManager = candidate({
      privacy: { ...DEFAULT_PRIVACY, shareEmail: false },
      email: undefined, // the projection withheld it
    });
    const asAdmin = candidate({
      privacy: { ...DEFAULT_PRIVACY, shareEmail: false },
      email: "james@example.test", // the admin sees through the toggle
    });
    expect(buildRecipientList([asManager])).toEqual(buildRecipientList([asAdmin]));
    expect(buildRecipientList([asAdmin]).skippedPrivate).toBe(1);
  });

  it("treats an absent privacy block as sharing, not as a reason to withhold", () => {
    // A projected record can legitimately arrive without a block; only an explicit
    // `false` is a decision the brother made.
    const list = buildRecipientList([candidate({ privacy: undefined })]);
    expect(list.copied).toBe(1);
    expect(list.skippedPrivate).toBe(0);
  });

  it("treats absent deceased/de-brothered blocks as living", () => {
    const list = buildRecipientList([candidate({ deceased: undefined, debrothered: undefined })]);
    expect(list.copied).toBe(1);
    expect(list.skippedNotLiving).toBe(0);
  });

  it("returns an empty result for an empty selection", () => {
    expect(buildRecipientList([])).toEqual({
      text: "",
      copied: 0,
      skippedNoEmail: 0,
      skippedPrivate: 0,
      skippedNotLiving: 0,
    });
  });

  it("tallies a mixed selection so the buckets sum to the input size", () => {
    const profiles = [
      candidate({ email: "a@x.test" }),
      candidate({ email: undefined }),
      candidate({ privacy: { ...DEFAULT_PRIVACY, shareEmail: false } }),
      candidate({ deceased: { isDeceased: true } }),
      candidate({ email: "b@x.test" }),
    ];
    const list = buildRecipientList(profiles);
    expect(list.copied).toBe(2);
    expect(list.skippedNoEmail).toBe(1);
    expect(list.skippedPrivate).toBe(1);
    expect(list.skippedNotLiving).toBe(1);
    expect(list.copied + list.skippedNoEmail + list.skippedPrivate + list.skippedNotLiving).toBe(
      profiles.length,
    );
  });
});
