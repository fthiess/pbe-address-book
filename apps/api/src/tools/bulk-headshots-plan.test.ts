import { describe, expect, it } from "vitest";
import {
  type ArtifactItem,
  type CurrentPointer,
  PLAN_HEADER,
  type PlanRow,
  parsePlan,
  planPurge,
  planUndo,
  planUploads,
} from "./bulk-headshots-plan.js";

const HEADER = PLAN_HEADER.join(",");

function pointer(version: string | null, token = "t"): CurrentPointer<string> {
  return version === null
    ? { hasHeadshot: false, headshotVersion: null, token }
    : { hasHeadshot: true, headshotVersion: version, token };
}

function row(id: number, expectedVersion: string | null): PlanRow {
  return { id, file: `${id}.png`, expectedVersion, line: 2 };
}

describe("parsePlan", () => {
  it("reads rows, blank expected_version meaning no photo, and skips blank lines", () => {
    const plan = parsePlan(
      `\uFEFF${HEADER}\r\n5247,/x/5247-James-Smyth-1984-c1984.png,\r\n\r\n5248,b.png,gabc123\n`,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toEqual([
      { id: 5247, file: "/x/5247-James-Smyth-1984-c1984.png", expectedVersion: null, line: 2 },
      { id: 5248, file: "b.png", expectedVersion: "gabc123", line: 4 },
    ]);
  });

  it("refuses a wrong header outright", () => {
    expect(parsePlan("id,file,version\n5247,a.png,\n").errors).toEqual([
      `line 1: header must be "${HEADER}"`,
    ]);
  });

  it("reports every bad row: field count, id, duplicate, missing file, bad version", () => {
    const plan = parsePlan(
      [
        HEADER,
        "5247,a.png",
        "abc,a.png,",
        "0,a.png,",
        "5248,a.png,",
        "5248,b.png,",
        "5249,,",
        "5250,c.png,bad/version",
      ].join("\n"),
    );
    expect(plan.errors).toEqual([
      "line 2: expected 3 fields, found 2",
      'line 3: const_id "abc" is not a positive integer',
      'line 4: const_id "0" is not a positive integer',
      "line 6: #5248 appears more than once",
      "line 7: #5249 has no file",
      'line 8: #5250 expected_version "bad/version" is not a valid version',
    ]);
    expect(plan.rows.map((r) => r.id)).toEqual([5248]);
  });
});

describe("planUploads", () => {
  const targets = new Map([
    [5001, "gnew1"],
    [5002, "gnew2"],
    [5003, "gnew3"],
    [5004, "gnew4"],
    [5005, "gnew5"],
    [5006, "gnew6"],
  ]);

  it("uploads only where the profile still shows what the operator saw", () => {
    const decisions = planUploads(
      [
        row(5001, null), // no photo then, none now -> upload
        row(5002, "gold"), // replacing a Book photo that is still there -> upload
        row(5003, null), // brother added his own photo since -> changed
        row(5004, "gold"), // brother replaced his photo since -> changed
        row(5005, "gold"), // already pointing at our photo (re-run) -> already-done
        row(5006, null), // no such profile -> missing
      ],
      targets,
      new Map([
        [5001, pointer(null, "t1")],
        [5002, pointer("gold", "t2")],
        [5003, pointer("gown")],
        [5004, pointer("gother")],
        [5005, pointer("gnew5")],
      ]),
    );
    expect(decisions.map((d) => d.kind)).toEqual([
      "upload",
      "upload",
      "changed",
      "changed",
      "already-done",
      "missing",
    ]);
    expect(decisions[0]).toMatchObject({ version: "gnew1", token: "t1" });
    expect(decisions[1]).toMatchObject({ version: "gnew2", token: "t2" });
    expect(decisions[2]).toMatchObject({ found: "gown" });
  });

  it("treats a stale version behind hasHeadshot=false as no photo", () => {
    const [decision] = planUploads(
      [row(5001, null)],
      targets,
      new Map([[5001, { hasHeadshot: false, headshotVersion: "gstale", token: "t" }]]),
    );
    expect(decision?.kind).toBe("upload");
  });
});

function item(id: number, prior: string | null, next: string, outcome: ArtifactItem["outcome"]) {
  return { id, prior, next, outcome } satisfies ArtifactItem;
}

describe("planUndo", () => {
  it("reverts written, intended and failed items still showing our photo, nothing else", () => {
    const decisions = planUndo(
      [
        item(5001, null, "gnew1", "written"),
        item(5002, "gold", "gnew2", "intended"),
        item(5003, null, "gnew3", "written"),
        item(5004, null, "gnew4", "changed"),
        item(5005, null, "gnew5", "written"),
        item(5006, null, "gnew6", "failed"), // error arrived after the commit landed
        item(5007, null, "gnew7", "failed"), // write truly failed
      ],
      new Map([
        [5001, pointer("gnew1", "t1")],
        [5002, pointer("gnew2", "t2")],
        [5003, pointer("gown")],
        [5006, pointer("gnew6", "t6")],
        [5007, pointer(null)],
      ]),
    );
    expect(decisions.map((d) => [d.item.id, d.kind])).toEqual([
      [5001, "revert"],
      [5002, "revert"],
      [5003, "changed"],
      [5005, "missing"],
      [5006, "revert"],
      [5007, "changed"],
    ]);
  });
});

describe("planPurge", () => {
  it("purges a replaced photo only while this run's photo is still shown", () => {
    const decisions = planPurge(
      [
        item(5001, "gold1", "gnew1", "written"), // still ours -> purge gold1
        item(5002, "gold2", "gnew2", "written"), // undone -> keep
        item(5003, null, "gnew3", "written"), // nothing replaced -> omitted
        item(5004, "gold4", "gnew4", "changed"), // never written -> omitted
      ],
      new Map([
        [5001, pointer("gnew1")],
        [5002, pointer("gold2")],
      ]),
    );
    expect(decisions).toEqual([
      { kind: "purge", item: expect.objectContaining({ id: 5001 }), version: "gold1" },
      {
        kind: "keep",
        item: expect.objectContaining({ id: 5002 }),
        reason: "profile shows gold2, not this run's photo",
      },
    ]);
  });
});
