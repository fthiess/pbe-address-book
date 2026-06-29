import {
  type Address,
  type DeceasedInfo,
  countryName,
  formatCanonicalName,
  hasControlledSubdivisions,
  subdivisionName,
} from "@pbe/shared";
import type { ProfileRecord } from "../../lib/types.js";

/** The large constructed Canonical Name for a single record (no list ambiguity). */
export function canonicalName(record: ProfileRecord): string {
  return formatCanonicalName(
    {
      id: record.id,
      firstName: record.firstName ?? "",
      lastName: record.lastName ?? "",
      classYear: record.classYear ?? null,
    },
    false,
  );
}

/**
 * The memorial lifespan line in `b.`/`d.` notation (D122; COMPONENTS.md):
 * both years → `1940–2024` (en-dash, non-breaking); death year only → `d. 2024`;
 * birth-only or neither → nothing (an open "1940–" misreads as still-living). The
 * death year is the explicit `deathYear` or, failing that, the year of a full
 * `dateOfDeath`.
 */
export function lifespanLine(deceased: DeceasedInfo): string | null {
  const death =
    deceased.deathYear ??
    (deceased.dateOfDeath ? Number(deceased.dateOfDeath.slice(0, 4)) : undefined);
  const birth = deceased.birthYear;
  if (birth && death) {
    return `${birth}–${death}`; // en-dash
  }
  if (death) {
    return `d. ${death}`;
  }
  return null;
}

/** A full `YYYY-MM-DD` date as "November 2, 2024" (UTC, so the day never drifts). */
export function formatFullDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return iso;
  }
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The address rendered as display lines (state/country shown by name, not code). */
export function addressLines(address: Address): string[] {
  const lines: string[] = [];
  for (const street of [address.street1, address.street2, address.street3]) {
    if (street) {
      lines.push(street);
    }
  }
  const region = [
    address.city,
    address.stateProvince
      ? hasControlledSubdivisions(address.country)
        ? subdivisionName(address.country, address.stateProvince)
        : address.stateProvince
      : undefined,
    address.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
  if (region) {
    lines.push(region);
  }
  if (address.country && address.country !== "US") {
    lines.push(countryName(address.country));
  }
  return lines;
}

/** Whether an address has any displayable content. */
export function hasAddress(address: Address | undefined): address is Address {
  return (
    address !== undefined &&
    Object.values(address).some((value) => typeof value === "string" && value !== "")
  );
}
