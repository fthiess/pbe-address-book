import { describe, expect, it } from "vitest";
import type { BackupData, CollectionSnapshot } from "./backup.js";
import {
  detectCycles,
  hydrateProfiles,
  parseSnapshot,
  privilegedRoster,
  rosterDelta,
  rosterDeltaIsEmpty,
  validateSnapshot,
} from "./restore.js";

/**
 * The structural validator (D101) is the only thing standing between a corrupt or
 * tampered archive and the live directory, so each rule is tested for what it
 * *refuses* as much as what it accepts — and, just as importantly, for what it
 * deliberately lets through (a `users` orphan the running system already tolerates
 * and reports; a record that could not be *edited* today but restores verbatim).
 */

const doc = (data: Record<string, unknown>): CollectionSnapshot => ({
  id: String(data.id),
  data,
});

const dataset = (overrides: Partial<BackupData> = {}): BackupData => ({
  profiles: [],
  users: [],
  config: [],
  ...overrides,
});

const messages = (issues: readonly { message: string }[]): string =>
  issues.map((i) => i.message).join(" | ");

describe("parseSnapshot", () => {
  it("reads the version-2 envelope, manifest and all", () => {
    const result = parseSnapshot({
      version: 2,
      generatedAt: "2026-07-25T12:00:00.000Z",
      collections: { profiles: [doc({ id: 5247 })], users: [], config: [] },
      images: [{ id: 5247, version: "v1", headshotKey: "a", thumbnailKey: "b" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.version).toBe(2);
    expect(result.snapshot.images).toHaveLength(1);
    expect(result.snapshot.collections.profiles).toHaveLength(1);
  });

  it("still reads a version-1 archive downloaded before the envelopes were unified", () => {
    // The custodian of an off-platform copy (D101) must not have to know that a
    // wire version changed under them; v1 simply has no manifest.
    const result = parseSnapshot({
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      collections: { profiles: [doc({ id: 5001 })], users: [], config: [] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.images).toEqual([]);
  });

  it("refuses an unrecognized version rather than guessing at the shape", () => {
    const result = parseSnapshot({ version: 3, generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(messages(result.errors)).toContain("Unrecognized snapshot version");
  });

  it("reports every malformed document in one pass", () => {
    const result = parseSnapshot({
      version: 2,
      generatedAt: "2026-07-25T12:00:00.000Z",
      collections: { profiles: [{ id: "", data: {} }, { id: "5247" }], users: [], config: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
  });

  it("refuses a missing collection — an absent `users` is not an empty one", () => {
    const result = parseSnapshot({
      version: 2,
      generatedAt: "2026-07-25T12:00:00.000Z",
      collections: { profiles: [], config: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(messages(result.errors)).toContain("collections.users");
  });
});

describe("validateSnapshot — id uniqueness", () => {
  it("accepts a well-formed dataset", () => {
    const report = validateSnapshot(
      dataset({
        profiles: [doc({ id: 5001 }), doc({ id: 5002 })],
        users: [doc({ id: 5001, stars: [5002] })],
      }),
    );
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.counts.profiles).toBe(2);
  });

  it("refuses a document key that disagrees with its own id field", () => {
    // The fault a naive uniqueness check misses: the replay would write #5002's
    // record under key "5001", and every id-keyed lookup in Book then disagrees
    // about which brother this is.
    const report = validateSnapshot(dataset({ profiles: [{ id: "5001", data: { id: 5002 } }] }));
    expect(messages(report.errors)).toContain("conflicting `id` field 5002");
  });

  it("refuses a non-positive or non-integer id", () => {
    const report = validateSnapshot(
      dataset({
        profiles: [
          { id: "0", data: { id: 0 } },
          { id: "x", data: { id: "x" } },
        ],
      }),
    );
    expect(report.errors).toHaveLength(2);
  });

  it("refuses a repeated document key", () => {
    const report = validateSnapshot(
      dataset({
        profiles: [
          { id: "5001", data: { id: 5001 } },
          { id: "5001", data: { id: 5001 } },
        ],
      }),
    );
    expect(messages(report.errors)).toContain("more than one document with the id");
  });
});

describe("validateSnapshot — email uniqueness (D97's one namespace)", () => {
  it("refuses an address claimed by two profiles", () => {
    const report = validateSnapshot(
      dataset({
        profiles: [
          doc({ id: 5001, email: "brother@example.test" }),
          doc({ id: 5002, email: "BROTHER@Example.test" }),
        ],
      }),
    );
    expect(messages(report.errors)).toContain("#5001, #5002");
  });

  it("catches a collision across the primary/alternate boundary", () => {
    const report = validateSnapshot(
      dataset({
        profiles: [
          doc({ id: 5001, email: "shared@example.test" }),
          doc({ id: 5002, alternateEmail: "shared@example.test" }),
        ],
      }),
    );
    expect(report.errors).toHaveLength(1);
  });

  it("refuses a record whose primary and alternate are the same address", () => {
    const report = validateSnapshot(
      dataset({
        profiles: [
          doc({ id: 5001, email: "one@example.test", alternateEmail: "One@example.test " }),
        ],
      }),
    );
    expect(messages(report.errors)).toContain("both its primary and alternate");
  });

  it("never quotes an address into an issue message (D61)", () => {
    const report = validateSnapshot(
      dataset({
        profiles: [
          doc({ id: 5001, email: "secret@example.test" }),
          doc({ id: 5002, email: "secret@example.test" }),
        ],
      }),
    );
    expect(messages(report.errors)).not.toContain("secret@example.test");
  });

  it("ignores blank and absent addresses rather than colliding them on the empty key", () => {
    const report = validateSnapshot(
      dataset({
        profiles: [
          doc({ id: 5001, email: "" }),
          doc({ id: 5002, email: "   " }),
          doc({ id: 5003 }),
        ],
      }),
    );
    expect(report.errors).toEqual([]);
  });
});

describe("validateSnapshot — reference integrity", () => {
  it("refuses a dangling big brother", () => {
    const report = validateSnapshot(dataset({ profiles: [doc({ id: 5001, bigBrotherId: 9999 })] }));
    expect(messages(report.errors)).toContain("#9999, who is not in the snapshot");
  });

  it("accepts a null big brother — most brothers have none", () => {
    const report = validateSnapshot(dataset({ profiles: [doc({ id: 5001, bigBrotherId: null })] }));
    expect(report.errors).toEqual([]);
  });

  it("warns but does not refuse on a users orphan the live system already tolerates", () => {
    // A `bookInternalOrphan` (D98) is a condition the reconciliation audit reports
    // and shrugs at, so a legitimate backup taken while one existed must stay
    // restorable — refusing here would make a real archive unusable.
    const report = validateSnapshot(
      dataset({ profiles: [doc({ id: 5001 })], users: [doc({ id: 7777, stars: [8888] })] }),
    );
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(2);
  });

  it("warns on an unrecognized config singleton, restoring it verbatim", () => {
    const report = validateSnapshot(
      dataset({
        profiles: [doc({ id: 5001 })],
        config: [
          { id: "systemBanner", data: {} },
          { id: "mystery", data: {} },
        ],
      }),
    );
    expect(report.errors).toEqual([]);
    expect(messages(report.warnings)).toContain("mystery");
  });
});

describe("validateSnapshot — the refusals that guard against a truncated file", () => {
  it("refuses a snapshot with no profiles rather than emptying the directory", () => {
    // Every other rule passes vacuously on an empty roster, so without this the
    // tool would delete the whole directory and report success.
    const report = validateSnapshot(dataset({ config: [{ id: "systemBanner", data: {} }] }));
    expect(messages(report.errors)).toContain("would empty the directory");
  });

  it("refuses a document key containing a path separator, before anything is written", () => {
    // A tampered `config` id like `systemBanner/x` passes every semantic rule and
    // then throws inside batch.set — after profiles and users are already replaced.
    const report = validateSnapshot(
      dataset({ profiles: [doc({ id: 5001 })], config: [{ id: "systemBanner/x", data: {} }] }),
    );
    expect(messages(report.errors)).toContain('contains "/"');
  });
});

describe("validateSnapshot — the duplicate-email waiver", () => {
  const colliding = () =>
    dataset({
      profiles: [
        doc({ id: 5001, email: "shared@example.test" }),
        doc({ id: 5002, email: "shared@example.test" }),
      ],
    });

  it("refuses by default and names the flag that would waive it", () => {
    const report = validateSnapshot(colliding());
    expect(report.errors).toHaveLength(1);
    expect(messages(report.errors)).toContain("--allow-duplicate-emails");
  });

  it("downgrades a CROSS-profile collision to a warning when waived", () => {
    // D97 names fail-closed sign-in as "the backstop for a duplicate slipped in by
    // the genesis load or a migration" — so a snapshot holding one is a legitimate
    // archive of a state Book tolerates, and must stay restorable.
    const report = validateSnapshot(colliding(), { allowDuplicateEmails: true });
    expect(report.errors).toEqual([]);
    expect(messages(report.warnings)).toContain("fail closed until an admin de-dups");
  });

  it("still refuses a record colliding with ITSELF, waiver or not", () => {
    // The write path refuses this on every save, so it cannot be in an untampered
    // snapshot — a different claim from the cross-profile case.
    const report = validateSnapshot(
      dataset({
        profiles: [
          doc({ id: 5001, email: "one@example.test", alternateEmail: "ONE@example.test" }),
        ],
      }),
      { allowDuplicateEmails: true },
    );
    expect(messages(report.errors)).toContain("both its primary and alternate");
  });
});

describe("detectCycles / validateSnapshot — big-brother cycles", () => {
  it("finds a two-record loop", () => {
    expect(
      detectCycles(
        new Map([
          [1, 2],
          [2, 1],
        ]),
      ),
    ).toEqual([[1, 2]]);
  });

  it("finds a self-reference", () => {
    expect(detectCycles(new Map([[1, 1]]))).toEqual([[1]]);
  });

  it("does not invent a cycle for a plain chain, however long", () => {
    const parents = new Map<number, number>();
    for (let id = 2; id <= 500; id++) {
      parents.set(id, id - 1);
    }
    expect(detectCycles(parents)).toEqual([]);
  });

  it("reports a cycle nothing points into, which the per-edit check by design ignores", () => {
    // `formsCycle` in the route returns false for a pre-existing loop elsewhere in
    // the graph — right for refusing one bad edit, wrong for judging a dataset.
    const cycles = detectCycles(
      new Map([
        [1, 2],
        [2, 3],
        [3, 2],
      ]),
    );
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it("refuses a snapshot containing a cycle", () => {
    const report = validateSnapshot(
      dataset({
        profiles: [doc({ id: 5001, bigBrotherId: 5002 }), doc({ id: 5002, bigBrotherId: 5001 })],
      }),
    );
    expect(report.errors.filter((issue) => issue.rule === "cycle")).toHaveLength(1);
  });
});

describe("privilegedRoster", () => {
  const admin = (id: number, overrides: Record<string, unknown> = {}) =>
    doc({ id, role: "admin", email: `a${id}@example.test`, ...overrides });

  it("splits the admin roster from the subset that can actually administer", () => {
    const roster = privilegedRoster([
      admin(5004),
      admin(5003, { deceased: { isDeceased: true } }),
      admin(5005, { email: undefined }),
      doc({ id: 5010, role: "manager", email: "m@example.test" }),
      doc({ id: 5011 }),
    ]);
    expect(roster.adminIds).toEqual([5003, 5004, 5005]);
    expect(roster.usableAdminIds).toEqual([5004]);
    expect(roster.managerIds).toEqual([5010]);
  });

  it("fails an unrecognized role closed to brother, as hydration does", () => {
    const roster = privilegedRoster([
      doc({ id: 5001, role: "superuser", email: "s@example.test" }),
    ]);
    expect(roster.adminIds).toEqual([]);
    expect(roster.managerIds).toEqual([]);
  });

  it("skips a document with no usable Constitution id, exactly as the cache does", () => {
    const roster = privilegedRoster([{ id: "junk", data: { id: "junk", role: "admin" } }]);
    expect(roster.adminIds).toEqual([]);
  });
});

describe("rosterDelta", () => {
  const roster = (adminIds: number[], managerIds: number[] = []) => ({
    adminIds,
    managerIds,
    usableAdminIds: adminIds,
  });

  it("names the admin a restore would plant and the one it would drop", () => {
    const delta = rosterDelta(roster([5001, 5002]), roster([5002, 5099]));
    expect(delta.adminIdsAdded).toEqual([5099]);
    expect(delta.adminIdsRemoved).toEqual([5001]);
    expect(rosterDeltaIsEmpty(delta)).toBe(false);
  });

  it("reports an unchanged roster as empty", () => {
    expect(rosterDeltaIsEmpty(rosterDelta(roster([5001], [5010]), roster([5001], [5010])))).toBe(
      true,
    );
  });

  it("tracks the manager tier too", () => {
    const delta = rosterDelta(roster([], [5010]), roster([], [5011]));
    expect(delta.managerIdsAdded).toEqual([5011]);
    expect(delta.managerIdsRemoved).toEqual([5010]);
  });
});

describe("hydrateProfiles", () => {
  it("normalizes and orders the restored records the way a cold start would", () => {
    const profiles = hydrateProfiles([doc({ id: 5002 }), doc({ id: 5001, privacy: "broken" })]);
    expect(profiles.map((profile) => profile.id)).toEqual([5001, 5002]);
    // Privacy fails closed when the stored value is unusable (OFC-91).
    expect(profiles[0]?.privacy.shareEmail).toBe(false);
    expect(profiles[0]?.role).toBe("brother");
  });
});
