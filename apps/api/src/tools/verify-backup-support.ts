import type { BackupData } from "../data/backup.js";
import {
  type ParsedSnapshot,
  RESTORE_COLLECTIONS,
  type RestoreValidationReport,
  hydrateProfiles,
  privilegedRoster,
} from "../data/restore.js";
import { LATEST_OBJECT, isDefaultDatabase, scanFlags } from "./restore-support.js";

/**
 * The backup-integrity check's pure parts (D102/D151; OFC-333) — argument parsing,
 * the checks themselves, and the verdict's rendering. The entrypoint is
 * `verify-backup.ts`; the Firestore/GCS reads that feed the checks are
 * `verify-backup-state.ts`. Split the way `restore-support.ts` splits from
 * `restore.ts`: everything a test would want to assert on lives here.
 *
 * WHAT IT ANSWERS. The integrity job restores the newest backup into a throwaway
 * database and then asks this tool one question: *would that backup actually bring
 * Book back?* That is more than "did the restore exit 0". The snapshot must be
 * recent (the job is an independent second detector for a stalled backup, beside
 * D149's absence alert); it must still validate; the restored database must hold
 * exactly the snapshot, document for document and field for field; Book's own
 * cold-start hydration must read it back to the same roster; and every image the
 * snapshot points at must still exist (D151 (4): verified, never resurrected).
 *
 * WHAT IT NEVER SAYS. The verdict carries **counts and booleans only** — no
 * Constitution ids, no names, no emails, no field values. It is printed into a
 * Cloud Build log and, on failure, summarized into an alert email; neither is a
 * place for the member directory, and a check that fails can be re-run by an
 * operator who then reads the database itself.
 */

/** Everything the CLI accepts. */
export interface VerifyOptions {
  /** The snapshot the restore read, from disk (exclusive with {@link object}). */
  file: string | null;
  /** The snapshot the restore read, from the bucket — pass the resolved name, not `latest`. */
  object: string | null;
  /** The backup bucket. Required with `--object`: the source environment's, never inferred. */
  bucket: string | null;
  /** The project holding the restored database (the verify project). */
  projectId: string | null;
  /** The named database the restore wrote. Required — this tool checks a restore, not a live database. */
  database: string | null;
  /** The source environment's image bucket, for the manifest check. Required. */
  imageBucket: string | null;
  /** The oldest the snapshot may be before the staleness check fails. */
  maxAgeHours: number;
  allowEmulator: boolean;
  help: boolean;
}

/**
 * The staleness threshold. Backups land twice daily, and D149 set both backup
 * alert thresholds to 20 hours on that cadence; matching it means this check fails
 * on the same evidence as the absence alert, from an independent vantage point.
 */
export const DEFAULT_MAX_AGE_HOURS = 20;

const VALUE_FLAGS = new Set([
  "--file",
  "--object",
  "--bucket",
  "--project",
  "--database",
  "--image-bucket",
  "--max-age-hours",
]);

const BOOLEAN_FLAGS = new Set(["--allow-emulator", "--help", "-h"]);

/**
 * Parse the argument vector through the restore's own {@link scanFlags}, so the two
 * tools share its rules: an unrecognized argument is an error, a value flag never
 * swallows a following flag, and a boolean flag rejects `=value`. This tool only
 * reads, so a misparse costs a wrong verdict rather than a directory — but a wrong
 * *green* verdict on a scheduled job is the one failure nobody looks for, which is
 * reason enough to refuse rather than guess.
 */
export function parseVerifyArgs(argv: readonly string[]): {
  options: VerifyOptions;
  errors: string[];
} {
  const options: VerifyOptions = {
    file: null,
    object: null,
    bucket: null,
    projectId: null,
    database: null,
    imageBucket: null,
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    allowEmulator: false,
    help: false,
  };
  const { flags, errors } = scanFlags(argv, VALUE_FLAGS, BOOLEAN_FLAGS);
  for (const { flag, value } of flags) {
    if (value !== null) {
      assignValue(options, flag, value, errors);
    } else if (flag === "--allow-emulator") {
      options.allowEmulator = true;
    } else {
      options.help = true;
    }
  }
  if (!options.help) {
    checkRequired(options, errors);
  }
  return { options, errors };
}

/** What a real run cannot do without — judged after every flag is read. */
function checkRequired(options: VerifyOptions, errors: string[]): void {
  if ((options.file === null) === (options.object === null)) {
    errors.push("Give exactly one snapshot: --file <path> or --object <name>.");
  }
  if (options.object === LATEST_OBJECT) {
    // The restore may resolve `latest`; this tool must not. Backups land twice a
    // day, so a second resolution can pick a newer snapshot than the one restored
    // and fail every content check for a reason that has nothing to do with the
    // backup. The caller resolves once and hands both tools the same name.
    errors.push(
      `--object must name the snapshot the restore read, not "${LATEST_OBJECT}" (a backup landing in between would make the comparison meaningless).`,
    );
  }
  if (options.object !== null && options.bucket === null) {
    errors.push("--object needs --bucket (the SOURCE environment's backup bucket).");
  }
  if (isDefaultDatabase(options.database)) {
    errors.push(
      "--database must name the throwaway database the restore wrote; this tool checks a restore, not a live environment.",
    );
  }
  if (options.imageBucket === null) {
    errors.push("--image-bucket is required (the SOURCE environment's image bucket).");
  }
}

function assignValue(options: VerifyOptions, flag: string, value: string, errors: string[]): void {
  switch (flag) {
    case "--file":
      options.file = value;
      break;
    case "--object":
      options.object = value;
      break;
    case "--bucket":
      options.bucket = value;
      break;
    case "--project":
      options.projectId = value;
      break;
    case "--database":
      options.database = value;
      break;
    case "--image-bucket":
      options.imageBucket = value;
      break;
    default: {
      const hours = Number(value);
      if (!Number.isFinite(hours) || hours <= 0) {
        errors.push(`--max-age-hours must be a positive number (got ${value}).`);
      } else {
        options.maxAgeHours = hours;
      }
    }
  }
}

/** What the restored database looked like when it was read back. */
export interface RestoredState {
  /** The three durable collections, read back from the restored database. */
  collections: BackupData;
  /** `ProfileCache.size` after the real cold-start hydration over that database. */
  hydratedSize: number;
  /** `ProfileCache.adminCount()` — usable admins, as Book itself counts them. */
  hydratedUsableAdmins: number;
}

/** Everything the checks judge. Every input is already in memory; nothing here does I/O. */
export interface VerifyInputs {
  snapshot: ParsedSnapshot;
  validation: RestoreValidationReport;
  restored: RestoredState;
  /** Every object key in the image bucket under the manifest's prefixes. */
  imageKeys: ReadonlySet<string>;
  now: Date;
  maxAgeHours: number;
}

/**
 * One check's outcome. `counts` holds numbers only, by construction — the type is
 * the guarantee that a check cannot leak an id or a value into the verdict.
 */
export interface VerifyCheck {
  name: string;
  ok: boolean;
  counts: Record<string, number>;
  /** A fixed explanatory string, never interpolated from data. */
  note?: string;
}

/** The machine-readable verdict: the job's whole output. */
export interface VerifyVerdict {
  ok: boolean;
  checkedAt: string;
  snapshot: { version: number; generatedAt: string };
  checks: VerifyCheck[];
}

/**
 * A key-order-independent serialization, for comparing a snapshot document with
 * the same document read back from Firestore. Firestore does not preserve the
 * order of a map's keys, so `JSON.stringify` of the two would differ on documents
 * that are identical; arrays *are* ordered in Firestore and keep their order here.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const HOUR_MS = 3_600_000;

function freshnessCheck(inputs: VerifyInputs): VerifyCheck {
  const takenAt = Date.parse(inputs.snapshot.generatedAt);
  if (Number.isNaN(takenAt)) {
    return {
      name: "snapshotFresh",
      ok: false,
      counts: { maxAgeHours: inputs.maxAgeHours },
      note: "the snapshot's generatedAt is not a readable timestamp",
    };
  }
  const ageHours = Math.round(((inputs.now.getTime() - takenAt) / HOUR_MS) * 10) / 10;
  return {
    name: "snapshotFresh",
    ok: ageHours <= inputs.maxAgeHours,
    counts: { ageHours, maxAgeHours: inputs.maxAgeHours },
  };
}

function validationCheck(validation: RestoreValidationReport): VerifyCheck {
  return {
    name: "snapshotValid",
    ok: validation.errors.length === 0,
    counts: { errors: validation.errors.length, warnings: validation.warnings.length },
  };
}

/**
 * The restored collection holds exactly the snapshot's documents with exactly the
 * snapshot's contents. Counts alone would pass a restore that wrote the right
 * number of documents with the wrong data — a serialization fault, a truncated
 * batch replayed onto stale records — which is the failure a restore test exists
 * to catch.
 */
function collectionCheck(
  name: (typeof RESTORE_COLLECTIONS)[number],
  inputs: VerifyInputs,
): VerifyCheck {
  const expected = new Map(
    inputs.snapshot.collections[name].map((doc) => [doc.id, canonicalJson(doc.data)]),
  );
  const restored = inputs.restored.collections[name];
  let differing = 0;
  let extra = 0;
  const seen = new Set<string>();
  for (const doc of restored) {
    seen.add(doc.id);
    const want = expected.get(doc.id);
    if (want === undefined) {
      extra++;
    } else if (want !== canonicalJson(doc.data)) {
      differing++;
    }
  }
  let missing = 0;
  for (const id of expected.keys()) {
    if (!seen.has(id)) {
      missing++;
    }
  }
  return {
    name: `${name}Restored`,
    ok: missing === 0 && extra === 0 && differing === 0,
    counts: { expected: expected.size, restored: restored.length, missing, extra, differing },
  };
}

/**
 * Book's real cold-start hydration reads the restored database back to the roster
 * the snapshot implies. `droppedOnHydrate` — snapshot records the normalizer
 * discards for want of a usable id — is reported but does not fail the check:
 * the live system already drops them the same way, so a backup carrying one is a
 * faithful archive of what Book serves.
 */
function hydrationCheck(inputs: VerifyInputs): VerifyCheck {
  const expected = hydrateProfiles(inputs.snapshot.collections.profiles).length;
  const expectedAdmins = privilegedRoster(inputs.snapshot.collections.profiles).usableAdminIds
    .length;
  return {
    name: "hydratesAndCounts",
    ok:
      inputs.restored.hydratedSize === expected &&
      inputs.restored.hydratedUsableAdmins === expectedAdmins,
    counts: {
      expectedProfiles: expected,
      hydratedProfiles: inputs.restored.hydratedSize,
      droppedOnHydrate: inputs.snapshot.collections.profiles.length - expected,
      expectedUsableAdmins: expectedAdmins,
      hydratedUsableAdmins: inputs.restored.hydratedUsableAdmins,
    },
  };
}

/**
 * Every object the manifest pins still exists (D151 (4): verified, not resurrected
 * — a missing one is reported for a human to recover from GCS's noncurrent
 * versions, D8/D94). A version-1 envelope predates the manifest; the automated
 * backup never writes one, so meeting one here fails rather than passing vacuously
 * over images nobody checked.
 */
function manifestCheck(inputs: VerifyInputs): VerifyCheck {
  if (inputs.snapshot.version < 2) {
    return {
      name: "imagesPresent",
      ok: false,
      counts: { envelopeVersion: inputs.snapshot.version },
      note: "a version-1 envelope carries no image manifest, so no image was checked",
    };
  }
  let missingHeadshots = 0;
  let missingThumbnails = 0;
  for (const entry of inputs.snapshot.images) {
    if (!inputs.imageKeys.has(entry.headshotKey)) {
      missingHeadshots++;
    }
    if (!inputs.imageKeys.has(entry.thumbnailKey)) {
      missingThumbnails++;
    }
  }
  return {
    name: "imagesPresent",
    ok: missingHeadshots === 0 && missingThumbnails === 0,
    counts: { entries: inputs.snapshot.images.length, missingHeadshots, missingThumbnails },
  };
}

/** Run every check. All of them always run, so one failure never hides another. */
export function runChecks(inputs: VerifyInputs): VerifyVerdict {
  const checks = [
    freshnessCheck(inputs),
    validationCheck(inputs.validation),
    ...RESTORE_COLLECTIONS.map((name) => collectionCheck(name, inputs)),
    hydrationCheck(inputs),
    manifestCheck(inputs),
  ];
  return {
    ok: checks.every((check) => check.ok),
    checkedAt: inputs.now.toISOString(),
    snapshot: { version: inputs.snapshot.version, generatedAt: inputs.snapshot.generatedAt },
    checks,
  };
}

/** The verdict as printable lines, one per check, then the overall result. */
export function renderVerdict(verdict: VerifyVerdict): string[] {
  const lines = verdict.checks.map((check) => {
    const counts = Object.entries(check.counts)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    return `  ${check.ok ? "PASS" : "FAIL"}  ${check.name}  ${counts}${check.note ? ` — ${check.note}` : ""}`;
  });
  const failed = verdict.checks.filter((check) => !check.ok).length;
  lines.push(
    verdict.ok
      ? `Backup integrity VERIFIED (${verdict.checks.length} checks).`
      : `Backup integrity FAILED: ${failed} of ${verdict.checks.length} checks.`,
  );
  return lines;
}
