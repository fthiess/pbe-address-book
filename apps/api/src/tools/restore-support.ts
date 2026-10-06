import type { AuditEntry } from "../audit/audit-log.js";
import type { PrivilegedRoster, RestoreValidationReport, RosterDelta } from "../data/restore.js";
import { rosterDeltaIsEmpty } from "../data/restore.js";

/**
 * The offline restore CLI's pure parts (7b-3) — argument parsing, the
 * maintenance-page probe's verdict, the forensic audit entry, and the human-facing
 * rendering. Split out from `restore.ts` for the reason `assert-gate-in-sync.ts`
 * splits from `lib/gate-in-sync.ts`: the entrypoint is I/O and process handling,
 * and everything a test would want to assert on lives here.
 */

/** Everything the CLI accepts. Defaults are the *safe* end of each choice. */
export interface RestoreOptions {
  /** A snapshot file on disk (mutually exclusive with {@link object}). */
  file: string | null;
  /** A snapshot object in the backup bucket; the literal `latest` resolves it. */
  object: string | null;
  /** The backup bucket; defaults to `<project>-backups`, as provisioned. */
  bucket: string | null;
  projectId: string | null;
  /**
   * The Firestore database inside the target project; `null` means `(default)`,
   * which is every live environment. A named database exists for one caller — the
   * backup-integrity job (D102/D151), which restores into a per-run database in the
   * separate `pbe-book-verify` project and deletes it afterwards. `--confirm` still
   * names the *project*, deliberately: the project id is the discriminator this tool
   * and its out-of-band siblings (D181) share, and D151 put the throwaway database in
   * its own project precisely so that discriminator keeps meaning something.
   */
  database: string | null;
  /** Must equal the resolved project id before anything is written. */
  confirm: string | null;
  /** Where the safety snapshot, restore report and Ghost report are written. */
  outDir: string;
  /** The origin probed for the maintenance page; defaults to `<project>.web.app`. */
  hostingUrl: string | null;
  dryRun: boolean;
  /** Skip the maintenance-page pre-flight (the ephemeral-environment case). */
  force: boolean;
  allowEmulator: boolean;
  /**
   * Downgrade the cross-profile email-uniqueness rule from a refusal to a warning.
   *
   * Exists because D97 anticipates duplicates surviving in live data — it names
   * fail-closed sign-in resolution as "the backstop for a duplicate slipped in by
   * the genesis load or a migration" — so a snapshot taken while one existed is a
   * *legitimate* archive of a state Book tolerates and reports. Without an escape
   * hatch, one such duplicate anywhere in the roster would make every backup taken
   * since permanently unrestorable, and would do it during the outage the tool
   * exists to end. It stays a refusal by default because D101 names email
   * uniqueness as a structural rule and a *tampered* snapshot is the case that rule
   * guards; the flag makes proceeding a decision someone took, recorded in the
   * restore report, rather than a silence.
   */
  allowDuplicateEmails: boolean;
  skipGhostAudit: boolean;
  safetySnapshot: boolean;
  /**
   * Deliver the forensic privileged-roster entry to Cloud Logging (D101/D150). Off
   * only under `--no-forensic-entry`, which the integrity job passes and which
   * {@link parseArgs} refuses unless `--database` names a non-default database — so
   * the record of a restore into a live environment can never be silenced (D192).
   */
  forensicEntry: boolean;
  help: boolean;
}

/** The literal that asks the bucket for its newest snapshot rather than a name. */
export const LATEST_OBJECT = "latest";

/** Firestore's name for a project's default database — the one every live environment uses. */
export const DEFAULT_DATABASE = "(default)";

/**
 * A named Firestore database id: 4–63 characters, lowercase letters, digits and
 * hyphens, starting with a letter and ending with a letter or digit
 * (https://cloud.google.com/firestore/docs/manage-databases#database_id). Checked
 * here so a typo is a usage error before anything connects, not a server error
 * after the snapshot has been read.
 */
const DATABASE_ID = /^[a-z][a-z0-9-]{2,61}[a-z0-9]$/;

/** Where artifacts land unless `--out-dir` says otherwise. Gitignored (real PII). */
export const DEFAULT_OUT_DIR = "restore-artifacts";

function defaults(): RestoreOptions {
  return {
    file: null,
    object: null,
    bucket: null,
    projectId: null,
    database: null,
    confirm: null,
    outDir: DEFAULT_OUT_DIR,
    hostingUrl: null,
    dryRun: false,
    force: false,
    allowEmulator: false,
    allowDuplicateEmails: false,
    skipGhostAudit: false,
    safetySnapshot: true,
    forensicEntry: true,
    help: false,
  };
}

const VALUE_FLAGS = new Set([
  "--file",
  "--object",
  "--bucket",
  "--project",
  "--database",
  "--confirm",
  "--out-dir",
  "--hosting-url",
]);

function assign(options: RestoreOptions, flag: string, value: string): void {
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
    case "--confirm":
      options.confirm = value;
      break;
    case "--out-dir":
      options.outDir = value;
      break;
    default:
      options.hostingUrl = value;
      break;
  }
}

/** The flags that take no value — kept beside {@link setBoolean}, which decides them. */
const BOOLEAN_FLAGS = new Set([
  "--dry-run",
  "--force",
  "--allow-emulator",
  "--allow-duplicate-emails",
  "--skip-ghost-audit",
  "--no-safety-snapshot",
  "--no-forensic-entry",
  "--help",
  "-h",
]);

function setBoolean(options: RestoreOptions, flag: string): void {
  switch (flag) {
    case "--allow-duplicate-emails":
      options.allowDuplicateEmails = true;
      break;
    case "--dry-run":
      options.dryRun = true;
      break;
    case "--force":
      options.force = true;
      break;
    case "--allow-emulator":
      options.allowEmulator = true;
      break;
    case "--skip-ghost-audit":
      options.skipGhostAudit = true;
      break;
    case "--no-safety-snapshot":
      options.safetySnapshot = false;
      break;
    case "--no-forensic-entry":
      options.forensicEntry = false;
      break;
    case "--help":
    case "-h":
      options.help = true;
      break;
    default:
      break;
  }
}

/**
 * A value flag's value: inline after `=`, or else the next token — but never a next
 * token that looks like a flag (see {@link scanFlags}). `null` means "needs a
 * value"; `last` is the index of the last token consumed.
 */
function readValue(
  argv: readonly string[],
  index: number,
  equals: number,
): { value: string | null; last: number } {
  if (equals !== -1) {
    const inline = (argv[index] ?? "").slice(equals + 1);
    return { value: inline === "" ? null : inline, last: index };
  }
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("-")) {
    return { value: null, last: index };
  }
  return { value: next === "" ? null : next, last: index + 1 };
}

/** One recognized flag, in command-line order; `value` is null for a boolean flag. */
export interface ScannedFlag {
  flag: string;
  value: string | null;
}

/**
 * Split an argument vector into recognized flags. Accepts `--flag value` and
 * `--flag=value`. Shared by the restore and the integrity check (`verify-backup`),
 * so the rules below hold for both by construction rather than by two copies kept
 * in step. An unrecognized argument is an **error**, never a silent ignore: a
 * mistyped `--dry-runn` that parsed as "no flags given" would run a live restore,
 * which is the worst possible reading of a typo in this particular tool.
 *
 * TWO RULES THAT LOOK PEDANTIC AND ARE NOT (added in 7b-3 review). **A value flag
 * never consumes a token that looks like a flag**, and **a boolean flag rejects an
 * `=value` suffix** — both because the permissive readings turn a preview into a
 * live restore. `--out-dir "$DIR" --dry-run` with `$DIR` unset expands to
 * `--out-dir --dry-run`; a parser that takes the next token whatever it is sets
 * `outDir = "--dry-run"`, leaves `dryRun` false, raises nothing, and — if
 * `--confirm` is also present, as it would be in a command the operator copied and
 * edited — replaces every document in the database while its author believes they
 * asked for a preview. Refusing costs a legitimate value beginning with `-`, which
 * the inline `--flag=-value` form still expresses.
 */
export function scanFlags(
  argv: readonly string[],
  valueFlags: ReadonlySet<string>,
  booleanFlags: ReadonlySet<string>,
): { flags: ScannedFlag[]; errors: string[] } {
  const flags: ScannedFlag[] = [];
  const errors: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const equals = arg.indexOf("=");
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (valueFlags.has(flag)) {
      const { value, last } = readValue(argv, index, equals);
      index = last;
      if (value === null) {
        errors.push(`${flag} needs a value.`);
      } else {
        flags.push({ flag, value });
      }
    } else if (!booleanFlags.has(flag)) {
      errors.push(`Unrecognized argument: ${arg}`);
    } else if (equals !== -1) {
      errors.push(`${flag} takes no value (got ${arg}).`);
    } else {
      flags.push({ flag, value: null });
    }
  }
  return { flags, errors };
}

/** Parse the restore's argument vector — the flag rules are {@link scanFlags}'s. */
export function parseArgs(argv: readonly string[]): {
  options: RestoreOptions;
  errors: string[];
} {
  const options = defaults();
  const { flags, errors } = scanFlags(argv, VALUE_FLAGS, BOOLEAN_FLAGS);
  for (const { flag, value } of flags) {
    if (value === null) {
      setBoolean(options, flag);
    } else {
      assign(options, flag, value);
    }
  }
  checkCombinations(options, errors);
  return { options, errors };
}

/** The rules about which flags may appear together — judged after every flag is read. */
function checkCombinations(options: RestoreOptions, errors: string[]): void {
  if (options.file === null && options.object === null && !options.help) {
    errors.push("Give a snapshot: --file <path> or --object <name|latest>.");
  }
  if (options.file !== null && options.object !== null) {
    errors.push("--file and --object are mutually exclusive.");
  }
  if (!isDefaultDatabase(options.database) && !DATABASE_ID.test(options.database ?? "")) {
    errors.push(
      `--database "${options.database}" is not a valid Firestore database id (lowercase letters, digits and hyphens, 4–63 characters, starting with a letter).`,
    );
  }
  // D192: the forensic entry may be withheld only from a restore into a named,
  // throwaway database. Refusing here — not merely warning — is what makes the flag
  // safe to exist: no spelling of a restore into a live environment's `(default)`
  // database can leave that restore unrecorded.
  if (!options.forensicEntry && isDefaultDatabase(options.database)) {
    errors.push(
      "--no-forensic-entry is only for a restore into a named, throwaway database (--database <id>); a restore into a project's default database is always recorded.",
    );
  }
}

/** Whether a `--database` value means the project's default database. */
export function isDefaultDatabase(database: string | null): boolean {
  return database === null || database === DEFAULT_DATABASE;
}

/**
 * How the tool names its target everywhere it prints one — the target line, the
 * dry-run lines, the refusal. A named database is always spelled out, so an
 * operator can never read "pbe-book-verify" and miss which database in it the run
 * is about to replace; the default database keeps the bare project id every
 * existing runbook line already shows.
 */
export function describeTarget(projectId: string, database: string | null): string {
  return isDefaultDatabase(database) ? projectId : `${projectId}, database "${database}"`;
}

/**
 * The marker the maintenance page carries (`infra/maintenance-site/maintenance.html`;
 * `scripts/lib/maintenance.test.ts` asserts the two agree).
 * Matching on the visible heading rather than a build-generated hash keeps the
 * probe honest across rebuilds; the page is deliberately static and hand-written.
 */
export const MAINTENANCE_MARKER = "Down for maintenance";

/**
 * The path the pre-flight probes — deliberately **not** the origin root.
 *
 * Until D187, `firebase.maintenance.json` published `apps/web/dist`, which still
 * contains `index.html` and every built asset, and Firebase Hosting prefers a
 * matching static file over a rewrite. So while Book was "down", the bare origin
 * still served the real SPA (measured on staging during the 7b-3 live test; OFC-334).
 * D187 gave the maintenance config a public directory holding only the page, so
 * `/` now serves it too. The probe stays on `/api/health` anyway, deliberately:
 * nothing under `/api/` can ever be a static file, so it is the one path whose
 * answer depends only on which Hosting config is live — the rewrite in maintenance,
 * Cloud Run otherwise — whatever the public directory holds. Do not "simplify" it
 * to `/`.
 */
export const MAINTENANCE_PROBE_PATH = "/api/health";

/**
 * Whether the origin is serving the maintenance page (D118/N69 swapped the whole
 * Hosting config, so *every* path returns it). The pre-flight refuses a restore
 * when this is false: replacing the three collections underneath a live instance
 * would leave the cache authoritative over data that no longer exists, and the
 * single instance would keep serving and *writing* against it (D83).
 */
export function isMaintenancePage(html: string): boolean {
  return html.includes(MAINTENANCE_MARKER);
}

/**
 * The forensic privileged-roster entry (D101). `count` is the **usable**-admin
 * total, deliberately: a roster line that says three admins when all three are
 * deceased would misreport the only thing an operator needs to know afterwards —
 * whether anyone can still administer Book.
 *
 * The delta fields are present only when the prior roster was readable, which is
 * D101's own condition and, in practice, means the safety snapshot was taken.
 */
export function buildRestoreAuditEntry(
  roster: PrivilegedRoster,
  delta: RosterDelta | null,
): AuditEntry {
  return {
    action: "restore",
    outcome: "ok",
    count: roster.usableAdminIds.length,
    adminIds: roster.adminIds,
    managerIds: roster.managerIds,
    ...(delta === null
      ? {}
      : { adminIdsAdded: delta.adminIdsAdded, adminIdsRemoved: delta.adminIdsRemoved }),
  };
}

const ids = (list: readonly number[]): string =>
  list.length === 0 ? "none" : list.map((id) => `#${id}`).join(", ");

/** The validation verdict as printable lines — every issue, grouped by rule. */
export function renderValidationReport(report: RestoreValidationReport): string[] {
  const lines = [
    `Snapshot contents: ${report.counts.profiles} profiles, ${report.counts.users} users, ${report.counts.config} config.`,
  ];
  for (const warning of report.warnings) {
    lines.push(`  warning [${warning.rule}] ${warning.message}`);
  }
  for (const error of report.errors) {
    lines.push(`  ERROR   [${error.rule}] ${error.message}`);
  }
  lines.push(
    report.errors.length === 0
      ? `Structural validation PASSED (${report.warnings.length} warning(s)).`
      : `Structural validation FAILED: ${report.errors.length} error(s), ${report.warnings.length} warning(s). Nothing was written.`,
  );
  return lines;
}

/** The roster and its delta as printable lines — the operator's copy of the entry. */
export function renderRosterSummary(roster: PrivilegedRoster, delta: RosterDelta | null): string[] {
  const lines = [
    `Privileged roster after restore: ${roster.adminIds.length} admin(s) — ${ids(roster.adminIds)}`,
    `  of which usable (can actually administer): ${roster.usableAdminIds.length} — ${ids(roster.usableAdminIds)}`,
    `  managers: ${roster.managerIds.length} — ${ids(roster.managerIds)}`,
  ];
  if (roster.usableAdminIds.length === 0) {
    lines.push(
      "  ⚠ NO USABLE ADMIN in the restored data — nobody can administer Book until this is fixed.",
    );
  }
  if (delta === null) {
    lines.push("Roster delta: prior state was not readable (no safety snapshot was taken).");
    return lines;
  }
  if (rosterDeltaIsEmpty(delta)) {
    lines.push("Roster delta: no privileged-role changes.");
    return lines;
  }
  lines.push(
    `Roster delta: admins added ${ids(delta.adminIdsAdded)}; admins removed ${ids(delta.adminIdsRemoved)}`,
    `              managers added ${ids(delta.managerIdsAdded)}; managers removed ${ids(delta.managerIdsRemoved)}`,
    "  ⚠ Review these against what you expected the restore to change (D101).",
  );
  return lines;
}

/**
 * Is the origin serving the maintenance page? `null` means the probe itself failed
 * — a refused connection or a DNS failure, which is *consistent* with a down
 * environment but does not prove the edge swap happened.
 *
 * Both `false` and `null` refuse the restore. Treating "I could not tell" as a pass
 * is what makes a fat-fingered `--hosting-url`, a project whose Hosting site name
 * differs from `<project>.web.app`, or a momentary network failure silently
 * equivalent to "Book is down" — and the consequence of getting that wrong is the
 * whole reason the pre-flight exists: the single instance keeps serving its
 * pre-restore cache as authoritative (there is no Firestore listener) and any edit
 * it accepts writes into the collections being replaced. `--force` is the documented
 * way to say "this environment has no Hosting", and it is one word.
 */
export async function probeMaintenance(origin: string): Promise<boolean | null> {
  try {
    // Probe `/api/health`, NOT the origin root — see MAINTENANCE_PROBE_PATH. A
    // path under `/api/` can never be a static file, so it is governed by the
    // rewrite in maintenance and answered by Cloud Run when Book is up, whatever
    // the maintenance config's public directory holds — which makes it the only
    // honest probe of the state this pre-flight cares about.
    const response = await fetch(`${origin.replace(/\/+$/, "")}${MAINTENANCE_PROBE_PATH}`, {
      redirect: "follow",
    });
    return isMaintenancePage(await response.text());
  } catch {
    return null;
  }
}

/**
 * Why an operator tool must not write yet, or `null` when `origin` is serving the
 * maintenance page. Shared by the tools whose pre-flight has the same two
 * refusals (`headshots:bulk`, `renumber --purge-sessions`) so the wording and the
 * probe cannot drift between them; see {@link probeMaintenance} for why "could not
 * tell" refuses too.
 */
export async function maintenanceRefusal(origin: string): Promise<string | null> {
  const inMaintenance = await probeMaintenance(origin);
  if (inMaintenance === true) {
    return null;
  }
  return inMaintenance === false
    ? `${origin} is not serving the maintenance page. Run infra/maintenance-begin.sh first.`
    : `${origin} did not answer, so this cannot confirm Book is down. Check --hosting-url.`;
}
