import { type Address, isSubdivisionCode } from "@pbe/shared";

/**
 * The country-driven State/Province rule (§5.7.5, D37), as a pure function so it
 * can be unit-tested without a DOM. Changing `country` to one whose vocabulary
 * cannot hold the current `stateProvince` (US↔CA, or a controlled code left behind
 * when moving to a free-text country) **clears** the subdivision; the caller shows
 * a brief note when `cleared` is true. A subdivision valid under the new country
 * (or any value under a free-text country) is kept.
 */
export function applyCountryChange(
  address: Address | undefined,
  code: string,
): { next: Address; cleared: boolean } {
  const next: Address = { ...(address ?? {}), country: code };
  if (address?.stateProvince && !isSubdivisionCode(code, address.stateProvince)) {
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
