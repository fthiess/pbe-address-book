import { describe, expect, it } from "vitest";

import {
  GeoTablesError,
  checkTables,
  contentHash,
  countDataRows,
  findTableImports,
  hashFromFilename,
  parseManifest,
  tableFilename,
} from "./geo-tables.js";

const ZIPS_CSV = [
  "# generated",
  "# rows: 2",
  "zip,lat,lon",
  "02139,42.36,-71.1",
  "94041,37.39,-122.08",
  "",
].join("\n");
const CITIES_CSV = ["# generated", "city,state,lat,lon", "Brookline,MA,42.34,-71.13", ""].join(
  "\n",
);

const ZIPS_NAME = `zips.${contentHash(ZIPS_CSV)}.csv`;
const CITIES_NAME = `cities.${contentHash(CITIES_CSV)}.csv`;

const manifestSource = (zips: string, cities: string, zipRows = 2, cityRows = 1) => `
export const GEO_TABLES: { readonly zips: GeoTable; readonly cities: GeoTable } = {
  zips: { url: "/geo/${zips}", rows: ${zipRows} },
  cities: { url: "/geo/${cities}", rows: ${cityRows} },
};
`;

const healthy = () => ({
  manifest: parseManifest(manifestSource(ZIPS_NAME, CITIES_NAME)),
  present: new Map([
    [ZIPS_NAME, ZIPS_CSV],
    [CITIES_NAME, CITIES_CSV],
  ]),
  sources: [
    { path: "apps/web/src/pages/directory/Near.tsx", text: 'import { GEO_TABLES } from "…";' },
  ],
});

describe("parseManifest", () => {
  it("reads both entries", () => {
    expect(parseManifest(manifestSource("zips.aaaaaaaa.csv", "cities.bbbbbbbb.csv"))).toEqual({
      zips: { url: "/geo/zips.aaaaaaaa.csv", rows: 2 },
      cities: { url: "/geo/cities.bbbbbbbb.csv", rows: 1 },
    });
  });

  it("reports a manifest it cannot read", () => {
    expect(() => parseManifest("export const GEO_TABLES = {};")).toThrow(GeoTablesError);
  });
});

describe("filename helpers", () => {
  it("extracts the served filename", () => {
    expect(tableFilename("/geo/zips.aaaaaaaa.csv")).toBe("zips.aaaaaaaa.csv");
    expect(tableFilename("/assets/zips.csv")).toBeUndefined();
    expect(tableFilename("/geo/nested/zips.csv")).toBeUndefined();
  });

  it("extracts the content hash", () => {
    expect(hashFromFilename("zips.0123abcd.csv")).toBe("0123abcd");
    expect(hashFromFilename("zips.csv")).toBeUndefined();
    expect(hashFromFilename("zips.SHOUTING.csv")).toBeUndefined();
  });
});

describe("countDataRows", () => {
  it("counts data rows only", () => {
    expect(countDataRows(ZIPS_CSV)).toBe(2);
    expect(countDataRows(CITIES_CSV)).toBe(1);
    expect(countDataRows("# only a comment\nzip,lat,lon\n")).toBe(0);
  });
});

describe("findTableImports", () => {
  it("flags every way a table could be pulled into a chunk", () => {
    const flagged = findTableImports([
      { path: "a.ts", text: 'import zips from "../public/geo/zips.aaaaaaaa.csv?raw";' },
      { path: "b.ts", text: 'const url = await import("./zips.csv?url");' },
      { path: "c.ts", text: 'const t = require("./cities.csv");' },
      // The bare side-effect form: no `from`, no parenthesis. A pattern
      // anchored on `from` misses it, and Vite would still bundle it.
      { path: "d.ts", text: 'import "../public/geo/zips.aaaaaaaa.csv";' },
      { path: "e.ts", text: 'const url = "/geo/zips.aaaaaaaa.csv"; await fetch(url);' },
      { path: "f.ts", text: 'import { GEO_TABLES } from "./generated/geoTables.js";' },
    ]);
    expect(flagged).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });

  // The whole point of the feature is that the table is *fetched*; a string
  // literal naming it must stay legal or the guard would forbid using it.
  it("does not flag a fetch of the same path", () => {
    expect(
      findTableImports([{ path: "g.ts", text: 'await fetch("/geo/zips.aaaaaaaa.csv");' }]),
    ).toEqual([]);
    expect(
      findTableImports([
        { path: "h.ts", text: 'const url = new URL("/geo/cities.bbbbbbbb.csv", origin);' },
      ]),
    ).toEqual([]);
  });
});

describe("checkTables", () => {
  it("passes when everything agrees", () => {
    expect(checkTables(healthy())).toEqual([]);
  });

  it("catches a hand-edited table", () => {
    const input = healthy();
    const edited = new Map(input.present);
    edited.set(ZIPS_NAME, `${ZIPS_CSV}99999,1,2\n`);
    const problems = checkTables({ ...input, present: edited });
    expect(problems.some((problem) => problem.includes("has been edited"))).toBe(true);
  });

  it("catches a manifest naming a file that is not there", () => {
    const input = healthy();
    const missing = new Map(input.present);
    missing.delete(CITIES_NAME);
    expect(
      checkTables({ ...input, present: missing }).some((problem) =>
        problem.includes("not in the served directory"),
      ),
    ).toBe(true);
  });

  it("catches a stale table left behind by an earlier build", () => {
    const input = healthy();
    const withStale = new Map(input.present);
    withStale.set("zips.deadbeef.csv", "# an older build\nzip,lat,lon\n");
    expect(
      checkTables({ ...input, present: withStale }).some((problem) =>
        problem.includes("stale table"),
      ),
    ).toBe(true);
  });

  it("catches a row count that has drifted", () => {
    const input = healthy();
    const manifest = parseManifest(manifestSource(ZIPS_NAME, CITIES_NAME, 41_151));
    expect(
      checkTables({ ...input, manifest }).some((problem) => problem.includes("claims 41151 rows")),
    ).toBe(true);
  });

  it("catches a table imported as a module", () => {
    const input = healthy();
    const problems = checkTables({
      ...input,
      sources: [{ path: "apps/web/src/x.ts", text: 'import z from "./zips.aaaaaaaa.csv?raw";' }],
    });
    expect(problems.some((problem) => problem.includes("imports a .csv as a module"))).toBe(true);
  });

  it("catches an unhashed filename", () => {
    const plain = "zips.csv";
    expect(
      checkTables({
        manifest: parseManifest(manifestSource(plain, CITIES_NAME)),
        present: new Map([
          [plain, ZIPS_CSV],
          [CITIES_NAME, CITIES_CSV],
        ]),
        sources: [],
      }).some((problem) => problem.includes("does not carry a content hash")),
    ).toBe(true);
  });
});
