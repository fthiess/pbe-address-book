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
  help: boolean;
}

/** The literal that asks the bucket for its newest snapshot rather than a name. */
export const LATEST_OBJECT = "latest";

/** Where artifacts land unless `--out-dir` says otherwise. Gitignored (real PII). */
export const DEFAULT_OUT_DIR = "restore-artifacts";

function defaults(): RestoreOptions {
  return {
    file: null,
    object: null,
    bucket: null,
    projectId: null,
    confirm: null,
    outDir: DEFAULT_OUT_DIR,
    hostingUrl: null,
    dryRun: false,
    force: false,
    allowEmulator: false,
    allowDuplicateEmails: false,
    skipGhostAudit: false,
    safetySnapshot: true,
    help: false,
  };
}

const VALUE_FLAGS = new Set([
  "--file",
  "--object",
  "--bucket",
  "--project",
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
  "--help",
  "-h",
]);

function setBoolean(options: RestoreOptions, flag: string): boolean {
  switch (flag) {
    case "--allow-duplicate-emails":
      options.allowDuplicateEmails = true;
      return true;
    case "--dry-run":
      options.dryRun = true;
      return true;
    case "--force":
      options.force = true;
      return true;
    case "--allow-emulator":
      options.allowEmulator = true;
      return true;
    case "--skip-ghost-audit":
      options.skipGhostAudit = true;
      return true;
    case "--no-safety-snapshot":
      options.safetySnapshot = false;
      return true;
    case "--help":
    case "-h":
      options.help = true;
      return true;
    default:
      return false;
  }
}

/**
 * Parse the argument vector. Accepts `--flag value` and `--flag=value`. An
 * unrecognized argument is an **error**, never a silent ignore: a mistyped
 * `--dry-runn` that parsed as "no flags given" would run a live restore, which is
 * the worst possible reading of a typo in this particular tool.
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
export function parseArgs(argv: readonly string[]): {
  options: RestoreOptions;
  errors: string[];
} {
  const options = defaults();
  const errors: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const equals = arg.indexOf("=");
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (VALUE_FLAGS.has(flag)) {
      let value = equals === -1 ? undefined : arg.slice(equals + 1);
      if (value === undefined) {
        const next = argv[index + 1];
        if (next === undefined || next.startsWith("-")) {
          errors.push(`${flag} needs a value.`);
          continue;
        }
        value = next;
        index++;
      }
      if (value === "") {
        errors.push(`${flag} needs a value.`);
        continue;
      }
      assign(options, flag, value);
      continue;
    }
    if (BOOLEAN_FLAGS.has(flag) && equals !== -1) {
      errors.push(`${flag} takes no value (got ${arg}).`);
      continue;
    }
    if (!setBoolean(options, flag)) {
      errors.push(`Unrecognized argument: ${arg}`);
    }
  }
  if (options.file === null && options.object === null && !options.help) {
    errors.push("Give a snapshot: --file <path> or --object <name|latest>.");
  }
  if (options.file !== null && options.object !== null) {
    errors.push("--file and --object are mutually exclusive.");
  }
  return { options, errors };
}

/**
 * The marker the maintenance page carries (`apps/web/public/maintenance.html`).
 * Matching on the visible heading rather than a build-generated hash keeps the
 * probe honest across rebuilds; the page is deliberately static and hand-written.
 */
export const MAINTENANCE_MARKER = "Down for maintenance";

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
