import { describe, expect, it } from "vitest";

import { parseGazetteer, parseGeoNames, parseSubEst, splitCsvLine } from "./sources.js";

describe("parseGazetteer", () => {
  // The real file pads every field with trailing spaces, header included — the
  // single most likely thing to break a naive parser.
  const PADDED = [
    "GEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG                ",
    "00601\t166659744\t799292\t64.348\t0.309\t18.180555\t-66.749961               ",
    "02139\t4126402\t172946\t1.593\t0.067\t42.363152\t-71.101661                  ",
  ].join("\n");

  it("reads padded tab-separated rows", () => {
    const { rows, skipped } = parseGazetteer(PADDED);
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      { zcta: "00601", lat: 18.180555, lon: -66.749961 },
      { zcta: "02139", lat: 42.363152, lon: -71.101661 },
    ]);
  });

  it("finds its columns by name, not position", () => {
    const reordered = ["INTPTLONG\tGEOID\tINTPTLAT", "-71.1\t02139\t42.36"].join("\n");
    expect(parseGazetteer(reordered).rows).toEqual([{ zcta: "02139", lat: 42.36, lon: -71.1 }]);
  });

  it("throws when the expected columns are absent", () => {
    expect(() => parseGazetteer("A\tB\n1\t2")).toThrow(/expected GEOID/);
  });

  it("skips rows with a malformed ZCTA or unparseable coordinates", () => {
    const { rows, skipped } = parseGazetteer(
      [
        "GEOID\tINTPTLAT\tINTPTLONG",
        "0219\t42.3\t-71.1",
        "02139\t\t-71.1",
        "02141\t42.4\t-71.1",
      ].join("\n"),
    );
    expect(rows.map((row) => row.zcta)).toEqual(["02141"]);
    expect(skipped).toBe(2);
  });

  // An empty coordinate must not become 0 — `Number("")` is 0, and 0,0 is a
  // point in the Gulf of Guinea that would silently relocate a brother.
  it("never coerces a blank coordinate to zero", () => {
    const { rows } = parseGazetteer(["GEOID\tINTPTLAT\tINTPTLONG", "02139\t\t"].join("\n"));
    expect(rows).toEqual([]);
  });
});

describe("parseGeoNames", () => {
  const US_TXT = [
    "US\t02445\tBrookline\tMassachusetts\tMA\tNorfolk\t021\t\t\t42.3259\t-71.1341\t4",
    "US\t99553\tAkutan\tAlaska\tAK\tAleutians East\t013\t\t\t54.143\t-165.7854\t1",
    // A military ZIP: no state code, coordinates in Italy.
    "US\t09001\tAPO AA\t\t\t\t\t\t\t38.1105\t15.6613\t",
    "CA\tM5V\tToronto\tOntario\tON\t\t\t\t\t43.6\t-79.4\t6",
  ].join("\n");

  it("reads the documented column order", () => {
    const { rows } = parseGeoNames(US_TXT);
    expect(rows[0]).toEqual({
      zip: "02445",
      place: "Brookline",
      stateCode: "MA",
      stateName: "Massachusetts",
      lat: 42.3259,
      lon: -71.1341,
    });
  });

  it("skips military ZIPs (no state code) and any non-US row", () => {
    const { rows, skipped } = parseGeoNames(US_TXT);
    expect(rows.map((row) => row.zip)).toEqual(["02445", "99553"]);
    expect(skipped).toBe(2);
  });
});

describe("splitCsvLine", () => {
  it("splits plain fields", () => {
    expect(splitCsvLine("162,25,Boston city,Massachusetts,650706")).toEqual([
      "162",
      "25",
      "Boston city",
      "Massachusetts",
      "650706",
    ]);
  });

  it("keeps a comma inside quotes with the field it belongs to", () => {
    expect(splitCsvLine('061,25,"Winchester town, city of",Massachusetts,22799')).toEqual([
      "061",
      "25",
      "Winchester town, city of",
      "Massachusetts",
      "22799",
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(splitCsvLine('a,"say ""hi""",b')).toEqual(["a", 'say "hi"', "b"]);
  });

  it("preserves trailing empty fields", () => {
    expect(splitCsvLine("a,,")).toEqual(["a", "", ""]);
  });
});

describe("parseSubEst", () => {
  const SUB_EST = [
    "SUMLEV,STATE,COUNTY,PLACE,COUSUB,CONCIT,PRIMGEO_FLAG,FUNCSTAT,NAME,STNAME,ESTIMATESBASE2020,POPESTIMATE2024",
    "061,25,021,00000,09175,00000,1,A,Brookline town,Massachusetts,63165,63925",
    "162,06,000,39003,00000,00000,0,A,La Cañada Flintridge city,California,20074,19875",
  ].join("\n");

  it("reads the named population column", () => {
    const { rows } = parseSubEst(SUB_EST, "POPESTIMATE2024");
    expect(rows).toEqual([
      { sumlev: "061", stateName: "Massachusetts", name: "Brookline town", population: 63925 },
      {
        sumlev: "162",
        stateName: "California",
        name: "La Cañada Flintridge city",
        population: 19875,
      },
    ]);
  });

  it("throws when the requested vintage is not in the file", () => {
    expect(() => parseSubEst(SUB_EST, "POPESTIMATE2099")).toThrow(/POPESTIMATE2099/);
  });

  it("skips a row whose population does not parse", () => {
    const broken = [
      "SUMLEV,NAME,STNAME,POPESTIMATE2024",
      "061,Brookline town,Massachusetts,",
      "061,Belmont town,Massachusetts,27295",
    ].join("\n");
    const { rows, skipped } = parseSubEst(broken, "POPESTIMATE2024");
    expect(rows.map((row) => row.name)).toEqual(["Belmont town"]);
    expect(skipped).toBe(1);
  });
});
