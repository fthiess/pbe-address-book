import { type Address, hasControlledSubdivisions, isSubdivisionCode } from "@pbe/shared";

/**
 * The country-driven State/Province rule (§5.7.5, D37), as a pure function so it
 * can be unit-tested without a DOM. Changing `country` **clears** the
 * `stateProvince` whenever the old value can no longer be meaningful, and the
 * caller shows a brief note when `cleared` is true:
 *
 *  - **New country is controlled (US/CA):** keep the value only if it is a valid
 *    code in that country's vocabulary; otherwise clear (e.g. US `MA` → CA, or a
 *    free-text region → US).
 *  - **New country is free text:** keep the value only if the *old* country was
 *    also free text (genuine free-text region data). Leaving a controlled country
 *    (US/CA) strands a 2-letter code that no longer means anything, so it clears —
 *    `MA` must not survive US → United Kingdom as a bare "MA".
 */
export function applyCountryChange(
  address: Address | undefined,
  code: string,
): { next: Address; cleared: boolean } {
  const next: Address = { ...(address ?? {}), country: code };
  const value = address?.stateProvince;
  if (!value) {
    return { next, cleared: false };
  }
  const keep = hasControlledSubdivisions(code)
    ? isSubdivisionCode(code, value)
    : !hasControlledSubdivisions(address?.country);
  if (!keep) {
    next.stateProvince = undefined;
    return { next, cleared: true };
  }
  return { next, cleared: false };
}

/** Whether every field of an address is blank — the draft drops such an address. */
export function isBlankAddress(address: Address | undefined): boolean {
  return (
    address === undefined ||
    Object.values(address).every((value) => (value ?? "").toString().trim() === "")
  );
}
