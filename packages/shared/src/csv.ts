/**
 * The general role-projected CSV export (DATABASE-SCHEMA §10; DECISIONS D41/D92,
 * finding S9). Export is **client-side** over the already-projected in-memory
 * dataset, so it inherits the server-side visibility projection for free (D4/D5):
 * a manager's file omits values behind off-toggles, an admin's includes them, and
 * no field a role can't see appears at all. This module is the single source for
 * the column set, the cell formatting, and the formula-injection neutralization,
 * shared so the (future) bulk import reads the same format.
 *
 * The column *set is role-aware*: a column is emitted only when the role may see
 * its underlying field (§10 — `adminNote`, the consent flags, `verifiedBy`, and
 * the status flags appear only in manager/admin exports). The column *values*
 * then come straight from each projected record, blank where absent.
 */

import type { PrivacyFlags, Profile, Role } from "./types.js";
import { FIELD_VISIBILITY, fieldVisibleToRole } from "./visibility.js";

/** A record as the client holds it after projection — the shared shape, fields optional. */
type ProjectedProfile = Partial<Profile> & Pick<Profile, "id">;

/** A CSV column: its header, the `Profile` field that gates its visibility, and its cell text. */
interface CsvColumn {
  header: string;
  /** The owning `Profile` field — its visibility class decides if the column appears. */
  field: keyof Profile;
  get: (profile: ProjectedProfile) => string;
}

/** Render any scalar as a cell string; absent/null → empty. */
function str(value: unknown): string {
  return value == null ? "" : String(value);
}

/** Render a boolean cell as `true`/`false` (round-trips cleanly); absent → empty. */
function boolStr(value: boolean | undefined): string {
  return value === undefined ? "" : value ? "true" : "false";
}

/** The canonical column order (§10), `id` first. Each names the field that gates it. */
const COLUMNS: readonly CsvColumn[] = [
  { header: "id", field: "id", get: (p) => str(p.id) },
  { header: "firstName", field: "firstName", get: (p) => str(p.firstName) },
  { header: "middleName", field: "middleName", get: (p) => str(p.middleName) },
  { header: "lastName", field: "lastName", get: (p) => str(p.lastName) },
  { header: "fullLegalName", field: "fullLegalName", get: (p) => str(p.fullLegalName) },
  { header: "mugName", field: "mugName", get: (p) => str(p.mugName) },
  { header: "classYear", field: "classYear", get: (p) => str(p.classYear) },
  { header: "email", field: "email", get: (p) => str(p.email) },
  { header: "alternateEmail", field: "alternateEmail", get: (p) => str(p.alternateEmail) },
  { header: "phone", field: "phone", get: (p) => str(p.phone) },
  { header: "address.street1", field: "address", get: (p) => str(p.address?.street1) },
  { header: "address.street2", field: "address", get: (p) => str(p.address?.street2) },
  { header: "address.street3", field: "address", get: (p) => str(p.address?.street3) },
  { header: "address.city", field: "address", get: (p) => str(p.address?.city) },
  { header: "address.stateProvince", field: "address", get: (p) => str(p.address?.stateProvince) },
  { header: "address.postalCode", field: "address", get: (p) => str(p.address?.postalCode) },
  { header: "address.country", field: "address", get: (p) => str(p.address?.country) },
  { header: "employerName", field: "employerName", get: (p) => str(p.employerName) },
  { header: "jobTitle", field: "jobTitle", get: (p) => str(p.jobTitle) },
  { header: "spousePartnerName", field: "spousePartnerName", get: (p) => str(p.spousePartnerName) },
  { header: "bigBrotherId", field: "bigBrotherId", get: (p) => str(p.bigBrotherId) },
  { header: "majors", field: "majors", get: (p) => (p.majors ?? []).join(";") },
  ...emergencyColumns(0),
  ...emergencyColumns(1),
  ...linkColumns(0),
  ...linkColumns(1),
  ...linkColumns(2),
  ...linkColumns(3),
  ...linkColumns(4),
  { header: "deceased.isDeceased", field: "deceased", get: (p) => boolStr(p.deceased?.isDeceased) },
  { header: "deceased.dateOfDeath", field: "deceased", get: (p) => str(p.deceased?.dateOfDeath) },
  { header: "deceased.birthYear", field: "deceased", get: (p) => str(p.deceased?.birthYear) },
  { header: "deceased.deathYear", field: "deceased", get: (p) => str(p.deceased?.deathYear) },
  { header: "deceased.obituaryUrl", field: "deceased", get: (p) => str(p.deceased?.obituaryUrl) },
  {
    header: "deceased.inMemoriamUrl",
    field: "deceased",
    get: (p) => str(p.deceased?.inMemoriamUrl),
  },
  {
    header: "debrothered.isDebrothered",
    field: "debrothered",
    get: (p) => boolStr(p.debrothered?.isDebrothered),
  },
  { header: "unlisted", field: "unlisted", get: (p) => boolStr(p.unlisted) },
  { header: "privacy.shareEmail", field: "privacy", get: (p) => boolStr(p.privacy?.shareEmail) },
  { header: "privacy.sharePhone", field: "privacy", get: (p) => boolStr(p.privacy?.sharePhone) },
  {
    header: "privacy.shareAddress",
    field: "privacy",
    get: (p) => boolStr(p.privacy?.shareAddress),
  },
  {
    header: "privacy.shareEmergency",
    field: "privacy",
    get: (p) => boolStr(p.privacy?.shareEmergency),
  },
  {
    header: "privacy.shareSpousePartner",
    field: "privacy",
    get: (p) => boolStr(p.privacy?.shareSpousePartner),
  },
  {
    header: "allowNewsletterEmail",
    field: "allowNewsletterEmail",
    get: (p) => boolStr(p.allowNewsletterEmail),
  },
  {
    header: "allowShareWithMITAA",
    field: "allowShareWithMITAA",
    get: (p) => boolStr(p.allowShareWithMITAA),
  },
  { header: "lastVerifiedDate", field: "lastVerifiedDate", get: (p) => str(p.lastVerifiedDate) },
  { header: "verifiedBy", field: "verifiedBy", get: (p) => str(p.verifiedBy) },
  { header: "adminNote", field: "adminNote", get: (p) => str(p.adminNote) },
];

function emergencyColumns(i: number): CsvColumn[] {
  const n = i + 1;
  return (["name", "phone", "email"] as const).map((part) => ({
    header: `emergency${n}.${part}`,
    field: "emergencyContacts" as const,
    get: (p: ProjectedProfile) => str(p.emergencyContacts?.[i]?.[part]),
  }));
}

function linkColumns(i: number): CsvColumn[] {
  const n = i + 1;
  return (["label", "url"] as const).map((part) => ({
    header: `link${n}.${part}`,
    field: "links" as const,
    get: (p: ProjectedProfile) => str(p.links?.[i]?.[part]),
  }));
}

/** Every share-flag on, so a toggle-class column is included for every role (rows blank when off). */
const ALL_SHARES_ON: PrivacyFlags = {
  shareEmail: true,
  sharePhone: true,
  shareAddress: true,
  shareEmergency: true,
  shareSpousePartner: true,
};

/** The columns a role's export includes — gated by the same visibility table the server enforces. */
function columnsForRole(role: Role): CsvColumn[] {
  return COLUMNS.filter((column) =>
    fieldVisibleToRole(FIELD_VISIBILITY[column.field], role, ALL_SHARES_ON),
  );
}

/**
 * Characters that make a spreadsheet treat a leading cell as a formula (OWASP /
 * S9). Besides the four formula sigils, this covers every line-break/whitespace
 * control an importer may strip off the front of a cell before evaluating what
 * follows: tab, CR, **LF (OFC-99 — a `\n=…` cell was slipping through)**, vertical
 * tab, form feed, next-line (NEL), and the Unicode line/paragraph separators.
 */
const FORMULA_LEADERS = new Set([
  "=",
  "+",
  "-",
  "@",
  "\t",
  "\r",
  "\n",
  "\v",
  "\f",
  "\u0085", // next line (NEL)
  "\u2028", // line separator
  "\u2029", // paragraph separator
]);

/**
 * Neutralize a formula-injection attempt: a cell beginning with `= + - @`, or any
 * line-break/whitespace control an importer might strip (tab, CR, LF, …), is
 * prefixed with a single quote so the spreadsheet renders it as text rather than
 * executing it (DATABASE-SCHEMA §10, finding S9). Applied to every cell, in both
 * this export and the MITAA export.
 */
export function neutralizeCsvCell(value: string): string {
  return value.length > 0 && FORMULA_LEADERS.has(value[0] as string) ? `'${value}` : value;
}

/** RFC-4180 escaping: wrap in quotes (doubling internal quotes) when the cell needs it. */
function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Format one cell: neutralize a formula leader, then RFC-4180-escape. */
function formatCell(value: string): string {
  return escapeCsvCell(neutralizeCsvCell(value));
}

/**
 * Serialize the projected directory to a role-appropriate CSV string (§10).
 * `rows` are already projected to the caller's role, so this only chooses the
 * column set for that role and renders each cell. Lines are CRLF-terminated
 * (RFC 4180 / Excel). Images are never included.
 */
export function profilesToCsv(rows: readonly ProjectedProfile[], role: Role): string {
  const columns = columnsForRole(role);
  const header = columns.map((c) => formatCell(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => formatCell(c.get(row))).join(","));
  return [header, ...lines].join("\r\n");
}
