import { FAKE_ID_FLOOR, TESTER_ID_FLOOR } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { RosterError, parseRoster, splitCsvLine } from "./roster.js";

// ⚠ Every fixture here is invented. The real roster carries live brothers' names and
// email addresses, lives only as a private GCS object, and must never reach this
// PUBLIC repo. Names follow the repo's fake exemplar (James Smyth '84, #5247).

const HEADER = "profileId,firstName,lastName,classYear,email,role";

/** Build a roster CSV from data rows, so tests read as their subject matter. */
function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("splitCsvLine", () => {
  it("splits plain fields and trims surrounding space", () => {
    expect(splitCsvLine("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps a comma inside a quoted field — a surname like Smyth, Jr.", () => {
    expect(splitCsvLine('5247,James,"Smyth, Jr.",1984')).toEqual([
      "5247",
      "James",
      "Smyth, Jr.",
      "1984",
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(splitCsvLine('James,"the ""Duke"" Smyth"')).toEqual(["James", 'the "Duke" Smyth']);
  });

  it("yields empty strings for empty fields", () => {
    expect(splitCsvLine(",,")).toEqual(["", "", ""]);
  });
});

describe("parseRoster — id assignment", () => {
  it("assigns sequential ids from TESTER_ID_FLOOR when profileId is blank", () => {
    const entries = parseRoster(
      csv(
        ",James,Smyth,1984,james@example.test,",
        ",Robert,Ellery,1991,robert@example.test,",
        ",Alan,Waverley,2003,alan@example.test,",
      ),
    );

    expect(entries.map((e) => e.profileId)).toEqual([
      TESTER_ID_FLOOR,
      TESTER_ID_FLOOR + 1,
      TESTER_ID_FLOOR + 2,
    ]);
  });

  it("handles a roster of one — the single-tester case", () => {
    const entries = parseRoster(csv(",James,Smyth,1984,james@example.test,"));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.profileId).toBe(TESTER_ID_FLOOR);
    expect(entries[0]?.role).toBe("admin");
  });

  it("treats a header with no data rows as an empty roster, not an error", () => {
    expect(parseRoster(HEADER)).toEqual([]);
  });

  it("honours an explicit id and does not reuse it for a later auto-assignment", () => {
    const entries = parseRoster(
      csv(
        `${TESTER_ID_FLOOR + 1},James,Smyth,1984,james@example.test,admin`,
        ",Robert,Ellery,1991,robert@example.test,",
        ",Alan,Waverley,2003,alan@example.test,",
      ),
    );

    expect(entries.map((e) => e.profileId)).toEqual([
      TESTER_ID_FLOOR + 1,
      TESTER_ID_FLOOR,
      TESTER_ID_FLOOR + 2,
    ]);
  });

  it("rejects an id below FAKE_ID_FLOOR — D65 reserves those for real numbers", () => {
    expect(() => parseRoster(csv("4001,James,Smyth,1984,james@example.test,admin"))).toThrow(
      RosterError,
    );
    expect(() => parseRoster(csv("4001,James,Smyth,1984,james@example.test,admin"))).toThrow(
      /below FAKE_ID_FLOOR/,
    );
  });

  it("rejects an id inside the generated block by default", () => {
    expect(() => parseRoster(csv("5004,James,Smyth,1984,james@example.test,admin"))).toThrow(
      /would overwrite a deliberate test fixture/,
    );
  });

  it("permits reclaiming a generated fixture id when explicitly allowed", () => {
    const entries = parseRoster(csv("5004,James,Smyth,1984,james@example.test,admin"), {
      allowFixtureOverwrite: true,
    });

    expect(entries[0]?.profileId).toBe(5004);
    expect(FAKE_ID_FLOOR).toBeLessThan(5004);
  });

  it("rejects a duplicate explicit id", () => {
    expect(() =>
      parseRoster(
        csv(
          `${TESTER_ID_FLOOR},James,Smyth,1984,james@example.test,admin`,
          `${TESTER_ID_FLOOR},Robert,Ellery,1991,robert@example.test,`,
        ),
      ),
    ).toThrow(/already claimed/);
  });
});

describe("parseRoster — role defaulting", () => {
  it("makes the first row admin and the rest brothers", () => {
    const entries = parseRoster(
      csv(
        ",James,Smyth,1984,james@example.test,",
        ",Robert,Ellery,1991,robert@example.test,",
        ",Alan,Waverley,2003,alan@example.test,",
      ),
    );

    expect(entries.map((e) => e.role)).toEqual(["admin", "brother", "brother"]);
  });

  it("lets an explicit role override the default in either direction", () => {
    const entries = parseRoster(
      csv(
        ",James,Smyth,1984,james@example.test,brother",
        ",Robert,Ellery,1991,robert@example.test,manager",
      ),
    );

    expect(entries.map((e) => e.role)).toEqual(["brother", "manager"]);
  });

  it("accepts a role in any case", () => {
    expect(parseRoster(csv(",James,Smyth,1984,james@example.test,ADMIN"))[0]?.role).toBe("admin");
  });

  it("rejects an unknown role", () => {
    expect(() => parseRoster(csv(",James,Smyth,1984,james@example.test,superuser"))).toThrow(
      /must be one of/,
    );
  });
});

describe("parseRoster — field validation", () => {
  it("requires the three mandatory columns in the header", () => {
    expect(() => parseRoster("firstName,lastName\nJames,Smyth")).toThrow(/missing the required/);
  });

  it("tolerates a header carrying only the required columns", () => {
    const entries = parseRoster("firstName,lastName,email\nJames,Smyth,james@example.test");

    expect(entries[0]).toMatchObject({
      firstName: "James",
      lastName: "Smyth",
      classYear: null,
      role: "admin",
      profileId: TESTER_ID_FLOOR,
    });
  });

  it("treats a blank classYear as null rather than zero", () => {
    expect(parseRoster(csv(",James,Smyth,,james@example.test,"))[0]?.classYear).toBeNull();
  });

  it("parses a present classYear as a number", () => {
    expect(parseRoster(csv(",James,Smyth,1984,james@example.test,"))[0]?.classYear).toBe(1984);
  });

  it("rejects an implausible classYear", () => {
    expect(() => parseRoster(csv(",James,Smyth,84,james@example.test,"))).toThrow(/plausible/);
  });

  it("requires both name parts", () => {
    expect(() => parseRoster(csv(",James,,1984,james@example.test,"))).toThrow(/both required/);
  });

  it("requires something email-shaped", () => {
    expect(() => parseRoster(csv(",James,Smyth,1984,not-an-email,"))).toThrow(
      /email column is missing or not email-shaped/,
    );
  });

  it("does NOT echo the offending email value — it reaches public CI logs", () => {
    // The real invariant, asserted rather than merely commented. A malformed row is
    // a likely hand-editing slip, and the value in an email column is a real
    // brother's address; this message travels to console.error and, from the deploy
    // workflow, into a world-readable Actions log on a PUBLIC repo. Found in code
    // review — the message used to interpolate the raw cell.
    expect(() => parseRoster(csv(",James,Smyth,1984,jsmyth-at-example,"))).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("jsmyth-at-example"),
      }),
    );
  });

  it("still names the class year, role and id in their errors — none of them are PII", () => {
    // The redaction above is scoped deliberately: echoing the bad value is what
    // makes an error actionable, and a year, a role name and an id carry nothing
    // sensitive. Only the email column was ever a leak.
    expect(() => parseRoster(csv(",James,Smyth,84,james@example.test,"))).toThrow(/"84"/);
    expect(() => parseRoster(csv(",James,Smyth,1984,james@example.test,superuser"))).toThrow(
      /"superuser"/,
    );
    expect(() => parseRoster(csv("nope,James,Smyth,1984,james@example.test,"))).toThrow(/"nope"/);
  });

  it("rejects a duplicate email regardless of case — D97 uniqueness", () => {
    expect(() =>
      parseRoster(
        csv(
          ",James,Smyth,1984,james@example.test,admin",
          ",Robert,Ellery,1991,JAMES@example.test,",
        ),
      ),
    ).toThrow(/duplicate email/);
  });

  it("names the offending CSV line in its errors", () => {
    expect(() =>
      parseRoster(
        csv(",James,Smyth,1984,james@example.test,admin", ",Robert,Ellery,1991,bad-email,"),
      ),
    ).toThrow(/Line 3/);
  });

  it("ignores blank lines and trailing newlines", () => {
    const entries = parseRoster(
      `${HEADER}\n\n,James,Smyth,1984,james@example.test,\n\n,Robert,Ellery,1991,robert@example.test,\n`,
    );

    expect(entries).toHaveLength(2);
  });

  it("rejects a file with no header at all", () => {
    expect(() => parseRoster("")).toThrow(/empty/);
  });
});
