# `@pbe/geo-data` — the proximity search tables

Generates the two static tables behind the Directory's **Near** filter
(OFC-378; `docs/initial-build/PROXIMITY-SEARCH-DESIGN.md` is authoritative for
the design, **D172** and **D177** for the decisions):

| Output | Contents | Size |
|---|---|---|
| `apps/web/public/geo/zips.<hash>.csv` | `zip,lat,lon` for 41,151 US ZIPs | 762 KB raw, 148 KB brotli |
| `apps/web/public/geo/cities.<hash>.csv` | `city,state,lat,lon` for 3,590 places at population ≥ 10,000 | 91 KB raw, 29 KB brotli |
| `apps/web/src/generated/geoTables.ts` | The manifest naming both files | — |

Both tables are committed build outputs, so the app has no runtime dependency on
Census or GeoNames and the data changes only when someone deliberately
regenerates it.

## Regenerating

```bash
npm run build:tables --workspace tools/geo-data
```

Downloads the sources into `.cache/` (gitignored, ~8 MB) and reuses them on
later runs; add `--refresh` to re-fetch, `--dry-run` to build and check without
writing, `--threshold N` to try a different population cut-off, `--help` for the
rest. Output is deterministic: the same three input files always produce the
same bytes, so a rebuild that changes nothing changes no filename either.

The script **is not run by CI** — it needs the network. What CI checks instead
is `npm run assert:geo-tables`: the committed tables still hash to the names they
are served under, the manifest agrees with them, no stale table is left behind,
and no source file imports a table as a module. Everything the script
orchestrates — the source parsers, the archive reader, the merge and population
join, and the spot-check assertions — is covered by unit tests over fixtures
(`src/*.test.ts`); only the fetching and the writing are not.

After regenerating, commit the two `.csv` files and the manifest together, and
run `npm run verify:fast`.

## Sources

| Source | Licence | Used for |
|---|---|---|
| [Census 2020 ZCTA Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) | Public domain | ZIP centroids (authoritative) |
| [GeoNames US postal codes](https://download.geonames.org/export/zip/) | CC BY 4.0 | Place names; centroids for the ~8,000 ZIPs with no ZCTA |
| [Census sub-county population estimates](https://www.census.gov/programs-surveys/popest.html) | Public domain | The city vocabulary's population threshold |

**GeoNames requires attribution** under CC BY 4.0; a link to geonames.org
satisfies it. Today that link travels with the data itself: the `#` provenance
header at the top of each generated file names every source, with a SHA-256 of
the exact input, and carries the geonames.org URL. ⚠ **The user-facing credit on
the About page is session B's** and does not exist yet — do not read the line
above as saying it does. The Census data is public domain and needs none; a
general OSS acknowledgements list, where the credit belongs long-term, is
OFC-408.

## Things that will bite you

- **⚠ The population join deletes New England if you key it on place code.**
  Town-organised states record towns as county subdivisions (SUMLEV 061), not
  places, so Brookline, Lexington, Arlington and Belmont vanish while California
  looks perfect. `buildPopulationIndex` keys on (state, normalised name) across
  SUMLEV 162/157/061/170, and `checks.ts` spot-checks a list of towns so the bug
  cannot come back silently. `checks.test.ts` proves the guard fires.
- **⚠ `sub-est*.csv` is latin-1, not UTF-8.** Nine bytes in the 2024 vintage —
  all in names like "La Cañada Flintridge". Decoded as UTF-8 they arrive as
  U+FFFD, which no normalisation folds back, and those places silently lose
  their population.
- **⚠ The gazetteer pads every field with trailing spaces**, header included.
- **The tables must never be `import`ed.** D74's bundle ceiling sums brotli over
  `dist/assets/*.js` with only a few KB of headroom; the ZIP table alone exceeds
  it. `assert:geo-tables` fails on any `.csv` import.
- **A city name may not contain a comma or a quote.** The browser-side parser is
  a `split(",")` by design (flat CSV, no decoder to test), so the generator
  refuses to emit a name it could not carry.

## Known coverage limits

Both are documented in design §8/§12 and are backstopped by free ZIP entry —
they are not defects to be "fixed" by adding names to the spot-check list:

- **Territories have no origin city.** The GeoNames US postal export covers the
  50 states and DC only. Puerto Rico, Guam and USVI **ZIPs still resolve**, from
  the Census gazetteer, so members there are located normally — only the
  typeahead vocabulary lacks their city names.
- **Unincorporated places have no population to threshold.** The estimates cover
  incorporated places and minor civil divisions, not CDPs, so Bethesda, Silver
  Spring, Reston and McLean are absent — as are the New York borough names and
  the Los Angeles neighbourhood names, which have no Census entity at all.
  Extending the vocabulary to these is **OFC-413**, which carries the measured
  list and the three options.
