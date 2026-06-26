/**
 * Bundled geographic reference data for address validation and display
 * (DATABASE-SCHEMA §1, §8; D37). These are *fixed external standards* that
 * essentially never change, so they are compiled into the build as shared
 * constants rather than stored in Firestore.
 *
 * Country list: ISO 3166-1 alpha-2. We store only the **codes** (a compact
 * set); the human-readable display name is derived at render time from the
 * platform's built-in `Intl.DisplayNames`, so there is no hand-maintained
 * name table to drift from the standard. Validation needs only code membership.
 *
 * State/province list: the US and Canadian 2-letter subdivision vocabularies,
 * authored here with display names (short, stable lists). For any other country
 * — or when `country` is unset — `stateProvince` is free text (§8).
 */

/**
 * The officially-assigned ISO 3166-1 alpha-2 country codes. Stored as one
 * space-separated string and split into a Set at module load — far more compact
 * than an object literal, and the membership check is all validation needs.
 */
const COUNTRY_CODE_LIST =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
  "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ " +
  "EC EE EG EH ER ES ET " +
  "FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY " +
  "HK HM HN HR HT HU " +
  "ID IE IL IM IN IO IQ IR IS IT " +
  "JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ " +
  "LA LB LC LI LK LR LS LT LU LV LY " +
  "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ " +
  "OM " +
  "PA PE PF PG PH PK PL PM PN PR PS PT PW PY " +
  "QA " +
  "RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
  "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ " +
  "VA VC VE VG VI VN VU " +
  "WF WS " +
  "YE YT " +
  "ZA ZM ZW";

/** The set of valid ISO 3166-1 alpha-2 codes (uppercase). */
export const COUNTRY_CODES: ReadonlySet<string> = new Set(COUNTRY_CODE_LIST.split(" "));

/** True if `code` is a valid ISO 3166-1 alpha-2 country code (case-insensitive). */
export function isCountryCode(code: string): boolean {
  return COUNTRY_CODES.has(code.trim().toUpperCase());
}

/**
 * Derive a country's English display name from its alpha-2 code via the
 * platform `Intl.DisplayNames`. Returns the code itself if the runtime cannot
 * resolve it (older engines), so display never blanks out.
 */
const regionDisplay =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

export function countryName(code: string): string {
  const upper = code.trim().toUpperCase();
  return regionDisplay?.of(upper) ?? upper;
}

/** US states, the District of Columbia, the main territories, and the military codes (§8). */
export const US_SUBDIVISIONS: Readonly<Record<string, string>> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
  AS: "American Samoa",
  GU: "Guam",
  MP: "Northern Mariana Islands",
  PR: "Puerto Rico",
  VI: "U.S. Virgin Islands",
  AA: "Armed Forces Americas",
  AE: "Armed Forces Europe",
  AP: "Armed Forces Pacific",
};

/** Canadian provinces and territories (§8). */
export const CA_SUBDIVISIONS: Readonly<Record<string, string>> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

/**
 * Whether `country` uses a controlled-vocabulary subdivision (US or CA). For
 * these the entry UI renders a dropdown and the value is validated against the
 * code list; for every other country `stateProvince` is free text (§8, D37).
 */
export function hasControlledSubdivisions(country: string | undefined): boolean {
  const upper = country?.trim().toUpperCase();
  return upper === "US" || upper === "CA";
}

/**
 * Validate a `stateProvince` against the controlled vocabulary for US/CA. For
 * any other country (or none) the value is free text and always passes here —
 * the caller decides whether a free-text value is acceptable in context.
 */
export function isSubdivisionCode(country: string | undefined, code: string): boolean {
  const upperCountry = country?.trim().toUpperCase();
  const upperCode = code.trim().toUpperCase();
  if (upperCountry === "US") {
    return upperCode in US_SUBDIVISIONS;
  }
  if (upperCountry === "CA") {
    return upperCode in CA_SUBDIVISIONS;
  }
  return true;
}

/** Derive a subdivision's display name for US/CA, or echo the value otherwise. */
export function subdivisionName(country: string | undefined, code: string): string {
  const upperCountry = country?.trim().toUpperCase();
  const upperCode = code.trim().toUpperCase();
  if (upperCountry === "US") {
    return US_SUBDIVISIONS[upperCode] ?? code;
  }
  if (upperCountry === "CA") {
    return CA_SUBDIVISIONS[upperCode] ?? code;
  }
  return code;
}
