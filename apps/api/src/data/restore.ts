import { type Profile, isUsableAdmin, normalizeEmail } from "@pbe/shared";
import type { BackupData, CollectionSnapshot, ImageManifestEntry } from "./backup.js";
import { BACKUP_SNAPSHOT_VERSION } from "./backup.js";
import { normalizeHydratedProfile } from "./cache.js";

/**
 * The offline restore's **reader and structural validator** (D101; 7b-3) — the
 * mirror of `backup.ts`, and deliberately pure: it parses a snapshot envelope and
 * judges it, and touches neither Firestore nor the filesystem. The write half is
 * `restore-executor.ts`; the operator entrypoint is `tools/restore.ts`.
 *
 * WHY VALIDATION EXISTS AT ALL, GIVEN D63. A restore means "be exactly this
 * snapshot", not "merge corrections", so field-level **edit** rules are
 * intentionally bypassed — {@link validateProfile} is never called here, and a
 * record that could not be *saved* through the API today still restores verbatim
 * (a legacy phone format, a missing optional field, a role the UI would refuse to
 * set). What D101 keeps is the narrower, dataset-level question: is this snapshot
 * a *structurally coherent database*? Restore is the one writer that is not the
 * single live instance (D83/D100), so it is the last place uniqueness and
 * referential rules can be enforced before a corrupt or tampered archive becomes
 * the directory.
 *
 * ERRORS REFUSE, WARNINGS DO NOT. The split is not severity but **whether the
 * running system already tolerates the condition**. A big-brother cycle or a
 * duplicated email cannot be produced by any live write path, so its presence
 * means the snapshot is broken or tampered with: refuse. A `users` document with
 * no matching profile, by contrast, is a condition Book *already* has a name and a
 * report for — `bookInternalOrphan` in the reconciliation audit (D98/D99) — so a
 * legitimate backup taken while one existed must stay restorable, or the validator
 * would make a real archive unusable over a discrepancy the system reports and
 * shrugs at. Warnings are printed, counted, and carried into the restore report.
 */

/** The collections a restore replaces — the three durable ones (D63/N61). */
export const RESTORE_COLLECTIONS = ["profiles", "users", "config"] as const;
export type RestoreCollection = (typeof RESTORE_COLLECTIONS)[number];

/** The `config` document ids Book knows about (DATABASE-SCHEMA §6.3). */
const KNOWN_CONFIG_DOC_IDS = new Set(["systemBanner"]);

/** Which D101 rule an issue belongs to — the report groups by this. */
export type RestoreRule =
  | "envelope"
  | "idUniqueness"
  | "emailUniqueness"
  | "referenceIntegrity"
  | "cycle";

/** One validation finding. Carries ids and field *names* only — never a value (D61). */
export interface RestoreIssue {
  rule: RestoreRule;
  message: string;
}

/** The verdict on a snapshot: `errors` refuse the restore, `warnings` never do. */
export interface RestoreValidationReport {
  errors: RestoreIssue[];
  warnings: RestoreIssue[];
  counts: Record<RestoreCollection, number>;
}

/** A snapshot parsed out of either envelope version, in one internal shape. */
export interface ParsedSnapshot {
  /** The envelope version it arrived in — 1 (manual, pre-7b-3) or 2. */
  version: number;
  generatedAt: string;
  collections: BackupData;
  /** Empty for a version-1 envelope, which predates the manifest. */
  images: ImageManifestEntry[];
}

/** Parsing either succeeds with a snapshot or fails with envelope issues. */
export type ParseResult =
  | { ok: true; snapshot: ParsedSnapshot }
  | { ok: false; errors: RestoreIssue[] };

function envelopeError(message: string): RestoreIssue {
  return { rule: "envelope", message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a `{ id, data }` collection array out of a parsed envelope, appending an
 * issue per malformed entry. A non-array collection is a fatal envelope fault; a
 * single bad entry inside one is reported and dropped, so the operator sees every
 * problem in one pass instead of fixing them one run at a time.
 */
function readCollection(
  raw: unknown,
  name: RestoreCollection,
  errors: RestoreIssue[],
): CollectionSnapshot[] {
  if (!Array.isArray(raw)) {
    errors.push(envelopeError(`\`collections.${name}\` is missing or is not an array.`));
    return [];
  }
  const docs: CollectionSnapshot[] = [];
  raw.forEach((entry, index) => {
    if (!isPlainObject(entry) || typeof entry.id !== "string" || entry.id === "") {
      errors.push(envelopeError(`\`${name}[${index}]\` has no string document id.`));
      return;
    }
    if (!isPlainObject(entry.data)) {
      errors.push(envelopeError(`\`${name}\` document "${entry.id}" has no object \`data\`.`));
      return;
    }
    docs.push({ id: entry.id, data: entry.data });
  });
  return docs;
}

/**
 * Parse a snapshot envelope: the automated **version 2** (`collections` + the
 * derived `images` manifest) or the manual download's **version 1**, which carried
 * `collections` alone.
 *
 * Version 1 stays readable deliberately. 7b-3 moved the D52 download onto the v2
 * envelope so one shape exists going forward (closing the question D147 parked for
 * this session), but any archive an admin downloaded *before* that change is a
 * v1 file sitting on somebody's disk — and the custodian of an off-platform archive
 * (D101) is entitled to have it still work. The manifest is the only difference,
 * and it is pure derivation from the profiles, so a v1 snapshot loses nothing a
 * restore needs.
 */
export function parseSnapshot(raw: unknown): ParseResult {
  const errors: RestoreIssue[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [envelopeError("The snapshot is not a JSON object.")] };
  }
  const { version, generatedAt, collections, images } = raw;
  if (version !== 1 && version !== BACKUP_SNAPSHOT_VERSION) {
    return {
      ok: false,
      errors: [
        envelopeError(
          `Unrecognized snapshot version ${JSON.stringify(version)} — this tool reads 1 and ${BACKUP_SNAPSHOT_VERSION}.`,
        ),
      ],
    };
  }
  if (typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt))) {
    errors.push(envelopeError("`generatedAt` is missing or is not an ISO-8601 instant."));
  }
  if (!isPlainObject(collections)) {
    errors.push(envelopeError("`collections` is missing or is not an object."));
    return { ok: false, errors };
  }
  const parsed: BackupData = {
    profiles: readCollection(collections.profiles, "profiles", errors),
    users: readCollection(collections.users, "users", errors),
    config: readCollection(collections.config, "config", errors),
  };
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    snapshot: {
      version,
      generatedAt: generatedAt as string,
      collections: parsed,
      images: Array.isArray(images) ? (images as ImageManifestEntry[]) : [],
    },
  };
}

/**
 * ID uniqueness (D101). Three distinct faults share the rule: a repeated document
 * key, a `data.id` that is not a positive integer, and — the one a naive check
 * misses — a `data.id` that disagrees with the document key it is stored under.
 * `backup.ts` captures the key explicitly so a restore is a *key-preserving
 * replay*; if the two ever diverge, the replay silently writes a record under a key
 * that contradicts its own contents, and every id-keyed lookup in Book (the cache,
 * the star scrub, the Ghost join) then disagrees about which brother this is.
 */
function checkIds(
  docs: readonly CollectionSnapshot[],
  name: RestoreCollection,
  errors: RestoreIssue[],
): Set<number> {
  const seenKeys = new Set<string>();
  const ids = new Set<number>();
  for (const doc of docs) {
    if (seenKeys.has(doc.id)) {
      errors.push({
        rule: "idUniqueness",
        message: `\`${name}\` contains more than one document with the id "${doc.id}".`,
      });
      continue;
    }
    seenKeys.add(doc.id);
    const id = doc.data.id;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      errors.push({
        rule: "idUniqueness",
        message: `\`${name}\` document "${doc.id}" has no positive integer \`id\` field.`,
      });
      continue;
    }
    if (String(id) !== doc.id) {
      errors.push({
        rule: "idUniqueness",
        message: `\`${name}\` document "${doc.id}" carries the conflicting \`id\` field ${id}.`,
      });
      continue;
    }
    ids.add(id);
  }
  return ids;
}

/** Add one address to the normalized claim index, skipping absent/blank values. */
function claimEmail(raw: unknown, id: number, index: Map<string, Set<number>>): string | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  const key = normalizeEmail(raw);
  const claimants = index.get(key);
  if (claimants) {
    claimants.add(id);
  } else {
    index.set(key, new Set([id]));
  }
  return key;
}

/**
 * Email uniqueness (D97/D101): primary and `alternateEmail` live in **one**
 * namespace, normalized, so no address appears twice anywhere in Book. Two faults:
 * an address claimed by two different records — the collision that lets a brother
 * authenticate onto someone else's profile, which is why D97 fails sign-in closed
 * on it — and a record whose own primary and alternate are the same address, which
 * the write path rejects and which therefore cannot occur in an untampered
 * snapshot.
 *
 * Addresses are never quoted into an issue message: the id pair identifies the
 * problem, and an audit-adjacent report is not a place for contact values (D61).
 */
function checkEmails(profiles: readonly CollectionSnapshot[], errors: RestoreIssue[]): void {
  const index = new Map<string, Set<number>>();
  for (const doc of profiles) {
    const id = doc.data.id;
    if (typeof id !== "number") {
      continue; // already reported by checkIds
    }
    const primary = claimEmail(doc.data.email, id, index);
    const alternate = claimEmail(doc.data.alternateEmail, id, index);
    if (primary !== null && primary === alternate) {
      errors.push({
        rule: "emailUniqueness",
        message: `Profile #${id} uses the same address as both its primary and alternate email.`,
      });
    }
  }
  for (const [, claimants] of index) {
    if (claimants.size > 1) {
      const ids = [...claimants].sort((a, b) => a - b);
      errors.push({
        rule: "emailUniqueness",
        message: `One email address is claimed by ${ids.length} profiles: ${ids.map((id) => `#${id}`).join(", ")}.`,
      });
    }
  }
}

/**
 * Reference integrity (D101). A dangling `bigBrotherId` is an **error**: the write
 * path refuses to create one, the lineage column dereferences it, and no live
 * operation can produce it. The `users`-side references are **warnings** — see the
 * module note; the reconciliation audit already reports both as discrepancies.
 */
function checkReferences(
  collections: BackupData,
  profileIds: ReadonlySet<number>,
  errors: RestoreIssue[],
  warnings: RestoreIssue[],
): void {
  for (const doc of collections.profiles) {
    const bigBrotherId = doc.data.bigBrotherId;
    if (bigBrotherId === undefined || bigBrotherId === null) {
      continue;
    }
    if (typeof bigBrotherId !== "number" || !Number.isInteger(bigBrotherId)) {
      errors.push({
        rule: "referenceIntegrity",
        message: `Profile "${doc.id}" has a \`bigBrotherId\` that is not an integer.`,
      });
      continue;
    }
    if (!profileIds.has(bigBrotherId)) {
      errors.push({
        rule: "referenceIntegrity",
        message: `Profile "${doc.id}" names big brother #${bigBrotherId}, who is not in the snapshot.`,
      });
    }
  }
  for (const doc of collections.users) {
    const id = doc.data.id;
    if (typeof id === "number" && !profileIds.has(id)) {
      warnings.push({
        rule: "referenceIntegrity",
        message: `\`users\` document #${id} has no profile in the snapshot (a bookInternalOrphan, D98).`,
      });
    }
    const stars = doc.data.stars;
    if (!Array.isArray(stars)) {
      continue;
    }
    const dangling = stars.filter((star) => typeof star !== "number" || !profileIds.has(star));
    if (dangling.length > 0) {
      warnings.push({
        rule: "referenceIntegrity",
        message: `\`users\` document "${doc.id}" stars ${dangling.length} id(s) with no profile in the snapshot.`,
      });
    }
  }
  for (const doc of collections.config) {
    if (!KNOWN_CONFIG_DOC_IDS.has(doc.id)) {
      warnings.push({
        rule: "referenceIntegrity",
        message: `\`config\` holds the unrecognized singleton "${doc.id}" — restored verbatim, but Book reads no such document.`,
      });
    }
  }
}

/**
 * Every big-brother cycle in the snapshot, each returned as the ids that form it.
 *
 * Deliberately **not** the route's `formsCycle` (`routes/profiles.ts`), which asks
 * a different question: would *this edit* close a loop back to the record being
 * edited. That check returns `false` for a pre-existing cycle elsewhere in the
 * graph — correct when the job is to refuse one bad edit, wrong when the job is to
 * judge a whole dataset, where the cycle is exactly what nobody was watching. It
 * is also private and cache-coupled, so a restore over raw documents could not
 * reuse it even if the semantics matched.
 *
 * An iterative walk with a per-node visit state, so a 1,200-record lineage chain
 * cannot blow the stack and each node is visited once. A self-reference
 * (`bigBrotherId === id`) is a cycle of length one and is caught by the same pass.
 */
export function detectCycles(parents: ReadonlyMap<number, number>): number[][] {
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<number, number>();
  const cycles: number[][] = [];

  for (const start of parents.keys()) {
    if (state.has(start)) {
      continue;
    }
    const path: number[] = [];
    const positionOnPath = new Map<number, number>();
    let cursor: number | undefined = start;
    while (cursor !== undefined && !state.has(cursor)) {
      state.set(cursor, VISITING);
      positionOnPath.set(cursor, path.length);
      path.push(cursor);
      cursor = parents.get(cursor);
    }
    // Landing on a node this same walk is still exploring closes a loop; landing
    // on a node finished by an earlier walk just joins an already-cleared chain.
    const closesLoop = cursor !== undefined && state.get(cursor) === VISITING;
    const from = cursor === undefined ? undefined : positionOnPath.get(cursor);
    if (closesLoop && from !== undefined) {
      cycles.push(path.slice(from));
    }
    for (const node of path) {
      state.set(node, DONE);
    }
  }
  return cycles;
}

function checkCycles(
  profiles: readonly CollectionSnapshot[],
  profileIds: ReadonlySet<number>,
  errors: RestoreIssue[],
): void {
  const parents = new Map<number, number>();
  for (const doc of profiles) {
    const id = doc.data.id;
    const bigBrotherId = doc.data.bigBrotherId;
    // Dangling and malformed pointers are already errors from checkReferences;
    // excluding them here keeps this pass reporting cycles and only cycles.
    if (
      typeof id === "number" &&
      typeof bigBrotherId === "number" &&
      profileIds.has(bigBrotherId)
    ) {
      parents.set(id, bigBrotherId);
    }
  }
  for (const cycle of detectCycles(parents)) {
    const members = cycle.map((id) => `#${id}`).join(" → ");
    errors.push({
      rule: "cycle",
      message: `Big-brother cycle: ${members} → ${`#${cycle[0]}`}.`,
    });
  }
}

/**
 * Run D101's four structural rules over a parsed snapshot. Reports **every** issue
 * rather than stopping at the first: an operator restoring under duress should
 * learn everything wrong with an archive in one run, not discover the next fault
 * after each repair.
 */
export function validateSnapshot(collections: BackupData): RestoreValidationReport {
  const errors: RestoreIssue[] = [];
  const warnings: RestoreIssue[] = [];

  const profileIds = checkIds(collections.profiles, "profiles", errors);
  checkIds(collections.users, "users", errors);
  checkEmails(collections.profiles, errors);
  checkReferences(collections, profileIds, errors, warnings);
  checkCycles(collections.profiles, profileIds, errors);

  return {
    errors,
    warnings,
    counts: {
      profiles: collections.profiles.length,
      users: collections.users.length,
      config: collections.config.length,
    },
  };
}

/**
 * The privileged-account roster D101's forensic entry records: who holds a
 * privileged role in a given dataset.
 *
 * Both tiers are captured, not just admins. D101 is written around the planted
 * `role: admin` vector, but a manager can edit every brother's record, so a restore
 * that quietly adds one is the same class of event at a lower altitude — and the
 * roster costs nothing extra to compute. `usableAdminIds` is the subset that can
 * *actually* administer (D129: living, not de-brothered, with a usable email); the
 * gap between it and `adminIds` is what made a seeded deceased admin silently
 * satisfy the last-admin invariant in 5.5f, so a restore that leaves zero usable
 * admins is worth seeing at a glance.
 */
export interface PrivilegedRoster {
  adminIds: number[];
  managerIds: number[];
  usableAdminIds: number[];
}

/** The roster implied by a set of profile documents, after hydration normalization. */
export function privilegedRoster(profiles: readonly CollectionSnapshot[]): PrivilegedRoster {
  const adminIds: number[] = [];
  const managerIds: number[] = [];
  const usableAdminIds: number[] = [];
  for (const doc of profiles) {
    // The same normalization the cache applies on cold start, so this roster is
    // what Book will hold — not what the raw documents say (see cache.ts).
    const profile = normalizeHydratedProfile(doc.data as unknown as Profile, () => {});
    if (profile === null) {
      continue;
    }
    if (profile.role === "admin") {
      adminIds.push(profile.id);
      if (isUsableAdmin(profile)) {
        usableAdminIds.push(profile.id);
      }
    } else if (profile.role === "manager") {
      managerIds.push(profile.id);
    }
  }
  const ascending = (a: number, b: number): number => a - b;
  return {
    adminIds: adminIds.sort(ascending),
    managerIds: managerIds.sort(ascending),
    usableAdminIds: usableAdminIds.sort(ascending),
  };
}

/**
 * How a restore changes the privileged roster. D101 asks for this delta "when the
 * prior state is readable" — the conditional exists because after the collections
 * are replaced it is not: the only place the pre-restore roster survives is the
 * safety snapshot the tool takes before its first delete.
 */
export interface RosterDelta {
  adminIdsAdded: number[];
  adminIdsRemoved: number[];
  managerIdsAdded: number[];
  managerIdsRemoved: number[];
}

function difference(from: readonly number[], against: readonly number[]): number[] {
  const excluded = new Set(against);
  return from.filter((id) => !excluded.has(id));
}

/** The privileged-role changes a restore of `next` over `prior` would make. */
export function rosterDelta(prior: PrivilegedRoster, next: PrivilegedRoster): RosterDelta {
  return {
    adminIdsAdded: difference(next.adminIds, prior.adminIds),
    adminIdsRemoved: difference(prior.adminIds, next.adminIds),
    managerIdsAdded: difference(next.managerIds, prior.managerIds),
    managerIdsRemoved: difference(prior.managerIds, next.managerIds),
  };
}

/** Whether a delta records any change at all — a quiet restore says so explicitly. */
export function rosterDeltaIsEmpty(delta: RosterDelta): boolean {
  return (
    delta.adminIdsAdded.length === 0 &&
    delta.adminIdsRemoved.length === 0 &&
    delta.managerIdsAdded.length === 0 &&
    delta.managerIdsRemoved.length === 0
  );
}

/**
 * The restored profiles as hydrated `Profile` records — what the post-restore
 * reconciliation (D99/D101) needs to compare against Ghost, and what a
 * hydrate-and-count smoke check counts. Records with no usable Constitution id are
 * dropped exactly as cold-start hydration drops them.
 */
export function hydrateProfiles(profiles: readonly CollectionSnapshot[]): Profile[] {
  const hydrated: Profile[] = [];
  for (const doc of profiles) {
    const profile = normalizeHydratedProfile(doc.data as unknown as Profile, () => {});
    if (profile !== null) {
      hydrated.push(profile);
    }
  }
  return hydrated.sort((a, b) => a.id - b.id);
}
