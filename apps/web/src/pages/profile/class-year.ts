import { getHelpEntry } from "@pbe/help-content";

/**
 * The class-year input, shared by the two surfaces that collect it — **Add Brother**
 * and **Profile edit**. Both are string-backed (an admin types into a text box) while
 * the stored field is `number | null` (D13, null = unknown), so the string→value rule
 * lives here rather than being written twice.
 *
 * It was written twice, and they diverged: Add Brother mapped a blank box to `NaN`,
 * which the shared validator rejects, so class year was *de facto* mandatory there and
 * even the typed word "unknown" failed (OFC-365). The edit page had it right all along.
 */

/** Blank and the typed word "unknown" both mean D13's `null`; anything unparseable is `NaN`. */
export function parseClassYearInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "" || /^unknown$/i.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

/**
 * The wording under the field, on both surfaces. Sourced from the help registry so the
 * registry stays the single origin — it is what `USER-MANUAL.md` is drift-checked
 * against (`assert:help-manual`), and `class-year.test.ts` guards this lookup.
 */
export const CLASS_YEAR_HELPER = getHelpEntry("profile.classYear")?.helperText ?? "";

/**
 * What the field says when it goes red. Per OFC-365 the helper text does **not** morph
 * into a differently-worded complaint on the ordinary mistake — it is the same sentence
 * in the destructive colour, which is all a blank or malformed entry needs to be told.
 *
 * The exception is a *well-formed* year the validator still rejected, which can only be
 * one outside D13's 1890…currentYear+6 range: "An optional 4-digit year." would be a
 * flat contradiction of a value that plainly is one, so that message survives intact —
 * it is the only one that names the bounds.
 */
export function classYearErrorText(text: string, message: string | undefined): string | undefined {
  if (!message) {
    return undefined;
  }
  return Number.isInteger(parseClassYearInput(text)) ? message : CLASS_YEAR_HELPER;
}
