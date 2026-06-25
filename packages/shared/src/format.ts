/**
 * Small pure formatting helpers shared by the SPA and the backend. Trivial by
 * design in Phase 0 — they exist to exercise the shared-package wiring and the
 * test harness end to end. Real domain logic (Canonical Name construction,
 * class-year range parsing) arrives with the validation module in Phase 2.
 */

/** Render a Constitution ID in its canonical `#5247` display form. */
export function formatConstitutionId(constitutionId: number): string {
  return `#${constitutionId}`;
}

/** Render a class year in its conventional apostrophe-two-digit form: `'84`. */
export function formatClassYear(classYear: number): string {
  const twoDigit = String(classYear % 100).padStart(2, "0");
  return `'${twoDigit}`;
}
