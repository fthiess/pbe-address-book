import {
  type Address,
  CA_SUBDIVISIONS,
  COUNTRY_CODES,
  US_SUBDIVISIONS,
  countryName,
  hasControlledSubdivisions,
} from "@pbe/shared";
import { useMemo, useState } from "react";
import { applyCountryChange } from "./address-edit.js";
import { SelectField, TextField } from "./fields.js";

/**
 * The editable **address block** with the country-driven State/Province control
 * (§5.7.5, D37). State/Province **watches `country`**: a dropdown of USPS / Canadian
 * codes when the country is US or CA (display name shown, code stored), free text
 * for anywhere else. New or blank addresses default `country` to `US` (≈96% of the
 * membership is US/CA); switching to a country whose vocabulary doesn't contain the
 * current subdivision **clears it with a brief note** rather than keeping an invalid
 * value. The whole block edits as a unit — each change rebuilds the `Address` and
 * the draft drops it entirely when every field is blank.
 */
export function AddressEditor({
  address,
  onChange,
  countryError,
  stateError,
}: {
  address: Address | undefined;
  onChange: (address: Address | undefined) => void;
  countryError?: string;
  stateError?: string;
}) {
  const [clearedNote, setClearedNote] = useState(false);
  const country = address?.country ?? "US";
  const controlled = hasControlledSubdivisions(country);

  const countryOptions = useMemo(() => buildCountryOptions(), []);
  const subdivisions = country.toUpperCase() === "CA" ? CA_SUBDIVISIONS : US_SUBDIVISIONS;
  const subdivisionOptions = useMemo(
    () => Object.entries(subdivisions).sort((a, b) => a[1].localeCompare(b[1])),
    [subdivisions],
  );

  function update(partial: Partial<Address>) {
    setClearedNote(false);
    const next: Address = { ...(address ?? {}), country, ...partial };
    onChange(next);
  }

  function onCountryChange(code: string) {
    const { next, cleared } = applyCountryChange(address, code);
    setClearedNote(cleared);
    onChange(next);
  }

  return (
    <div className="space-y-4">
      <TextField
        label="Street address"
        value={address?.street1 ?? ""}
        onChange={(v) => update({ street1: v || undefined })}
        autoComplete="address-line1"
      />
      <TextField
        label="Street address line 2"
        value={address?.street2 ?? ""}
        onChange={(v) => update({ street2: v || undefined })}
        autoComplete="address-line2"
      />
      <TextField
        label="Street address line 3"
        value={address?.street3 ?? ""}
        onChange={(v) => update({ street3: v || undefined })}
        autoComplete="address-line3"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="City"
          value={address?.city ?? ""}
          onChange={(v) => update({ city: v || undefined })}
          autoComplete="address-level2"
        />
        <TextField
          label="Postal code"
          value={address?.postalCode ?? ""}
          onChange={(v) => update({ postalCode: v || undefined })}
          autoComplete="postal-code"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Country"
          value={country}
          onChange={onCountryChange}
          error={countryError}
        >
          {countryOptions.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </SelectField>
        {controlled ? (
          <SelectField
            label="State / Province"
            value={address?.stateProvince ?? ""}
            onChange={(v) => update({ stateProvince: v || undefined })}
            error={stateError}
            helper={clearedNote ? "Cleared — it didn't match the new country." : undefined}
          >
            <option value="">— Select —</option>
            {subdivisionOptions.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </SelectField>
        ) : (
          <TextField
            label="State / Province / Region"
            value={address?.stateProvince ?? ""}
            onChange={(v) => update({ stateProvince: v || undefined })}
            error={stateError}
            helper={clearedNote ? "Cleared — it didn't match the new country." : undefined}
          />
        )}
      </div>
    </div>
  );
}

/** Country options as `[code, displayName]`, US and CA first, then alphabetical by name. */
function buildCountryOptions(): [string, string][] {
  const priority = ["US", "CA"];
  const rest = [...COUNTRY_CODES]
    .filter((code) => !priority.includes(code))
    .map((code) => [code, countryName(code)] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));
  return [...priority.map((code) => [code, countryName(code)] as [string, string]), ...rest];
}
