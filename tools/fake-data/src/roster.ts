/**
 * The UAT tester roster: parsing, validation and id assignment (D156; OFC-248).
 *
 * Pure — no Firestore, no Ghost, no GCS — so the rules that decide **who becomes an
 * admin** and **which profile ids get overwritten** are testable without touching a
 * cloud project. `seed-staging-testers.ts` is the I/O shell around it.
 *
 * ⚠ The roster's *content* is real brothers' names and email addresses. It lives as
 * a private GCS object and must never enter this PUBLIC repo — not as a fixture, not
 * in a test, not in a log line, not in a PR description. Tests here use the fake
 * exemplar space (James Smyth '84, #5247).
 */
import { FAKE_ID_FLOOR, type Role, TESTER_ID_FLOOR } from "@pbe/shared";

/** The columns a roster CSV may carry. Only `firstName`/`lastName`/`email` are required. */
const COLUMNS = ["profileId", "firstName", "lastName", "classYear", "email", "role"] as const;

const ROLES: readonly Role[] = ["brother", "manager", "admin"];

/** One validated roster row, with its profile id resolved. */
export interface RosterEntry {
  readonly profileId: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly classYear: number | null;
  readonly email: string;
  readonly role: Role;
  /** 1-based line number in the source CSV, for error messages. */
  readonly line: number;
}

export interface ParseOptions {
  /**
   * Permit a row to claim an id inside the generated block (`>= FAKE_ID_FLOOR`,
   * below `TESTER_ID_FLOOR`), overwriting a generated fixture. Off by default: the
   * generated low ids are deliberate test fixtures (the collision pair, the two
   * admins, the managers) and silently consuming one is a real loss of coverage.
   */
  readonly allowFixtureOverwrite?: boolean;
}

/** Raised for any malformed roster; the message names the CSV line. */
export class RosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterError";
  }
}

/**
 * Split one CSV line into fields, honouring double-quoted values.
 *
 * Hand-rolled rather than pulling a dependency: the roster is a handful of rows of
 * names and addresses, and the only thing a general parser would buy is handling of
 * embedded newlines, which a name or an email cannot contain. Quoting still matters
 * — a `lastName` of `Smyth, Jr.` is entirely plausible — so quotes and the doubled
 * `""` escape are supported.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/**
 * Parse and validate a roster CSV into entries with assigned profile ids.
 *
 * **Role defaulting** *(Forrest's call)*: the **first data row is the default test
 * admin** — normally Forrest — and every later row defaults to `brother`, the role
 * nearly every real user holds (UAT-PLAN §5). An explicit `role` value overrides
 * either, which is also how a tester's post-bug-report promotion to `manager`
 * survives a reseed: edit the roster row rather than only the live record.
 *
 * **Id assignment**: a blank `profileId` takes the next free id from
 * {@link TESTER_ID_FLOOR}, so a roster of any size from zero to dozens just works
 * without anyone hand-numbering it. An explicit id is honoured but guarded.
 */
export function parseRoster(csv: string, options: ParseOptions = {}): RosterEntry[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new RosterError("Roster is empty — expected a header row.");
  }

  const header = splitCsvLine(lines[0] as string).map((h) => h.toLowerCase());
  const index = new Map(COLUMNS.map((c) => [c, header.indexOf(c.toLowerCase())]));
  for (const required of ["firstName", "lastName", "email"] as const) {
    if ((index.get(required) ?? -1) === -1) {
      throw new RosterError(
        `Roster header is missing the required "${required}" column. Expected: ${COLUMNS.join(", ")}.`,
      );
    }
  }

  // A header with no data rows is legitimate and means "no testers" — the caller
  // provisions nobody. Only a file with no header at all is an error.
  const rows = lines.slice(1);
  const entries: RosterEntry[] = [];
  const takenIds = new Set<number>();
  const takenEmails = new Set<string>();
  let nextAutoId = TESTER_ID_FLOOR;

  const field = (cells: string[], name: (typeof COLUMNS)[number]): string => {
    const at = index.get(name) ?? -1;
    return at === -1 ? "" : (cells[at] ?? "");
  };

  for (const [offset, raw] of rows.entries()) {
    const line = offset + 2; // 1-based, and the header is line 1
    const cells = splitCsvLine(raw);

    const firstName = field(cells, "firstName");
    const lastName = field(cells, "lastName");
    const email = field(cells, "email");
    if (!firstName || !lastName) {
      throw new RosterError(`Line ${line}: firstName and lastName are both required.`);
    }
    if (!email || !email.includes("@")) {
      // ⚠ Never echo the offending VALUE, only its position. A malformed row is a
      // likely hand-editing slip, and the value in an email column is a real
      // brother's address (or something very close to it) — this message reaches
      // `console.error` and, from the deploy workflow, a world-readable Actions log
      // on a PUBLIC repo. The line and column are enough to fix the CSV.
      throw new RosterError(
        `Line ${line}: the email column is missing or not email-shaped. (Value withheld — it is real PII and this message reaches public CI logs.)`,
      );
    }
    const emailKey = email.toLowerCase();
    if (takenEmails.has(emailKey)) {
      // Book enforces email uniqueness in its own index (D97); a duplicate here
      // would produce two profiles racing for one sign-in, so refuse up front where
      // the line number can be named rather than letting Firestore decide.
      throw new RosterError(`Line ${line}: duplicate email — already used earlier in the roster.`);
    }
    takenEmails.add(emailKey);

    const rawClassYear = field(cells, "classYear");
    let classYear: number | null = null;
    if (rawClassYear) {
      const parsed = Number(rawClassYear);
      if (!Number.isInteger(parsed) || parsed < 1890 || parsed > 2100) {
        throw new RosterError(
          `Line ${line}: classYear "${rawClassYear}" is not a plausible four-digit year (PBE was founded in 1890).`,
        );
      }
      classYear = parsed;
    }

    const rawRole = field(cells, "role").toLowerCase();
    let role: Role;
    if (rawRole) {
      if (!ROLES.includes(rawRole as Role)) {
        throw new RosterError(
          `Line ${line}: role "${rawRole}" must be one of ${ROLES.join(", ")}.`,
        );
      }
      role = rawRole as Role;
    } else {
      role = entries.length === 0 ? "admin" : "brother";
    }

    const rawId = field(cells, "profileId");
    let profileId: number;
    if (rawId) {
      const parsed = Number(rawId);
      if (!Number.isInteger(parsed)) {
        throw new RosterError(`Line ${line}: profileId "${rawId}" is not an integer.`);
      }
      if (parsed < FAKE_ID_FLOOR) {
        // D65's invariant, enforced in code rather than left to convention: ids
        // below the floor are reserved for REAL signing numbers, and a tester row
        // carries a real name and a real address — exactly the record that must
        // stay identifiable as fake from its id alone.
        throw new RosterError(
          `Line ${line}: profileId ${parsed} is below FAKE_ID_FLOOR (${FAKE_ID_FLOOR}). Ids below that are reserved for real Constitution numbers (D65).`,
        );
      }
      if (parsed < TESTER_ID_FLOOR && !options.allowFixtureOverwrite) {
        throw new RosterError(
          `Line ${line}: profileId ${parsed} is inside the generated block (${FAKE_ID_FLOOR}–${TESTER_ID_FLOOR - 1}) and would overwrite a deliberate test fixture — the Canonical Name collision pair, an admin fixture or a manager. Pass --allow-fixture-overwrite if you mean it.`,
        );
      }
      profileId = parsed;
    } else {
      while (takenIds.has(nextAutoId)) {
        nextAutoId++;
      }
      profileId = nextAutoId;
      nextAutoId++;
    }

    if (takenIds.has(profileId)) {
      throw new RosterError(
        `Line ${line}: profileId ${profileId} is already claimed by an earlier row.`,
      );
    }
    takenIds.add(profileId);

    entries.push({ profileId, firstName, lastName, classYear, email, role, line });
  }

  return entries;
}
