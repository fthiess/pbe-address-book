import type { RecipientList } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { copyEmailsMessage, skippedDetail } from "./copy-emails-message.js";

function list(overrides: Partial<RecipientList> = {}): RecipientList {
  return {
    text: "",
    copied: 0,
    skippedNoEmail: 0,
    skippedPrivate: 0,
    skippedNotLiving: 0,
    ...overrides,
  };
}

describe("skippedDetail (D167)", () => {
  it("is undefined when nobody was left out", () => {
    expect(skippedDetail(list({ copied: 3 }))).toBeUndefined();
  });

  it("names one reason", () => {
    expect(skippedDetail(list({ copied: 3, skippedNoEmail: 1 }))).toBe(
      "1 brother skipped — no email address (1).",
    );
  });

  it("lists every reason that applies, in a fixed order", () => {
    expect(
      skippedDetail(list({ copied: 3, skippedNoEmail: 2, skippedPrivate: 1, skippedNotLiving: 4 })),
    ).toBe(
      "7 brothers skipped — no email address (2), address kept private (1), deceased or de-brothered (4).",
    );
  });

  it("totals across reasons, so the headline count and this line reconcile", () => {
    expect(skippedDetail(list({ skippedPrivate: 2, skippedNotLiving: 1 }))).toBe(
      "3 brothers skipped — address kept private (2), deceased or de-brothered (1).",
    );
  });
});

describe("copyEmailsMessage (D167)", () => {
  it("explains an empty selection rather than copying the whole view", () => {
    // The one place this deliberately differs from Export CSV, which falls back to
    // the current view. Copying the whole brotherhood is what mailing lists are for.
    const message = copyEmailsMessage(0, list());
    expect(message.headline).toBe("No brothers were selected.");
    expect(message.detail).toContain("Tick the brothers");
    expect(message.tone).toBe("info");
  });

  it("reports a successful copy with the recipient count", () => {
    expect(copyEmailsMessage(12, list({ copied: 12 }))).toEqual({
      headline: "12 email addresses copied to your clipboard.",
      detail: undefined,
      tone: "info",
    });
  });

  it("keeps the singular for one address", () => {
    expect(copyEmailsMessage(1, list({ copied: 1 })).headline).toBe(
      "1 email address copied to your clipboard.",
    );
  });

  it("appends the skipped line to a partial copy", () => {
    const message = copyEmailsMessage(15, list({ copied: 12, skippedPrivate: 3 }));
    expect(message.headline).toBe("12 email addresses copied to your clipboard.");
    expect(message.detail).toBe("3 brothers skipped — address kept private (3).");
  });

  it("distinguishes 'nothing selected' from 'nothing qualified'", () => {
    // A selection where every brother was excluded is a different message: the user
    // did select people, and needs to know why none of them made it.
    const message = copyEmailsMessage(2, list({ skippedNoEmail: 1, skippedNotLiving: 1 }));
    expect(message.headline).toBe("No email addresses to copy.");
    expect(message.detail).toBe(
      "2 brothers skipped — no email address (1), deceased or de-brothered (1).",
    );
  });
});
