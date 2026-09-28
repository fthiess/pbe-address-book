/**
 * The pure half of `bulk-headshots.ts` (D182): parse the operator's upload plan,
 * and decide — for an upload, an undo, or a purge — what happens to each brother
 * given the photo pointer his profile holds *now*.
 *
 * THE RULE. A row names a brother, a prepared PNG, and the Book photo version the
 * operator saw when choosing (`expected_version`, blank = he had no photo). The
 * upload goes ahead only if the profile still holds exactly that pointer: a
 * brother who has changed or added his own photo since keeps it, reported as
 * `changed`, never overwritten. A profile already pointing at this very photo is
 * `already-done`, so a re-run after a partial failure is safe. Nothing but
 * `hasHeadshot` / `headshotVersion` is written — not `lastModified` (that stamp
 * means "a person edited this", D181), not verification.
 *
 * Undo and purge work from the run's artifact: undo points each written profile
 * back at its prior photo (only if it still shows ours); purge deletes the prior
 * photo's objects (only if the profile still shows ours, i.e. was not undone).
 *
 * Kept separate from the CLI and the Firestore/GCS seams so every decision is
 * unit-tested without either.
 */

/** Object-key version grammar shared with `parseImageObjectKey` (`@pbe/shared`). */
const VERSION_RE = /^[A-Za-z0-9._-]+$/u;
export const PLAN_HEADER = ["const_id", "file", "expected_version"] as const;

export interface PlanRow {
  readonly id: number;
  /** The PNG path exactly as written in the plan (the CLI resolves it). */
  readonly file: string;
  /** The version the operator saw; `null` when the brother had no Book photo. */
  readonly expectedVersion: string | null;
  /** 1-based line number in the plan file, for error messages. */
  readonly line: number;
}

export interface ParsedPlan {
  readonly rows: PlanRow[];
  readonly errors: string[];
}

/**
 * Parse `const_id,file,expected_version` CSV. Deliberately strict and small: no
 * quoting (plan paths contain no commas), exact header, positive integer ids, no
 * id twice, versions in the object-key grammar. Any error refuses the whole plan.
 */
export function parsePlan(text: string): ParsedPlan {
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const lines = body.split(/\r?\n/u);
  const rows: PlanRow[] = [];
  const errors: string[] = [];
  const header = (lines[0] ?? "").split(",").map((cell) => cell.trim());
  if (header.join(",") !== PLAN_HEADER.join(",")) {
    return { rows, errors: [`line 1: header must be "${PLAN_HEADER.join(",")}"`] };
  }
  const seen = new Set<number>();
  lines.slice(1).forEach((raw, index) => {
    if (raw.trim() === "") {
      return;
    }
    const parsed = parseRow(raw, index + 2, seen);
    if (typeof parsed === "string") {
      errors.push(parsed);
      return;
    }
    seen.add(parsed.id);
    rows.push(parsed);
  });
  return { rows, errors };
}

/** One data line → a row, or the error message that refuses it. */
function parseRow(raw: string, line: number, seen: ReadonlySet<number>): PlanRow | string {
  const cells = raw.split(",").map((cell) => cell.trim());
  if (cells.length !== PLAN_HEADER.length) {
    return `line ${line}: expected ${PLAN_HEADER.length} fields, found ${cells.length}`;
  }
  const [idText, file, version] = cells as [string, string, string];
  const id = Number(idText);
  if (!/^\d+$/u.test(idText) || id <= 0) {
    return `line ${line}: const_id "${idText}" is not a positive integer`;
  }
  if (seen.has(id)) {
    return `line ${line}: #${id} appears more than once`;
  }
  if (file === "") {
    return `line ${line}: #${id} has no file`;
  }
  if (version !== "" && !VERSION_RE.test(version)) {
    return `line ${line}: #${id} expected_version "${version}" is not a valid version`;
  }
  return { id, file, expectedVersion: version === "" ? null : version, line };
}

/** A profile's photo pointer as read now, with its opaque `updateTime` token. */
export interface CurrentPointer<Token = unknown> {
  readonly hasHeadshot: boolean;
  readonly headshotVersion: string | null;
  readonly token: Token;
}

/** The version a profile effectively shows: none unless `hasHeadshot` is set. */
export function shownVersion(pointer: CurrentPointer): string | null {
  return pointer.hasHeadshot ? pointer.headshotVersion : null;
}

export type UploadDecision<Token = unknown> =
  | {
      readonly kind: "upload";
      readonly row: PlanRow;
      readonly version: string;
      readonly token: Token;
    }
  | { readonly kind: "already-done"; readonly row: PlanRow }
  | { readonly kind: "changed"; readonly row: PlanRow; readonly found: string | null }
  | { readonly kind: "missing"; readonly row: PlanRow };

/**
 * Decide each row. `targetVersion` is the content-hash version of the row's PNG;
 * `current` holds the pointer read now (absent = no such profile).
 */
export function planUploads<Token>(
  rows: readonly PlanRow[],
  targetVersion: ReadonlyMap<number, string>,
  current: ReadonlyMap<number, CurrentPointer<Token>>,
): UploadDecision<Token>[] {
  return rows.map((row) => {
    const pointer = current.get(row.id);
    const version = targetVersion.get(row.id);
    if (version === undefined) {
      throw new Error(`no target version computed for #${row.id}`);
    }
    if (!pointer) {
      return { kind: "missing", row };
    }
    const shown = shownVersion(pointer);
    if (shown === version) {
      return { kind: "already-done", row };
    }
    if (shown !== row.expectedVersion) {
      return { kind: "changed", row, found: shown };
    }
    return { kind: "upload", row, version, token: pointer.token };
  });
}

/** One brother's line in the run artifact: what was there, what we wrote. */
export interface ArtifactItem {
  readonly id: number;
  /** The version shown before the run (`null` = no photo). */
  readonly prior: string | null;
  /** The version the run pointed the profile at. */
  readonly next: string;
  /** `intended` until the pointer write lands; then `written`, `changed`, `missing` or `failed`. */
  outcome: "intended" | "written" | "changed" | "missing" | "failed";
}

export type RevertDecision<Token = unknown> =
  | { readonly kind: "revert"; readonly item: ArtifactItem; readonly token: Token }
  | { readonly kind: "changed"; readonly item: ArtifactItem; readonly found: string | null }
  | { readonly kind: "missing"; readonly item: ArtifactItem };

/**
 * Undo: every item the run may have written (`written`, or `intended` from a run
 * that died mid-way) whose profile still shows our version goes back to `prior`.
 */
export function planUndo<Token>(
  items: readonly ArtifactItem[],
  current: ReadonlyMap<number, CurrentPointer<Token>>,
): RevertDecision<Token>[] {
  return items
    .filter((item) => item.outcome === "written" || item.outcome === "intended")
    .map((item) => {
      const pointer = current.get(item.id);
      if (!pointer) {
        return { kind: "missing", item };
      }
      const shown = shownVersion(pointer);
      if (shown !== item.next) {
        return { kind: "changed", item, found: shown };
      }
      return { kind: "revert", item, token: pointer.token };
    });
}

export type PurgeDecision =
  | { readonly kind: "purge"; readonly item: ArtifactItem; readonly version: string }
  | { readonly kind: "keep"; readonly item: ArtifactItem; readonly reason: string };

/**
 * Purge: delete the replaced photo only where the run's photo is still the one
 * shown — an undone record still needs its prior photo, and a record the brother
 * changed since is none of this tool's business. Items with no prior photo have
 * nothing to purge and are omitted.
 */
export function planPurge(
  items: readonly ArtifactItem[],
  current: ReadonlyMap<number, CurrentPointer>,
): PurgeDecision[] {
  const out: PurgeDecision[] = [];
  for (const item of items) {
    if (item.outcome !== "written" || item.prior === null || item.prior === item.next) {
      continue;
    }
    const pointer = current.get(item.id);
    const shown = pointer ? shownVersion(pointer) : null;
    if (shown !== item.next) {
      out.push({
        kind: "keep",
        item,
        reason: `profile shows ${shown ?? "no photo"}, not this run's photo`,
      });
      continue;
    }
    out.push({ kind: "purge", item, version: item.prior });
  }
  return out;
}
