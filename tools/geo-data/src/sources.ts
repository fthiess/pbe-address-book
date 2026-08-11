/**
 * Parsers for the three upstream sources behind the proximity tables (D172,
 * `PROXIMITY-SEARCH-DESIGN.md` §3). Pure functions over already-read text, so
 * every one of them is unit-testable without a network fetch — the download
 * itself lives in `build-tables.ts`, which no test and no CI step ever runs.
 *
 * Each parser is deliberately tolerant of the *shape* of its file (padded
 * fields, blank trailing lines) and strict about its *content* (a row whose
 * coordinates do not parse is dropped and counted, never silently coerced to
 * zero — a 0,0 centroid is in the Gulf of Guinea and would place a brother
 * there rather than fail).
 */

/** A row of the Census ZCTA Gazetteer: a five-digit ZCTA and its internal point. */
export interface GazetteerRow {
  zcta: string;
  lat: number;
  lon: number;
}

/** A row of the GeoNames US postal-code export. */
export interface GeoNamesRow {
  zip: string;
  /** The place name as GeoNames writes it — this is what a user types. */
  place: string;
  /** Two-letter state/territory code (`admin code1`). */
  stateCode: string;
  /** Full state/territory name (`admin name1`) — the join key against Census. */
  stateName: string;
  lat: number;
  lon: number;
}

/** A sub-county population estimate row, reduced to what the threshold needs. */
export interface PopulationRow {
  /** Summary level: 162 incorporated place, 157 place part, 061 county subdivision. */
  sumlev: string;
  /** Full state name, as the file writes it. */
  stateName: string;
  /** Entity name including its type word, e.g. "Brookline town". */
  name: string;
  population: number;
}

/** Rows dropped for unparseable content, reported so the build can refuse a bad source. */
export interface ParseResult<T> {
  rows: T[];
  skipped: number;
}

/** Split into lines, dropping a trailing newline and any blank lines. */
function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "");
}

/**
 * A finite coordinate, or `undefined`. Rejects `NaN` and the out-of-range values
 * a shifted column would produce; `Number("")` is 0, so the emptiness check has
 * to come first or a missing field would read as a valid coordinate.
 */
function coordinate(raw: string | undefined, limit: number): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return undefined;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined;
}

/**
 * Parse the Census 2020 ZCTA Gazetteer (`2020_Gaz_zcta_national.txt`).
 *
 * Tab-separated with a header row, and — the trap — **every field is padded
 * with trailing spaces**, including the header names, so nothing can be compared
 * or parsed without trimming first.
 */
export function parseGazetteer(text: string): ParseResult<GazetteerRow> {
  const [header, ...body] = lines(text);
  if (header === undefined) {
    return { rows: [], skipped: 0 };
  }
  const columns = header.split("\t").map((name) => name.trim());
  const geoidAt = columns.indexOf("GEOID");
  const latAt = columns.indexOf("INTPTLAT");
  const lonAt = columns.indexOf("INTPTLONG");
  if (geoidAt < 0 || latAt < 0 || lonAt < 0) {
    throw new Error(
      `gazetteer: expected GEOID/INTPTLAT/INTPTLONG columns, found: ${columns.join(", ")}`,
    );
  }

  const rows: GazetteerRow[] = [];
  let skipped = 0;
  for (const line of body) {
    const fields = line.split("\t");
    const zcta = fields[geoidAt]?.trim() ?? "";
    const lat = coordinate(fields[latAt], 90);
    const lon = coordinate(fields[lonAt], 180);
    if (!/^\d{5}$/.test(zcta) || lat === undefined || lon === undefined) {
      skipped++;
      continue;
    }
    rows.push({ zcta, lat, lon });
  }
  return { rows, skipped };
}

/**
 * Parse the GeoNames US postal-code export (`US.txt`), tab-separated with no
 * header. Column order is fixed by the GeoNames `readme.txt`:
 * `country, postal, place, admin1 name, admin1 code, admin2 name, admin2 code,
 * admin3 name, admin3 code, lat, lon, accuracy`.
 *
 * Rows for other countries cannot appear in the US export, but the country
 * column is checked anyway — it costs nothing and makes a swapped input file
 * fail loudly instead of producing a plausible-looking table.
 *
 * The ~511 rows this skips are the military APO/FPO/DPO ZIPs, which carry no
 * state code and sit at overseas coordinates. Dropping them is right for a US
 * proximity filter: they have no ZCTA either, so an APO address simply does not
 * resolve rather than placing a brother in Frankfurt.
 */
export function parseGeoNames(text: string): ParseResult<GeoNamesRow> {
  const rows: GeoNamesRow[] = [];
  let skipped = 0;
  for (const line of lines(text)) {
    const fields = line.split("\t");
    const country = fields[0]?.trim() ?? "";
    const zip = fields[1]?.trim() ?? "";
    const place = fields[2]?.trim() ?? "";
    const stateName = fields[3]?.trim() ?? "";
    const stateCode = fields[4]?.trim().toUpperCase() ?? "";
    const lat = coordinate(fields[9], 90);
    const lon = coordinate(fields[10], 180);
    if (
      country !== "US" ||
      !/^\d{5}$/.test(zip) ||
      place === "" ||
      !/^[A-Z]{2}$/.test(stateCode) ||
      lat === undefined ||
      lon === undefined
    ) {
      skipped++;
      continue;
    }
    rows.push({ zip, place, stateCode, stateName, lat, lon });
  }
  return { rows, skipped };
}

/**
 * Split one line of RFC 4180-ish CSV. The Census population file quotes any name
 * containing a comma ("Athens-Clarke County unified government (balance)" is
 * fine, but a few entries are not), so a bare `split(",")` would shift every
 * column after the name and read a FIPS code as a population.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse the Census sub-county population estimates (`sub-est2024.csv`).
 *
 * ⚠ **This file is latin-1, not UTF-8** — nine bytes in the 2024 vintage, all of
 * them in names like "La Cañada Flintridge city". Read as UTF-8 those names
 * arrive carrying U+FFFD, which no amount of downstream normalisation folds back
 * to a letter, so the affected places silently lose their population and drop
 * out of the vocabulary. `build-tables.ts` decodes this file as latin-1; the
 * parser itself only sees the decoded string.
 *
 * `populationColumn` names the estimate vintage to read (e.g. `POPESTIMATE2024`),
 * so the caller records in the provenance header exactly which year it used.
 */
export function parseSubEst(text: string, populationColumn: string): ParseResult<PopulationRow> {
  const [header, ...body] = lines(text);
  if (header === undefined) {
    return { rows: [], skipped: 0 };
  }
  const columns = splitCsvLine(header).map((name) => name.trim().toUpperCase());
  const sumlevAt = columns.indexOf("SUMLEV");
  const nameAt = columns.indexOf("NAME");
  const stateAt = columns.indexOf("STNAME");
  const popAt = columns.indexOf(populationColumn.toUpperCase());
  if (sumlevAt < 0 || nameAt < 0 || stateAt < 0 || popAt < 0) {
    throw new Error(
      `sub-est: expected SUMLEV/NAME/STNAME/${populationColumn} columns, found: ${columns.join(", ")}`,
    );
  }

  const rows: PopulationRow[] = [];
  let skipped = 0;
  for (const line of body) {
    const fields = splitCsvLine(line);
    const sumlev = fields[sumlevAt]?.trim() ?? "";
    const name = fields[nameAt]?.trim() ?? "";
    const stateName = fields[stateAt]?.trim() ?? "";
    // Same trap as the coordinates: `Number("")` is 0, so a blank population
    // would read as a real count of zero rather than a missing value.
    const rawPopulation = fields[popAt]?.trim() ?? "";
    const population = rawPopulation === "" ? Number.NaN : Number(rawPopulation);
    if (sumlev === "" || name === "" || stateName === "" || !Number.isFinite(population)) {
      skipped++;
      continue;
    }
    rows.push({ sumlev, stateName, name, population });
  }
  return { rows, skipped };
}
