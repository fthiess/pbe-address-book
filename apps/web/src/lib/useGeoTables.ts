import { type CityOrigin, type ZipCentroids, parseCityTable, parseZipTable } from "@pbe/shared";
import { useSyncExternalStore } from "react";
import { GEO_TABLES } from "../generated/geoTables.js";

/**
 * The proximity tables as a **lazily-fetched module store** (OFC-378 session B;
 * `docs/initial-build/PROXIMITY-SEARCH-DESIGN.md` §5). Modelled on
 * {@link import("./useRoster.js")} — one module-level copy, subscribed to with
 * `useSyncExternalStore`, fetched at most once per tab — because the two solve
 * the same problem: a large payload that several consumers need and none should
 * download twice.
 *
 * The differences from the roster store are all simplifications, and each is a
 * deliberate omission rather than an oversight:
 *
 * - **No epoch fence and no clear.** The roster is ~1 MB of real member PII and
 *   must leave the heap at sign-out (D95/OFC-118). These tables are public
 *   Census and GeoNames data about places, so there is nothing to protect and no
 *   reason to make the next viewer on a shared machine re-download 170 KB.
 * - **No revalidation.** The files are content-hashed and served `immutable`
 *   (D177), so a fetched table is current by construction; a new vintage arrives
 *   as a new filename in a new deploy.
 * - **No credentials.** `/geo/*.csv` is a static Hosting asset outside the
 *   session gate, unlike `/api/*` and `/img/*`.
 *
 * ⚠ **Never `import` the tables.** D74's bundle ceiling sums every chunk in
 * `dist/assets`, and the ZIP table alone exceeds the headroom; the gate's
 * `assert:geo-tables` step fails the build on a `.csv` import. Fetching is not a
 * style choice here.
 *
 * ⚠ **A short table is treated as a failure, not as a smaller table.**
 * `parseZipTable` deliberately skips malformed rows so a partial response
 * degrades rather than throws — the right contract for the parser, and the wrong
 * one for the feature, because a truncated ZIP table does not announce itself: it
 * silently drops the brothers whose ZIPs were in the missing tail, and proximity
 * is a *narrowing* filter, so the answer looks plausible and is simply short.
 *
 * The count checked against is the one **the table itself declares** in its
 * provenance header (`# rows: 41151`), not the manifest's. The two are the same
 * number — `assert:geo-tables` fails the build if the header, the manifest and
 * the actual rows ever disagree — and a self-describing file is the better thing
 * to check against at runtime: the header survives a truncation (it is the first
 * thing on the wire) while the rows do not, and a table remains verifiable
 * without the module that names it, which is what lets an end-to-end test serve
 * a six-row fixture instead of a 41,000-row one. Key uniqueness, which is what
 * makes an exact count meaningful for the ZIP table, is likewise a build-time
 * assertion — a data problem belongs where it is a red build, not where it takes
 * the feature dark for everyone.
 */

export type GeoTablesStatus = "idle" | "loading" | "ready" | "error";

export interface GeoTables {
  readonly status: GeoTablesStatus;
  /** ZIP → centroid, once loaded. */
  readonly centroids: ZipCentroids | null;
  /** The origin city vocabulary, once loaded. */
  readonly cities: readonly CityOrigin[] | null;
}

const EMPTY: GeoTables = { status: "idle", centroids: null, cities: null };

let state: GeoTables = EMPTY;
const listeners = new Set<() => void>();

function setState(next: GeoTables): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): GeoTables {
  return state;
}

async function fetchTable(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  return response.text();
}

/**
 * The row count a generated table declares in its `#` provenance block, or
 * `undefined` if it declares none. Absence is treated as "cannot verify" rather
 * than as a failure: the generator always writes the line, so a table without
 * one is a format change, and a format change is `assert:geo-tables`' business at
 * build time — not a reason to take a working feature down in a browser.
 */
export function declaredRows(text: string): number | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#")) {
      // The provenance block is contiguous and comes first; stop at the header.
      return undefined;
    }
    const match = /^#\s*rows:\s*(\d+)$/.exec(trimmed);
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
}

/** Whether a parsed table holds everything the file said it would. */
function isComplete(text: string, parsed: number): boolean {
  const declared = declaredRows(text);
  return declared === undefined || parsed >= declared;
}

/**
 * Start the fetch if it has not run. Safe to call from several triggers and on
 * every render — it is a no-op while loading and once loaded.
 *
 * A previous **failure** is deliberately retryable: the roster store learned this
 * the hard way (OFC-114), where latching one transient failure — a scale-to-zero
 * cold start, a blip on the genuinely slow links some brothers are on — turned it
 * into a permanent one for the whole session with no recovery short of a reload.
 * Here the next trigger (re-opening the Filter panel, focusing the control) tries
 * again.
 */
export function loadGeoTables(): void {
  if (state.status === "loading" || state.status === "ready") {
    return;
  }
  setState({ status: "loading", centroids: null, cities: null });
  Promise.all([fetchTable(GEO_TABLES.zips.url), fetchTable(GEO_TABLES.cities.url)])
    .then(([zipText, cityText]) => {
      const centroids = parseZipTable(zipText);
      const cities = parseCityTable(cityText);
      if (!isComplete(zipText, centroids.size) || !isComplete(cityText, cities.length)) {
        throw new Error(
          `short table: ${centroids.size}/${declaredRows(zipText)} zips, ${cities.length}/${declaredRows(cityText)} cities`,
        );
      }
      setState({ status: "ready", centroids, cities });
    })
    .catch(() => {
      // Degrade to "proximity is unavailable", never to a broken Directory
      // (design §5): the Near control says so, every other filter is untouched.
      setState({ status: "error", centroids: null, cities: null });
    });
}

export function useGeoTables(): GeoTables {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Reset the module store — for tests, which need a fresh fetch per case. */
export function __resetGeoTables(): void {
  state = EMPTY;
}

/**
 * Read the current store state — for tests only. Unit tests run under the node
 * environment (no React rendering), so they exercise the module functions
 * directly and observe transitions through this getter, exactly as
 * `useRoster.ts`'s tests do.
 */
export function __getGeoTablesState(): GeoTables {
  return state;
}
