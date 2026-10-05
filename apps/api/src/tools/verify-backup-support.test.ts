import { describe, expect, it } from "vitest";
import { type BackupData, buildBackupSnapshot } from "../data/backup.js";
import { type ParsedSnapshot, parseSnapshot, validateSnapshot } from "../data/restore.js";
import { makeProfile } from "../test-support/make-profile.js";
import {
  DEFAULT_MAX_AGE_HOURS,
  type RestoredState,
  type VerifyInputs,
  canonicalJson,
  couldNotRunVerdict,
  parseVerifyArgs,
  renderVerdict,
  runChecks,
} from "./verify-backup-support.js";

/**
 * The integrity check's judgement, separated from its reads. Each failing case
 * changes exactly one thing about an otherwise-perfect restore and asserts that
 * exactly that check — and only that check — goes red, so a check that passes
 * vacuously, or one that fails for someone else's reason, shows up here.
 */

const TAKEN_AT = new Date("2026-10-05T06:00:00.000Z");
const NOW = new Date("2026-10-05T08:30:00.000Z");

function data(): BackupData {
  return {
    profiles: [
      {
        id: "5001",
        data: { ...makeProfile({ id: 5001, email: "b5001@example.test" }) },
      },
      {
        id: "5247",
        data: {
          ...makeProfile({
            id: 5247,
            role: "admin",
            email: "b5247@example.test",
            hasHeadshot: true,
            headshotVersion: "v3",
          }),
        },
      },
    ],
    users: [{ id: "5247", data: { id: 5247, stars: [5001] } }],
    config: [{ id: "systemBanner", data: { active: false, message: "", severity: "info" } }],
  };
}

function snapshotOf(collections: BackupData, at = TAKEN_AT): ParsedSnapshot {
  const parsed = parseSnapshot(JSON.parse(JSON.stringify(buildBackupSnapshot(collections, at))));
  if (!parsed.ok) {
    throw new Error("fixture snapshot failed to parse");
  }
  return parsed.snapshot;
}

/** A restore that went perfectly: the database holds exactly the snapshot. */
function perfect(overrides: Partial<VerifyInputs> = {}): VerifyInputs {
  const snapshot = snapshotOf(data());
  const restored: RestoredState = {
    // Deep copies with the key order of every map reversed — Firestore does not
    // preserve map key order, and the content check must not care.
    collections: JSON.parse(JSON.stringify(data()), (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
    hydratedSize: 2,
    hydratedUsableAdmins: 1,
  };
  return {
    snapshot,
    validation: validateSnapshot(snapshot.collections),
    restored,
    imageKeys: new Set(["headshots/5247/v3.webp", "thumbnails/5247/v3.webp"]),
    now: NOW,
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    ...overrides,
  };
}

function failing(inputs: VerifyInputs): string[] {
  return runChecks(inputs)
    .checks.filter((check) => !check.ok)
    .map((check) => check.name);
}

describe("runChecks", () => {
  it("verifies a perfect restore, and every check actually ran", () => {
    const verdict = runChecks(perfect());
    expect(verdict.ok).toBe(true);
    expect(verdict.checks.map((check) => check.name)).toEqual([
      "snapshotFresh",
      "snapshotValid",
      "profilesRestored",
      "usersRestored",
      "configRestored",
      "hydratesAndCounts",
      "imagesPresent",
    ]);
    // Not vacuous: the manifest check looked at the one headshot the fixture has.
    expect(verdict.checks.find((c) => c.name === "imagesPresent")?.counts.entries).toBe(1);
  });

  it("fails a snapshot older than the threshold — the stalled-backup detector", () => {
    const stale = perfect({ snapshot: snapshotOf(data(), new Date("2026-10-04T08:00:00Z")) });
    expect(failing(stale)).toEqual(["snapshotFresh"]);
    expect(runChecks(stale).checks[0]?.counts.ageHours).toBe(24.5);
  });

  it("fails a snapshot dated in the future, beyond ordinary clock skew", () => {
    const future = perfect({ snapshot: snapshotOf(data(), new Date("2026-10-05T10:00:00Z")) });
    expect(failing(future)).toEqual(["snapshotFresh"]);
    const skewed = perfect({ snapshot: snapshotOf(data(), new Date("2026-10-05T09:00:00Z")) });
    expect(failing(skewed)).toEqual([]);
  });

  it("fails a restore that lost a document", () => {
    const inputs = perfect();
    inputs.restored.collections.profiles.pop();
    inputs.restored.hydratedSize = 1;
    inputs.restored.hydratedUsableAdmins = 0;
    expect(failing(inputs)).toEqual(["profilesRestored", "hydratesAndCounts"]);
    expect(runChecks(inputs).checks[2]?.counts).toMatchObject({ missing: 1, extra: 0 });
  });

  it("fails a restore that left a stale document behind", () => {
    const inputs = perfect();
    inputs.restored.collections.users.push({ id: "5001", data: { id: 5001, stars: [] } });
    expect(failing(inputs)).toEqual(["usersRestored"]);
  });

  it("fails right-count, wrong-content — what a count-only check would pass", () => {
    const inputs = perfect();
    const doc = inputs.restored.collections.config[0];
    if (doc) {
      doc.data = { ...doc.data, message: "something else" };
    }
    expect(failing(inputs)).toEqual(["configRestored"]);
    expect(runChecks(inputs).checks[4]?.counts).toMatchObject({ differing: 1, restored: 1 });
  });

  it("fails when Book's hydration disagrees with the snapshot's roster", () => {
    expect(
      failing(perfect({ restored: { ...perfect().restored, hydratedUsableAdmins: 0 } })),
    ).toEqual(["hydratesAndCounts"]);
  });

  it("fails a manifest entry with no live object, and counts which kind", () => {
    const inputs = perfect({ imageKeys: new Set(["headshots/5247/v3.webp"]) });
    expect(failing(inputs)).toEqual(["imagesPresent"]);
    expect(runChecks(inputs).checks[6]?.counts).toMatchObject({
      missingHeadshots: 0,
      missingThumbnails: 1,
    });
  });

  it("fails a v2 envelope whose image list was dropped, instead of checking nothing", () => {
    // `parseSnapshot` reads a missing `images` as []. Trusting it would pass with
    // entries=0 while a profile still points at a headshot.
    const inputs = perfect();
    inputs.snapshot = { ...inputs.snapshot, images: [] };
    expect(failing(inputs)).toEqual(["imagesPresent"]);
    expect(runChecks(inputs).checks[6]?.counts).toMatchObject({
      entries: 1,
      envelopeEntries: 0,
      envelopeAgrees: 0,
    });
  });

  it("checks a version-1 envelope's images from its profiles, since it has no list", () => {
    const inputs = perfect();
    inputs.snapshot = { ...inputs.snapshot, version: 1, images: [] };
    expect(failing(inputs)).toEqual([]);
    expect(failing({ ...inputs, imageKeys: new Set() })).toEqual(["imagesPresent"]);
  });

  it("emits counts and booleans only — no id, name, email or value reaches the verdict", () => {
    const inputs = perfect({ imageKeys: new Set() });
    inputs.restored.collections.profiles.pop();
    const json = JSON.stringify(runChecks(inputs));
    expect(json).not.toMatch(/5247|5001|example\.test|Smyth|James/);
  });
});

describe("couldNotRunVerdict", () => {
  it("never reads as a pass, and carries nothing but a fixed note", () => {
    const verdict = couldNotRunVerdict(NOW);
    expect(verdict).toEqual({
      ok: false,
      checkedAt: NOW.toISOString(),
      snapshot: null,
      checks: [],
      note: "the check could not run; the reason is on stderr",
    });
  });
});

describe("canonicalJson", () => {
  it("ignores map key order but not array order", () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: 3 } })).toBe(
      canonicalJson({ b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("distinguishes values that only look alike", () => {
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
    expect(canonicalJson({ a: "1" })).not.toBe(canonicalJson({ a: 1 }));
  });
});

describe("renderVerdict", () => {
  it("says VERIFIED only when every check passed", () => {
    expect(renderVerdict(runChecks(perfect())).at(-1)).toBe(
      "Backup integrity VERIFIED (7 checks).",
    );
    expect(renderVerdict(runChecks(perfect({ imageKeys: new Set() }))).at(-1)).toBe(
      "Backup integrity FAILED: 1 of 7 checks.",
    );
  });
});

describe("parseVerifyArgs", () => {
  const complete = [
    "--object",
    "backups/2026-10-05T06-00-00Z.json",
    "--bucket",
    "pbe-book-prod-backups",
    "--project",
    "pbe-book-verify",
    "--database",
    "verify-run-1",
    "--image-bucket",
    "pbe-book-prod-images",
  ];

  it("accepts a complete invocation", () => {
    const { options, errors } = parseVerifyArgs(complete);
    expect(errors).toEqual([]);
    expect(options.maxAgeHours).toBe(DEFAULT_MAX_AGE_HOURS);
  });

  it("refuses `latest`: the check must read the snapshot the restore read", () => {
    const argv = [...complete];
    argv[1] = "latest";
    expect(parseVerifyArgs(argv).errors).toHaveLength(1);
  });

  it("refuses to check a default database", () => {
    for (const database of ["(default)", null]) {
      const argv = complete.filter((arg) => arg !== "--database" && arg !== "verify-run-1");
      if (database !== null) {
        argv.push("--database", database);
      }
      expect(parseVerifyArgs(argv).errors.join(" ")).toContain("--database");
    }
  });

  it("never infers a source bucket", () => {
    const withoutImages = complete.slice(0, 8);
    expect(parseVerifyArgs(withoutImages).errors.join(" ")).toContain("--image-bucket");
    const withoutBackups = complete.filter(
      (arg) => arg !== "--bucket" && arg !== "pbe-book-prod-backups",
    );
    expect(parseVerifyArgs(withoutBackups).errors.join(" ")).toContain("--bucket");
  });

  it("rejects unknown flags, swallowed flags and a nonsense threshold", () => {
    expect(parseVerifyArgs([...complete, "--dry-run"]).errors).toEqual([
      "Unrecognized argument: --dry-run",
    ]);
    expect(parseVerifyArgs([...complete, "--max-age-hours", "--allow-emulator"]).errors).toEqual([
      "--max-age-hours needs a value.",
    ]);
    expect(parseVerifyArgs([...complete, "--max-age-hours=0"]).errors).toHaveLength(1);
  });

  it("takes the restore's duplicate-email waiver only when asked", () => {
    expect(parseVerifyArgs(complete).options.allowDuplicateEmails).toBe(false);
    expect(
      parseVerifyArgs([...complete, "--allow-duplicate-emails"]).options.allowDuplicateEmails,
    ).toBe(true);
  });

  it("asks for nothing else when asked for help", () => {
    expect(parseVerifyArgs(["--help"]).errors).toEqual([]);
  });
});
