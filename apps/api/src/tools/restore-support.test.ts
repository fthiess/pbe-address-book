import { describe, expect, it } from "vitest";
import type { PrivilegedRoster, RosterDelta } from "../data/restore.js";
import {
  DEFAULT_OUT_DIR,
  buildRestoreAuditEntry,
  isMaintenancePage,
  parseArgs,
  renderRosterSummary,
  renderValidationReport,
} from "./restore-support.js";

/**
 * The CLI's judgement, separated from its I/O. The argument tests matter more than
 * they look: this is the one tool in the repo where a misread flag replaces the
 * whole directory, so "unrecognized argument" must be an error and every default
 * must sit at the safe end.
 */

describe("parseArgs", () => {
  it("defaults to the safe end of every choice", () => {
    const { options } = parseArgs(["--file", "snap.json"]);
    expect(options).toMatchObject({
      file: "snap.json",
      dryRun: false,
      force: false,
      allowEmulator: false,
      safetySnapshot: true,
      outDir: DEFAULT_OUT_DIR,
      confirm: null,
    });
  });

  it("accepts --flag=value as well as --flag value", () => {
    const { options, errors } = parseArgs(["--object=latest", "--project", "pbe-book-staging"]);
    expect(errors).toEqual([]);
    expect(options.object).toBe("latest");
    expect(options.projectId).toBe("pbe-book-staging");
  });

  it("rejects an unrecognized argument instead of ignoring it", () => {
    // A mistyped `--dry-runn` that parsed as "no flags" would run a live restore.
    const { errors } = parseArgs(["--file", "snap.json", "--dry-runn"]);
    expect(errors).toEqual(["Unrecognized argument: --dry-runn"]);
  });

  it("rejects a value flag with nothing after it", () => {
    const { errors } = parseArgs(["--file"]);
    expect(errors).toContain("--file needs a value.");
  });

  it("never lets a value flag swallow the following flag", () => {
    // The catastrophe path: `--out-dir "$DIR" --dry-run` with $DIR unset expands to
    // `--out-dir --dry-run`. A parser that takes the next token whatever it is sets
    // outDir = "--dry-run", leaves dryRun false, raises nothing — and with a
    // --confirm already on the line, performs a LIVE restore while its author
    // believes they asked for a preview.
    const { options, errors } = parseArgs([
      "--object",
      "latest",
      "--out-dir",
      "--dry-run",
      "--confirm",
      "pbe-book-staging",
    ]);
    expect(errors).toContain("--out-dir needs a value.");
    expect(options.dryRun).toBe(true);
    expect(options.outDir).toBe(DEFAULT_OUT_DIR);
  });

  it("still accepts a leading-dash value through the inline form", () => {
    expect(parseArgs(["--file", "a.json", "--out-dir=-weird"]).options.outDir).toBe("-weird");
  });

  it("rejects a value stapled to a boolean flag rather than discarding it", () => {
    // `--dry-run=false` reads to a human as "not a dry run"; silently setting
    // dryRun = true and dropping the value would be the friendlier wrong answer.
    const { errors } = parseArgs(["--file", "a.json", "--dry-run=false"]);
    expect(errors).toContain("--dry-run takes no value (got --dry-run=false).");
  });

  it("waives duplicate emails only when asked", () => {
    expect(parseArgs(["--file", "a.json"]).options.allowDuplicateEmails).toBe(false);
    expect(
      parseArgs(["--file", "a.json", "--allow-duplicate-emails"]).options.allowDuplicateEmails,
    ).toBe(true);
  });

  it("requires a snapshot source, and only one", () => {
    expect(parseArgs([]).errors).toContain(
      "Give a snapshot: --file <path> or --object <name|latest>.",
    );
    expect(parseArgs(["--file", "a.json", "--object", "latest"]).errors).toContain(
      "--file and --object are mutually exclusive.",
    );
  });

  it("does not demand a snapshot when only asking for help", () => {
    const { options, errors } = parseArgs(["--help"]);
    expect(options.help).toBe(true);
    expect(errors).toEqual([]);
  });

  it("turns the safety snapshot off only when asked explicitly", () => {
    expect(parseArgs(["--file", "a.json", "--no-safety-snapshot"]).options.safetySnapshot).toBe(
      false,
    );
  });
});

describe("isMaintenancePage", () => {
  it("recognizes the served maintenance page", () => {
    expect(isMaintenancePage("<h1>Down for maintenance</h1>")).toBe(true);
  });

  it("does not mistake the running SPA for it", () => {
    expect(isMaintenancePage('<div id="root"></div><title>PBE Book</title>')).toBe(false);
  });
});

const roster = (overrides: Partial<PrivilegedRoster> = {}): PrivilegedRoster => ({
  adminIds: [5003, 5004],
  managerIds: [5010],
  usableAdminIds: [5004],
  ...overrides,
});

const delta = (overrides: Partial<RosterDelta> = {}): RosterDelta => ({
  adminIdsAdded: [],
  adminIdsRemoved: [],
  managerIdsAdded: [],
  managerIdsRemoved: [],
  ...overrides,
});

describe("buildRestoreAuditEntry", () => {
  it("records the resulting roster, with the usable-admin total as the count", () => {
    const entry = buildRestoreAuditEntry(roster(), delta({ adminIdsAdded: [5099] }));
    expect(entry).toEqual({
      action: "restore",
      outcome: "ok",
      count: 1,
      adminIds: [5003, 5004],
      managerIds: [5010],
      adminIdsAdded: [5099],
      adminIdsRemoved: [],
    });
  });

  it("omits the delta entirely when the prior state was not readable (D101)", () => {
    const entry = buildRestoreAuditEntry(roster(), null);
    expect(entry.adminIdsAdded).toBeUndefined();
    expect(entry.adminIdsRemoved).toBeUndefined();
    expect(entry.adminIds).toEqual([5003, 5004]);
  });

  it("carries no actor — a restore is run by a tool, not by a session", () => {
    expect(buildRestoreAuditEntry(roster(), null).actorId).toBeUndefined();
  });
});

describe("renderValidationReport", () => {
  it("says PASSED and counts the warnings when nothing refuses", () => {
    const lines = renderValidationReport({
      errors: [],
      warnings: [{ rule: "referenceIntegrity", message: "an orphan" }],
      counts: { profiles: 2, users: 1, config: 1 },
    });
    expect(lines.join("\n")).toContain("Structural validation PASSED (1 warning(s))");
  });

  it("lists every error and says plainly that nothing was written", () => {
    const lines = renderValidationReport({
      errors: [
        { rule: "cycle", message: "a loop" },
        { rule: "emailUniqueness", message: "a collision" },
      ],
      warnings: [],
      counts: { profiles: 2, users: 0, config: 0 },
    });
    expect(lines.filter((line) => line.includes("ERROR"))).toHaveLength(2);
    expect(lines.join("\n")).toContain("Nothing was written");
  });
});

describe("renderRosterSummary", () => {
  it("shouts when the restored data leaves nobody able to administer", () => {
    const lines = renderRosterSummary(roster({ usableAdminIds: [] }), delta()).join("\n");
    expect(lines).toContain("NO USABLE ADMIN");
  });

  it("says so explicitly when nothing about the roster changed", () => {
    expect(renderRosterSummary(roster(), delta()).join("\n")).toContain(
      "no privileged-role changes",
    );
  });

  it("distinguishes an unchanged roster from an unknown one", () => {
    expect(renderRosterSummary(roster(), null).join("\n")).toContain(
      "prior state was not readable",
    );
  });

  it("names the ids on both tiers when the roster moved", () => {
    const lines = renderRosterSummary(
      roster(),
      delta({ adminIdsAdded: [5099], managerIdsRemoved: [5010] }),
    ).join("\n");
    expect(lines).toContain("admins added #5099");
    expect(lines).toContain("managers removed #5010");
  });
});
