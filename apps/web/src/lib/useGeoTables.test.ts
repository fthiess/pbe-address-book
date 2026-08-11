import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GEO_TABLES } from "../generated/geoTables.js";
import { __getGeoTablesState, __resetGeoTables, loadGeoTables } from "./useGeoTables.js";

/**
 * The lazy proximity-table store (OFC-378 session B). Exercised through the
 * module functions rather than through React, like `useRoster.test.ts` — unit
 * tests run under the node environment, and the store is deliberately a plain
 * module singleton so this is the whole surface.
 */

/**
 * A table body, exactly as the generator writes one: a `#` provenance block
 * carrying the row count, a column header, then the rows.
 *
 * `declared` defaults to the real number of rows; passing a larger one is how a
 * **truncated download** is simulated — the header arrives, the tail does not.
 */
function zipTable(count: number, declared = count): string {
  const rows = Array.from({ length: count }, (_, i) => {
    const zip = String(i).padStart(5, "0");
    return `${zip},42.3${i % 10},-71.1${i % 10}`;
  });
  return ["# generated", `# rows: ${declared}`, "zip,lat,lon", ...rows].join("\n");
}

function cityTable(count: number, declared = count): string {
  const rows = Array.from({ length: count }, (_, i) => `Town ${i},MA,42.3,-71.1`);
  return ["# generated", `# rows: ${declared}`, "city,state,lat,lon", ...rows].join("\n");
}

/** A healthy, self-consistent pair at the URLs the generated manifest names. */
function fullTables(): Map<string, string> {
  return new Map([
    [GEO_TABLES.zips.url, zipTable(8)],
    [GEO_TABLES.cities.url, cityTable(4)],
  ]);
}

/** Install a fetch that serves `bodies`; returns the spy for call counting. */
function serve(bodies: ReadonlyMap<string, string>, status = 200) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const body = bodies.get(url);
    return {
      ok: body !== undefined && status === 200,
      status: body === undefined ? 404 : status,
      text: async () => body ?? "",
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Let the store's promise chain settle; it is microtask-only. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  __resetGeoTables();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadGeoTables", () => {
  it("starts idle and fetches nothing until something asks", () => {
    const fetchMock = serve(fullTables());
    expect(__getGeoTablesState().status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads both tables and exposes them parsed", async () => {
    serve(fullTables());
    loadGeoTables();
    expect(__getGeoTablesState().status).toBe("loading");

    await settle();

    const state = __getGeoTablesState();
    expect(state.status).toBe("ready");
    expect(state.centroids?.size).toBe(8);
    expect(state.cities).toHaveLength(4);
    expect(state.centroids?.get("00001")).toEqual({ lat: 42.31, lon: -71.11 });
  });

  it("dedupes concurrent triggers — the panel opening and the control focusing", async () => {
    const fetchMock = serve(fullTables());
    loadGeoTables();
    loadGeoTables();
    loadGeoTables();
    await settle();
    // Two calls total: one per table, not one per trigger.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never refetches once loaded — the files are immutable by construction", async () => {
    const fetchMock = serve(fullTables());
    loadGeoTables();
    await settle();
    loadGeoTables();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a SHORT table as a failure, not as a smaller table", async () => {
    // The failure this check exists for: `parseZipTable` skips malformed rows by
    // design, so a truncated response parses cleanly into a table that is simply
    // missing its tail. Proximity narrows, so the result would look plausible and
    // silently omit every brother whose ZIP was in the missing part.
    serve(
      new Map([
        // Declares 8 rows, carries 7 — the header survived, the tail did not.
        [GEO_TABLES.zips.url, zipTable(7, 8)],
        [GEO_TABLES.cities.url, cityTable(4)],
      ]),
    );
    loadGeoTables();
    await settle();

    const state = __getGeoTablesState();
    expect(state.status).toBe("error");
    expect(state.centroids).toBeNull();
  });

  it("catches a short CITY table too, not only the big one", async () => {
    serve(
      new Map([
        [GEO_TABLES.zips.url, zipTable(8)],
        [GEO_TABLES.cities.url, cityTable(3, 4)],
      ]),
    );
    loadGeoTables();
    await settle();
    expect(__getGeoTablesState().status).toBe("error");
  });

  it("accepts a table that declares no row count — a format change is the gate's job", async () => {
    // Runtime must not take a working feature down over something a red build
    // would have caught; `assert:geo-tables` fails on a missing declaration.
    serve(
      new Map([
        [GEO_TABLES.zips.url, ["# generated", "zip,lat,lon", "02139,42.36,-71.1", ""].join("\n")],
        [GEO_TABLES.cities.url, cityTable(4)],
      ]),
    );
    loadGeoTables();
    await settle();
    expect(__getGeoTablesState().status).toBe("ready");
  });

  it("fails to 'unavailable' on a non-200, leaving nothing half-loaded", async () => {
    serve(new Map(), 404);
    loadGeoTables();
    await settle();

    const state = __getGeoTablesState();
    expect(state.status).toBe("error");
    expect(state.centroids).toBeNull();
    expect(state.cities).toBeNull();
  });

  it("RETRIES after a failure — a transient blip must not latch for the session", async () => {
    // The lesson `useRoster` learned as OFC-114: latching one failed fetch left
    // the feature dead until a full page reload, on a membership that includes
    // some genuinely slow links.
    serve(new Map(), 404);
    loadGeoTables();
    await settle();
    expect(__getGeoTablesState().status).toBe("error");

    serve(fullTables());
    loadGeoTables();
    await settle();
    expect(__getGeoTablesState().status).toBe("ready");
  });
});
