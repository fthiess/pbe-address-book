import type { CityOrigin, GeoPoint, ZipCentroids } from "@pbe/shared";
import type { ComboboxOption } from "../../components/Combobox.js";

/**
 * The **Near** filter's origin: what the user picked, how it travels in the URL,
 * and what the typeahead offers (OFC-378 session B, design §7). Pure — no React,
 * no fetch — so the grammar and the vocabulary are unit-tested directly, the same
 * split `filters.ts` already keeps from `useDirectoryFilters`.
 *
 * `packages/shared`'s `proximity.ts` owns the *geometry* (normalisation,
 * haversine, the predicate); this owns the *vocabulary* — which is a Directory
 * concern, not a shared one, because it is made of the roster as well as the
 * tables.
 */

/** A chosen origin: a ZIP, a city in the vocabulary, or another brother. */
export type NearOrigin =
  | { readonly kind: "zip"; readonly zip: string }
  | { readonly kind: "city"; readonly name: string; readonly state: string }
  | { readonly kind: "brother"; readonly id: number };

/** A roster member the tables could locate, as the Near control needs him. */
export interface LocatedBrother {
  readonly id: number;
  /** Canonical Name, as everywhere else in the Directory. */
  readonly name: string;
  readonly point: GeoPoint;
  /** His written city/state, for the dropdown hint; either may be absent. */
  readonly city?: string;
  readonly state?: string;
}

/**
 * Everything the control needs to turn a token into a point and a query into
 * options. Null table fields mean "not loaded yet" — every function here then
 * degrades to "cannot resolve" rather than throwing, because the tables are
 * fetched lazily and a URL can carry a `near` token before they land.
 */
export interface NearContext {
  readonly centroids: ZipCentroids | null;
  readonly cities: readonly CityOrigin[] | null;
  /** Located roster members, keyed by Constitution ID. */
  readonly brothers: ReadonlyMap<number, LocatedBrother>;
}

/**
 * The URL token separator.
 *
 * `~` rather than the more obvious `:` or `|` for two reasons that both matter:
 * it is in RFC 3986's *unreserved* set, so it survives the query string
 * unescaped and a shared proximity link stays readable; and the generated
 * `cities.csv` contains no `~` in any city name (the generator asserts no field
 * needs quoting, so it cannot contain a `,` either), which is what lets a city
 * token be split rather than parsed.
 */
const SEP = "~";

/** Serialise an origin for the `near` query parameter. */
export function formatNearToken(origin: NearOrigin): string {
  switch (origin.kind) {
    case "zip":
      return `z${SEP}${origin.zip}`;
    case "city":
      return `c${SEP}${origin.name}${SEP}${origin.state}`;
    case "brother":
      return `b${SEP}${origin.id}`;
  }
}

/**
 * Read a `near` parameter back into an origin, or `undefined` for anything
 * malformed — a hand-edited URL, a link from an older build, a truncated share.
 *
 * ⚠ The token deliberately carries an **identifier, not coordinates**. Baking
 * `42.33,-71.12` into the URL would make a shared link resolve without the
 * tables, and would also freeze a centroid that a table regeneration is entitled
 * to move; an identifier stays true to "the place I picked" and re-resolves
 * against whatever the current tables say. The cost is that a deep link cannot
 * narrow the grid until the tables load, which is why `Directory.tsx` treats a
 * `near` parameter present at mount as its own load trigger.
 */
export function parseNearToken(raw: string | null | undefined): NearOrigin | undefined {
  if (typeof raw !== "string" || raw === "") {
    return undefined;
  }
  const parts = raw.split(SEP);
  const [kind] = parts;
  if (kind === "z" && parts.length === 2 && /^\d{5}$/.test(parts[1] ?? "")) {
    return { kind: "zip", zip: parts[1] as string };
  }
  if (
    kind === "c" &&
    parts.length === 3 &&
    parts[1] !== "" &&
    /^[A-Za-z]{2}$/.test(parts[2] ?? "")
  ) {
    return { kind: "city", name: parts[1] as string, state: (parts[2] as string).toUpperCase() };
  }
  if (kind === "b" && parts.length === 2 && /^\d+$/.test(parts[1] ?? "")) {
    return { kind: "brother", id: Number(parts[1]) };
  }
  return undefined;
}

/** The city index key: case-folded name and state. */
function cityKey(name: string, state: string): string {
  return `${name.toLocaleLowerCase()}${SEP}${state.toLocaleLowerCase()}`;
}

/** Index the city vocabulary for O(1) resolution; `(name, state)` is unique. */
export function indexCities(cities: readonly CityOrigin[]): ReadonlyMap<string, CityOrigin> {
  const index = new Map<string, CityOrigin>();
  for (const city of cities) {
    index.set(cityKey(city.name, city.state), city);
  }
  return index;
}

/**
 * The origin's coordinate, or `undefined` when it cannot be resolved — the
 * tables have not loaded, or the token names a place or a brother that is not
 * there (a hand-typed ZIP that does not exist, a city dropped by a regeneration,
 * a brother outside this viewer's projection).
 *
 * ⚠ Unresolvable is **not** the same as "matches nobody". The caller must not
 * turn it into an empty grid: `Directory.tsx` leaves the view unnarrowed and says
 * so beside the control, because an empty Directory reads as "no brothers live
 * near Boston" rather than as "we could not work out where Boston is".
 */
export function resolveNearPoint(
  origin: NearOrigin,
  context: NearContext,
  cityIndex: ReadonlyMap<string, CityOrigin> | null,
): GeoPoint | undefined {
  switch (origin.kind) {
    case "zip":
      return context.centroids?.get(origin.zip);
    case "city":
      return cityIndex?.get(cityKey(origin.name, origin.state))?.point;
    case "brother":
      return context.brothers.get(origin.id)?.point;
  }
}

/**
 * How a chosen origin reads in the chip. Best-effort and deliberately available
 * **without** resolution: two of the three token kinds carry their own label, so
 * a brother who follows a proximity link sees what was shared with him while the
 * tables are still in flight rather than an empty control that fills in later.
 */
export function nearLabel(origin: NearOrigin, context: NearContext): string {
  switch (origin.kind) {
    case "zip":
      return `ZIP ${origin.zip}`;
    case "city":
      return `${origin.name}, ${origin.state}`;
    case "brother":
      return context.brothers.get(origin.id)?.name ?? `#${origin.id}`;
  }
}

/**
 * How many options each kind may contribute.
 *
 * A cap is not a nicety here. The vocabulary is ~41,000 ZIPs plus ~3,600 cities
 * plus the roster, and `Combobox` renders every match into the DOM — it has no
 * virtualisation, because the two pickers it was built for (majors, Big Brother)
 * top out around a thousand rows. Feeding it an unbounded match set would build
 * tens of thousands of nodes on a two-character query. Per-kind rather than one
 * shared budget so a query matching many cities cannot crowd out the brother who
 * shares their name.
 */
const PER_KIND_LIMIT = 10;

/** Fold a query for matching: trimmed, case-folded, punctuation-insensitive. */
function fold(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[.,]/g, "");
}

/**
 * The options for a typed query, in the order the dropdown shows them: cities,
 * then ZIPs, then brothers.
 *
 * An **empty query returns nothing**, and the control says what to type instead.
 * The alternative — showing the head of a 45,000-item list on focus — is the
 * usual combobox default and would be actively unhelpful here: "Abbeville, LA"
 * is not a useful thing to offer a brother who has just clicked the box, and it
 * is what he would get.
 */
export function nearOptions(query: string, context: NearContext): ComboboxOption[] {
  const folded = fold(query);
  if (folded === "") {
    return [];
  }
  return [
    ...cityOptions(folded, context.cities ?? []),
    ...zipOptions(query, context.centroids),
    ...brotherOptions(folded, context.brothers),
  ];
}

/**
 * Cities matching the query, prefix matches first so "boston" offers Boston, MA
 * above New Boston, TX. Matched against "name, state" as one string, so
 * "brookline ma" and "brookline, ma" both work — `fold` having removed the comma
 * from each side.
 */
function cityOptions(folded: string, cities: readonly CityOrigin[]): ComboboxOption[] {
  const prefix: ComboboxOption[] = [];
  const contains: ComboboxOption[] = [];
  for (const city of cities) {
    if (prefix.length >= PER_KIND_LIMIT) {
      break;
    }
    const haystack = fold(`${city.name}, ${city.state}`);
    if (!haystack.includes(folded)) {
      continue;
    }
    const option: ComboboxOption = {
      value: formatNearToken({ kind: "city", name: city.name, state: city.state }),
      label: `${city.name}, ${city.state}`,
      hint: "City",
    };
    if (haystack.startsWith(folded)) {
      prefix.push(option);
    } else if (contains.length < PER_KIND_LIMIT) {
      contains.push(option);
    }
  }
  return [...prefix, ...contains].slice(0, PER_KIND_LIMIT);
}

/**
 * ZIPs matching what has been typed, when it is digits at all.
 *
 * ⚠ Offered as a **prefix** match, never a numeric-proximity one. `02139` and
 * `02141` sharing four digits says nothing about how far apart they are (D172
 * landmine 1); this matches a prefix only because that is how someone types a
 * ZIP they already know, not because the prefix means anything geographically.
 *
 * ⚠ The label is the bare ZIP, with no town beside it. `zips.csv` is
 * `zip,lat,lon` — session A pruned the city name out of it, and the town for a
 * given ZIP is genuinely not recoverable from the shipped data (`cities.csv`
 * carries no ZIP column). Naming the nearest city in the vocabulary instead was
 * considered and rejected: for a rural ZIP it would confidently print a town
 * fifty miles away.
 */
function zipOptions(query: string, centroids: ZipCentroids | null): ComboboxOption[] {
  const digits = query.trim();
  if (centroids === null || !/^\d{1,5}$/.test(digits)) {
    return [];
  }
  const options: ComboboxOption[] = [];
  // Map iteration follows insertion order, which is the generated file's order —
  // ascending by ZIP — so taking the first N matches yields a sorted list.
  for (const zip of centroids.keys()) {
    if (options.length >= PER_KIND_LIMIT) {
      break;
    }
    if (zip.startsWith(digits)) {
      options.push({
        value: formatNearToken({ kind: "zip", zip }),
        label: zip,
        hint: "ZIP code",
      });
    }
  }
  return options;
}

/**
 * Brothers whose Canonical Name contains the query.
 *
 * ⚠ A plain substring match, deliberately **not** the Directory's Name Search —
 * no typo tolerance, no phonetics, no nickname dictionary, so "Bill" does not
 * find William here as it does in the search box (D35/D123). Forrest's call, with
 * the risk stated: this is a picker over a short scannable list rather than a
 * search for one person (the distinction OFC-354 turns on), and reusing
 * `useNameSearch` would stand a second worker up on a page that already runs one.
 * Revisit if testers find the difference confusing.
 *
 * Only located brothers are offered at all — a brother with no shared address,
 * no usable ZIP or a non-US country cannot be an origin, and offering him would
 * produce a filter that silently matched nobody.
 */
function brotherOptions(
  folded: string,
  brothers: ReadonlyMap<number, LocatedBrother>,
): ComboboxOption[] {
  const options: ComboboxOption[] = [];
  for (const brother of brothers.values()) {
    if (options.length >= PER_KIND_LIMIT) {
      break;
    }
    if (!fold(brother.name).includes(folded)) {
      continue;
    }
    const where =
      brother.city && brother.state
        ? `Brother · ${brother.city}, ${brother.state}`
        : (brother.city ?? "Brother");
    options.push({
      value: formatNearToken({ kind: "brother", id: brother.id }),
      label: brother.name,
      hint: where,
    });
  }
  return options;
}
