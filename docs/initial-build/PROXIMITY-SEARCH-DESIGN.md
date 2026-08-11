# Proximity Search — Design

**Ticket:** OFC-378 · **Related:** OFC-151 (Map View, post-launch) · **Status:** approved 2026-08-09; **session A (data pipeline + resolver) built 2026-08-11 — see D177/N172 for the as-built record and `tools/geo-data/README.md` for operations; session B (Near control) not yet started**

Adds a "Near" filter to the Directory: enter a place — a city, a ZIP, or another
brother — and the Directory narrows to brothers within a chosen radius, composing
with every filter already there. The motivating cases are a brother organising a
regional gathering and an active looking for mentors ("Employer: Google, Near:
NYC, Class Year: 2000–"), which is the stronger of the two and the reason this is
a pre-launch feature rather than a post-launch one.

This document records the design, the measurements behind it, and the decisions
still open. It is a design doc, not a coding plan; the build sequence in §10 is
deliberately coarse.

---

## 1. Scope

**In:** a US proximity filter on the Directory page, client-side, composing with
existing filters; a typeahead "Near" control; a selectable radius.

**Out:** international proximity (§8), driving distance or routing, per-result
distance display, map rendering (OFC-151), and "near my current location" via
browser geolocation. Each is a candidate follow-up, none is required for launch.

**Precision is explicitly not a goal.** The requirement is "brothers who could
generously be considered to be in the area." Every trade below resolves toward
simplicity and byte-frugality rather than accuracy.

---

## 2. Two approaches considered and rejected

**ZIP-prefix arithmetic.** The original hypothesis was that ZIP codes encode
enough geography to support proximity directly — that ZIPs sharing a prefix are
near each other. They are not reliably. ZIPs encode mail routing, and the
converse of "numerically close implies physically close" fails hardest in exactly
the metros where brothers cluster. From 94041 (Mountain View), Santa Clara is
about seven miles away at 95050 — diverging at the *second* digit — while 94901
(San Rafael, ~35 miles across the Golden Gate) shares two digits. In the Bay Area
prefix similarity is anti-correlated with distance. St. Louis repeats the pattern:
63101 (MO) and 62201 (IL) are three miles apart across the river. Density
compounds it — a three-digit prefix spans a few miles in Manhattan and well over a
hundred in rural Nevada, so no radius can be attached to a prefix rule. Patching
this with a prefix-adjacency table would be a larger, less accurate version of the
centroid table it was meant to avoid.

**A third-party geocoding API.** Resolving the user's typed origin through a
commercial geocoder would work, but it buys precision the use case does not need
and costs a new external dependency, a key to rotate (a failure mode this project
has already met once), terms that restrict caching results, a new outage surface,
and the privacy question of forwarding a brother's typed location off-site. Static
public-domain data resolves the same three input forms with none of that.

---

## 3. Data sources

| Source | Licence | Rows | Used for |
|---|---|---|---|
| Census 2020 ZCTA Gazetteer | Public domain | 33,144 | ZIP centroids (authoritative) |
| GeoNames US postal codes | CC BY 4.0 | 41,490 | City names; centroids for the 8,516 ZIPs with no ZCTA |
| Census Sub-County Population Estimates (2023) | Public domain | — | Population threshold for the city vocabulary |

ZCTAs are built from census blocks and exist only for ZIPs with a delivery area,
so PO-box and point ZIPs — 8,516 of them — have no ZCTA. GeoNames covers those.
The merged table is **41,660 ZIPs**: Census centroids where they exist, GeoNames
elsewhere. 96% of GeoNames US rows carry accuracy code 4 (matched to a real
gazetteer toponym) rather than 1 (estimated), which is more than adequate at the
1.1 km quantisation used below.

GeoNames requires attribution — a link to geonames.org satisfies it. That is a
credit line on the About page and is the only licence obligation the feature
carries; the Census data is public domain and needs none.

**These tables are data-independent.** They are pruned by national population, never
by what is in the roster. An origin vocabulary derived from member locations would
be wrong in principle — a user must be able to type "Los Angeles" whether or not a
brother lives there — and would silently rot as brothers move and 30–50 new ones
arrive each year. This also means the current staging data, which is fictitious,
cannot bias the build.

---

## 4. Measurements

All figures brotli-11, measured on the real files. `raw` is UTF-8 bytes.

**ZIP → centroid, 41,660 rows, coordinates at 2 decimal places (~1.1 km):**

| Encoding | raw | gzip-9 | brotli-11 |
|---|---|---|---|
| Flat CSV | 780.7 KB | 239.2 KB | **143.8 KB** |
| Delta-encoded CSV | 339.4 KB | 113.2 KB | **104.2 KB** |

**City vocabulary, by population threshold:**

| Threshold | Cities | raw | gzip-9 | brotli-11 |
|---|---|---|---|---|
| ≥ 100,000 | 327 | 8.3 KB | 4.0 KB | 3.1 KB |
| ≥ 50,000 | 796 | 20.3 KB | 8.7 KB | 7.0 KB |
| ≥ 25,000 | 1,610 | 41.1 KB | 16.6 KB | **13.6 KB** |
| ≥ 10,000 | 3,281 | 83.3 KB | 32.1 KB | **26.4 KB** |
| ≥ 5,000 | 4,996 | 126.2 KB | 48.0 KB | 39.5 KB |

Two findings worth recording.

**Brotli-11 and hand-rolled delta encoding are substitutes, not complements.**
Brotli beats gzip by ~40% on plain CSV (239 → 144 KB) but by only ~7% on
delta-encoded data (113 → 104 KB), because the delta encoding has already removed
the redundancy brotli would have exploited. The clever encoding therefore buys
39 KB, not the large win it appears to promise against gzip. This is the direct
answer to "should we use brotli-11 here": yes, and *because* we do, the
complicated encoding is largely redundant.

**The population join is a trap.** Joining populations by Census place code
silently drops New England towns — Brookline, Lexington, Arlington and Belmont all
vanished — because town-organised states record towns as county subdivisions
(SUMLEV 061) rather than places (162), while the gazetteer lists them as CDPs.
Since New England holds a large share of the membership, that failure would have
gutted the feature in its most important region while looking fine everywhere
else. The join must key on (state, normalised name) across SUMLEV 162, 157 **and**
061, and the build must assert a spot-check list of known towns or the same bug
returns silently. Sunol CA (unincorporated) and Chevy Chase MD (pop. 2,866) remain
absent at any sane threshold — which is exactly why ZIP entry stays as the fallback.

---

## 5. Architecture

**Client-side, consistent with everything else.** All search, filter and sort in
Book is client-side today; a server-side proximity endpoint would be an
architectural outlier, and the UX target — proximity composing instantly with the
existing filter chain — depends on it being just another predicate over the
in-memory roster. It also means the typed location never leaves the browser, which
disposes of the privacy question a geocoding API would have raised.

**Lazy-loaded, never bundled.** This is not optional: `scripts/check-bundle-size.mjs`
(D74) sums brotli over `apps/web/dist/assets/*.js` against a 270 KB ceiling, and the
build currently sits near 256 KB. Importing a gazetteer as a module would fail the
gate outright. The tables must be separately-fetched static assets, fetched on
first interaction with the "Near" control — not on Directory mount. The Directory's
first paint gains **zero bytes**; only a brother who actually uses proximity search
pays, once, against an immutable cache.

**Two files, both static:**

- `zips.csv` — `zip,lat,lon` at 2 dp, 41,660 rows.
- `cities.csv` — `city,ST,lat,lon` at 2 dp, population-pruned.

Both are generated by a checked-in build script from the sources in §3 and
committed as build outputs, so the app has no runtime dependency on Census or
GeoNames and the tables change only when someone deliberately regenerates them.

**Serving and compression.** Firebase Hosting compresses static responses itself,
so the simple path is to ship plain `.csv` and let it. If measurement shows
Hosting's brotli is materially worse than q11, the escape hatch is to ship a
precompressed `zips.csv.br` and set `Content-Encoding: br` via `firebase.json`
headers — full control, at the cost of no identity fallback (acceptable; brotli
has been universal in browsers since ~2016, but it is a real if small edge-case
risk for the oldest devices). Recommend starting simple and measuring; this is a
build-time measurable, not a design fork.

**The algorithm is deliberately dull.** Resolve the origin to a centroid, then
haversine from it to each roster member's centroid and keep those inside the
radius. Roughly 1,200 records against one origin is sub-millisecond; there is no
index, no k-d tree, no bounding-box prefilter, and none is warranted. Distance is
computed but not displayed — showing "18.4 miles" would promise a precision
centroid-to-centroid arithmetic does not have.

---

## 6. Locating members

Proximity needs a coordinate for each brother. Three ways to get one:

**(a) Client-side, from the member's ZIP.** The roster already carries
`address.postalCode`; the client looks it up in `zips.csv`. No server change of
any kind. Costs 143.8 KB, but that same table is needed anyway to resolve a
user-typed origin ZIP, so it is not an incremental cost. **This is the recommended
option.**

**(b) Client-side, from the member's city/state.** Avoids the ZIP table but needs
the *unpruned* 29,547-city vocabulary (220.4 KB) to resolve members in small
towns — strictly worse than (a), and it fails for exactly the small-town brothers
the pruning excludes.

**(c) Server-side, embedding a coarse centroid per record in the projection.**
The API already precompresses the profile payload at brotli-11 and rebuilds it on
every write (`apps/api/src/data/cache.ts`), so the trigger and the machinery exist.

This is the refined form of the "let the server prune the gazetteer" proposal, and
it is worth being precise about why the simpler version of that idea does not work:
**pruning the ZIP table to member-occupied ZIPs breaks free ZIP entry.** Roughly
650 ZIPs are occupied out of 41,660 — so a roster-pruned table cannot resolve about
98% of the ZIPs a user might type. Any design that prunes by roster membership must
therefore drop free ZIP entry.

That is what closes the fork. §8 shows free ZIP entry is **load-bearing**: at the
chosen city threshold roughly a quarter of brothers cannot find their own town by
name, and ZIP is their only route in. The client must therefore carry the full ZIP
table whatever the server does — and once it does, member resolution is free, since
100% of records resolve against it. **Option (c) would add a projection change —
Gate 4's data-shape class, needing explicit approval and deeper review — and save
essentially nothing.** It remains the right optimisation if the payload ever proves
to matter, and OFC-151 will want per-member coordinates anyway.

**Recommended total: ~170 KB** (143.8 ZIP + 26.4 cities at pop ≥ 10,000), lazy,
once per user. For scale, the entire JS bundle is ~256 KB.

---

## 7. The "Near" control

A single text input labelled **Near**, on the Directory page beside the existing
filters, with typeahead over a controlled vocabulary. The dropdown mixes three
result kinds, each labelled: **cities** ("Brookline, MA"), **ZIPs** ("02445 —
Brookline, MA"), and **brothers** (by name, resolving to that brother's own
location). One box, no mode switch, no parsing of free text.

Typeahead is doing more work than it appears to. It removes dead ends — the user
can only choose something that resolves — which is the answer to the small-town
coverage gap, since a user in an unlisted town sees no match for it and picks his
ZIP or the nearby city instead of typing something that silently fails. It also
disposes of ambiguity by display rather than by error handling: "Portland, OR" and
"Portland, ME" are simply two rows. There is no validation state, no error copy,
and no "location not found" path to design.

**Radius** is a selector — 25 / 50 / 100 miles — defaulting to 50. A fixed radius
was considered and rejected: 50 miles is one metro in Los Angeles and three states
in New England, and the variance is large enough to matter for the mentor-search
case.

The active filter appears as a chip alongside the others ("Near: Brookline, MA ·
50 mi"), clearable the same way, and participates in the existing URL-state
serialisation so a proximity-filtered Directory is linkable and survives
navigation.

**Accessibility** is a hard requirement, and a typeahead is one of the easier
things to get wrong: the combobox pattern needs correct `aria-expanded` /
`aria-activedescendant` wiring, full keyboard operation, a live-region
announcement of result counts, and a visible focus ring — the same bar the
existing `Combobox.tsx` already meets, which is the component to build on rather
than around.

---

## 8. Coverage, measured against real data

Measured against the MITAA extract of living US brothers (the source records, held
outside this repo; only rounded aggregates appear here).

**ZIP resolution is total.** Every record carries a ZIP, and **100%** of them
resolve to a centroid in the merged table — zero unresolved. Roughly 650 distinct
ZIPs across roughly 780 brothers, so the membership is geographically dispersed,
averaging little more than one brother per ZIP. Of those distinct ZIPs, only about
seven fall outside the Census ZCTA set and need the GeoNames gap-fill; the gap-fill
earns its place less for today's roster than as insurance for the PO-box and point
ZIPs that new brothers will arrive with.

**Two normalisation requirements fall straight out of the data**, and both would
break a naive exact-match lookup:

- About **59%** of ZIPs are in ZIP+4 form (`02139-4307`, to borrow the existing
  validation-test fixture). They must be truncated to five digits before lookup.
- Some values carry **trailing whitespace** (`"02139   "`). They must be trimmed.

Together these affect a clear majority of records — a lookup that skips either step
would fail for most of the roster while appearing to work on hand-picked examples.

**ZIP is the more trustworthy field; the written city is not.** About **7%** of the
distinct city names members have written match no city in the reference data at
all, and about **6%** of records name a city that disagrees with the city implied
by their own ZIP. Most disagreements are benign — USPS abbreviations ("Wellesley
Hls", "Yorktown Hts"), neighbourhood names standing in for their municipality (Hyde
Park for Boston), or postal station names (Needham Heights, Princeton Junction) —
but a few are genuine errors, including at least one record whose city and ZIP name
different towns and one misspelled city. This is decisive evidence for locating
members by **ZIP rather than by city**, and it has a UAT consequence worth
recording: the Directory displays the city as written, so a brother whose city and
ZIP disagree will appear in a search near the *ZIP's* town while displaying the
other name. That is expected behaviour, not a bug.

**The feature returns useful result sets.** Approximate counts within each radius:

| Origin | 25 mi | 50 mi | 100 mi |
|---|---|---|---|
| Boston / Cambridge | ~90 | ~100 | ~120 |
| New York | ~75 | ~105 | ~135 |
| San Francisco / Mountain View | ~50 | ~90 | ~95 |
| Los Angeles | ~30 | ~45 | ~50 |
| Washington DC | ~30 | ~40 | ~50 |
| Chicago / Seattle | ~20 | ~25 | ~30 |

These validate the radius selector rather than a fixed radius: around Boston the
25→50 mile step adds only about ten brothers because the cluster is tight, while
around San Francisco it nearly doubles the result set by reaching the South Bay —
the "50 miles is one metro in California and three states in New England" problem,
visible in the real numbers.

**The origin vocabulary is the weak point, and ZIP entry is what covers it.** At a
population threshold of 10,000, the city list contains the towns of only about
**76%** of brothers (64% at 25,000; 81% at 5,000). That figure understates true
usability — many "misses" are postal station names whose real municipality *is* in
the list, so a brother in Needham Heights finds Needham — but it establishes that a
meaningful minority cannot find their own town by name. **Free ZIP entry is
therefore load-bearing, not a convenience**, and any design that removes it (see
§6) fails a substantial share of the membership.

**`shareAddress`** remains the outer bound: address is a single toggle field
(`FIELD_VISIBILITY`), so a brother who hides it is omitted from the projection and
invisible to proximity search. This is **not a new gap** — the same brothers are
already invisible to the existing city/state/country filters — and the default is
share-on (`defaults.ts`). Note also that the MITAA extract reflects MITAA's own
privacy toggles, so some brothers are absent from it for reasons unrelated to
Book's.

**Territories work — for locating members.** A small number of brothers are in
Puerto Rico; PR ZIPs are present in the ZCTA data and resolve normally, and
`US_SUBDIVISIONS` already carries PR and the other territory codes. *Amended by
the build (D177): the GeoNames US postal export covers the 50 states and DC
only, so territories contribute no city names to the **origin vocabulary**.
Members there are located correctly; a user cannot type "San Juan, PR" as an
origin and must use a ZIP. Free ZIP entry, already load-bearing for the reasons
above, is the backstop here too.*

**Privacy.** Proximity search is a new *affordance* over data the client already
holds, not new exposure: the roster payload already carries every visible address,
so anyone technical could already cluster it. Worth stating plainly rather than
discovering later.

**Non-US brothers** are excluded from proximity results by definition, with the
existing country filter as the substitute and the feature described as US-only for
now. At a 100 mile maximum radius no cross-border leakage occurs except at the
Canadian and Mexican borders, where a handful of results is a feature rather than
a bug.

---

## 9. Decisions

| # | Decision | Outcome | Rationale |
|---|---|---|---|
| 1 | Member location source | **Client-side, from the member's ZIP** | Simplicity, and every brother with an address has a ZIP; no server or projection change |
| 2 | ZIP table encoding | **Flat CSV** (143.8 KB) | Brotli already captured most of the win; 39 KB does not justify an opaque format and a decoder to test |
| 3 | City population threshold | **≥ 10,000** (26.4 KB, 3,281 cities) | 13 KB more than ≥25,000 and buys 1,671 towns, including the suburbs brothers actually live in |
| 4 | Radius options | **Selector 25 / 50 / 100 mi**, default 50 | Metro scale varies too much for a fixed radius; §8's measurements bear this out |
| 5 | Distance display | **Omit** | Centroid arithmetic cannot honour a displayed figure |

All five are settled (Forrest's call). Decision 1 was initially open between the
client-side lookup and a server-side embedded centroid; the §8 measurements closed
it, because free ZIP entry proved load-bearing, which forces the full ZIP table
onto the client regardless and makes member resolution free once it is there. The
server-side option would have bought a projection change for no meaningful byte
saving. It remains the right optimisation later, and OFC-151 will want per-member
coordinates anyway.

---

## 10. Build sequence

Coarse, and to be turned into a coding plan once the decisions above are settled.

1. **Data build script** (`tools/`), checked in: fetch/verify the three sources,
   merge, prune, emit `zips.csv` and `cities.csv`, and **assert a spot-check list
   of known towns** so the §4 join trap cannot return silently. Emit a provenance
   header (source, vintage, row count).
2. **Resolver module** in `packages/shared`: **normalise the member ZIP** (trim,
   then truncate ZIP+4 to five digits — §8 shows both are required for a majority
   of records), parse the tables, haversine, radius filter. Pure functions, fully
   unit-testable, no React. This is where the tests concentrate — including the
   Bay Area and St. Louis cases from §2 as regression guards against anyone
   reintroducing prefix logic, and ZIP+4/whitespace/absent/non-US inputs as the
   normalisation guards.
3. **Lazy loader**: fetch on first focus of the Near control, with an explicit
   loading state (170 KB is a real pause on a slow link), an error path that
   degrades to the feature being unavailable rather than the Directory breaking,
   and no refetch once cached.
4. **The Near control**: typeahead over the merged vocabulary, built on the
   existing `Combobox`, wired into the filter chain, chip, and URL state.
5. **Docs and log**: append the decisions to `DECISIONS.md`, update
   `DECISIONS-INDEX.md`, add the About-page GeoNames attribution, and update
   `USER-MANUAL.md` — in the same PR as the code.

**Testing** is unit tests on the resolver, an integration test that proximity
composes correctly with other filters, an axe pass on the combobox, and a
bundle-size check confirming the tables did not land in the JS bundle. A CI
assertion that `dist/assets/*.js` has not absorbed the tables is worth adding,
since that is the failure mode that silently blows D74.

**Schedule.** UAT closes 13 Aug and the blackout runs 14–27 Aug, so the build
lands in the ~3 weeks before the 19 Sept launch and will not get ordinary UAT
coverage. The vocabulary — whether the city list contains what brothers actually
type — is the part testing by anyone close to the code will not validate, so
getting even two testers onto it in early September is worth more than any
additional unit test.

---

## 11. Build sessions

**Two sessions, not one.** This does not fit comfortably in a single sitting, and
the reason is context shape rather than raw volume.

The two halves need almost disjoint context. The data-and-resolver half needs the
gazetteer formats, the `tools/` build conventions and `packages/shared`, and none
of the Directory. The UI half needs the Directory surface — roughly 2,650 lines
across nine files before their tests — and needs the resolver only as a handful of
function signatures. Carrying both into one context means the riskiest work, the
accessible combobox and the filter/URL composition, lands *last*, when context is
most degraded and attention thinnest. That is precisely the wrong ordering for the
part most likely to go wrong.

There is also a natural verification boundary. Session A is provable by unit tests
with no browser and no staging; session B is what gets live-tested under Gate 5.
And two PRs earn two code-review rounds at full depth, rather than one oversized
diff across data, pure logic, and UI that dilutes reviewer attention across three
unrelated kinds of risk.

### Session A — data pipeline and resolver — **built 2026-08-11**

No UI, no user-visible change.

*As built, the pipeline produced 41,151 ZIP centroids and 3,590 origin cities
(147.7 + 29.0 KB brotli, against the 143.8 + 26.4 projected in §4), and the
tables ship under content-hashed filenames so they can be served immutably.
**D177** records the two decisions taken during the build and the two coverage
limits the real data revealed; **N172** records the traps; `tools/geo-data/README.md`
is the operator's page. The resolver's API — what session B consumes — is
`packages/shared/src/proximity.ts`.*

- **Scope:** the build script with its source-verification and town spot-check
  assertions (§4's join trap); the generated `zips.csv` and `cities.csv`; the
  resolver module — ZIP normalisation, table parsing, haversine, radius filter —
  with its unit tests; `DECISIONS.md` entries for the data-source and encoding
  decisions plus the `DECISIONS-INDEX.md` update.
- **Context to prime:** §3, §4 and §8 of this document; `tools/` conventions;
  `packages/shared` conventions, where `geo.ts` is the closest existing analogue.
- **Exit:** PR merged, tables committed, resolver exported behind a documented API.
- **Review depth:** deep — new subsystem.

### Session B — Near control and Directory integration

- **Scope:** the lazy loader, modelled on `useRoster.ts`'s module-level store
  pattern; the Near typeahead built on the existing `Combobox`; the radius
  selector; wiring into `filters.ts`, `useDirectoryFilters.ts`, `Chips.tsx` and
  `query.ts`; integration and axe tests; `USER-MANUAL.md`; the About-page
  attribution; `DECISIONS.md` entries for the UI decisions.
- **Context to prime:** the Directory surface plus §5–§7 here. The resolver arrives
  as a small documented API, not as code to re-read.
- **Exit:** PR merged, staging deployed, live-tested.
- **Review depth:** deep — new user-facing surface with a CI-gated accessibility
  requirement.

### Ordering, tripwire, and effort

**Ordering is strictly A then B.** There is no useful parallelism: the surfaces are
disjoint but B consumes A's output, and the tables must exist before the control
can be exercised.

**Tripwire for a third session.** If B's scope grows — the combobox needing more
accessibility work than the existing component provides, `nuqs` URL-state
complications, or the vocabulary proving inadequate once someone real tries it —
split the radius selector and the documentation into a session C rather than
pushing through on degraded context. Splitting mid-session is the intended
response, not a failure.

**Model and effort:** Opus-class at high for both. Neither session touches auth,
the visibility projection, or concurrency, so max effort is not warranted; but B's
accessibility work is CI-gated, so it should not drop below high either.

**Scheduling.** Session A is independent, low-risk and invisible to users, so it
can run immediately and land before the 14–27 Aug blackout. Session B is the half
that wants tester exposure, so it is better placed to land early enough in
September for testers to exercise the vocabulary — which §8 and §12 both identify
as the thing no amount of internal testing will validate.

**Tracker.** Both sessions run against the single ticket **OFC-378**, carrying one
session label each in turn (Forrest's call). Each session closes with its own
evidence comment on that ticket rather than closing a ticket of its own; the ticket
itself closes when session B is live-confirmed.

---

## 12. Risks

**The join trap (§4)** is the highest-severity item: it fails silently, in the
region with the most brothers, and looks correct everywhere else. The build-time
spot-check assertion is the mitigation and is not optional.

**Vocabulary coverage** is the most likely source of user complaints, and §8 now
puts a number on it: at a 10,000 threshold the city list holds the towns of only
about three-quarters of brothers. Typeahead softens this by never presenting a
dead end, and ZIP entry backstops it — but a brother who types his town, does not
see it, and does not think to try his ZIP will conclude the feature is broken. The
control's placeholder and empty-state copy are therefore load-bearing, and the
first real signal will come from testers rather than from us. Raising the
threshold to 5,000 buys about five more points of coverage for about 13 KB, and
remains available if testers say the gap bites.

**Payload on slow links.** 170 KB is a multi-second stall on the slowest
connections in the membership. It is off the critical path and paid once, but the
loading state has to be honest rather than a spinner that looks like a hang.

**Scope creep toward the map.** OFC-151 wants per-member coordinates and will be
tempting to "just add" here. It is a separate feature with its own tile provider,
key, client payload and — because plotting the whole membership at once is a
different kind of exposure than looking one brother up — its own privacy analysis.
It stays post-launch.

---

## 13. Follow-ups to file if this is approved

- **A general OSS acknowledgements list**, in the repo and in the app. Wanted
  independently of this feature, and it is where the GeoNames credit belongs
  long-term. Session B creates a minimal acknowledgements section carrying the
  GeoNames and Census entries so the CC BY obligation is met on delivery; filling
  it out across every dependency is separate work and should not be absorbed into
  this feature's scope.
- International proximity (deferred; country filter is the stated substitute).
- "Near me" via browser geolocation.
- Per-result distance display, if the precision caveat is ever resolved.
- Regenerating the tables when the Census publishes a new vintage.
- Server-embedded per-member centroids, if the client payload ever proves to
  matter — and as groundwork for OFC-151, which needs them anyway.
