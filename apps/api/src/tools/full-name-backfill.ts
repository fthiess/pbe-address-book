/**
 * The pure half of `backfill-full-name.ts` (OFC-429 / D181): given the stored
 * profile documents, decide which ones get a `fullLegalName` and what it is.
 *
 * THE RULE. A record whose `fullLegalName` is absent or blank gets the
 * first/middle/last join — the same name the Directory already displays. A record
 * that has ANY non-blank value keeps it untouched, whatever it says: the genesis
 * load's 335 suffix/go-by names, and every value a brother has typed since the
 * launch, are exactly the data this pass must not overwrite. Nothing else on the
 * document is read or written — not `lastModified` (that stamp means "a person
 * edited this"; a data-shape correction is not an edit), not verification.
 *
 * Kept separate from the CLI so the decision is unit-tested without Firestore.
 */

/** The subset of a stored profile document the planner reads. */
export interface FullNameSource {
  firstName?: unknown;
  middleName?: unknown;
  lastName?: unknown;
  fullLegalName?: unknown;
}

export interface FullNameUpdate<Token = unknown> {
  /** The Firestore document id (`String(id)`), carried verbatim. */
  docId: string;
  fullLegalName: string;
  /**
   * The document's `updateTime` at the read, carried opaquely so the write can
   * be made conditional on it (a brother who filled the field in between is
   * then a skipped precondition failure, never an overwrite).
   */
  token: Token;
}

export interface FullNameBackfillPlan<Token = unknown> {
  updates: FullNameUpdate<Token>[];
  /** Documents that already carry a non-blank `fullLegalName`; left alone. */
  alreadySet: number;
  /** Documents with no usable first or last name; skipped with their ids. */
  unnamed: string[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The join the Directory displays: first, middle (when present), last. */
export function joinedName(source: FullNameSource): string {
  return [text(source.firstName), text(source.middleName), text(source.lastName)]
    .filter((part) => part !== "")
    .join(" ");
}

export function planFullNameBackfill<Token>(
  docs: readonly { id: string; data: FullNameSource; token: Token }[],
): FullNameBackfillPlan<Token> {
  const plan: FullNameBackfillPlan<Token> = { updates: [], alreadySet: 0, unnamed: [] };
  for (const doc of docs) {
    if (text(doc.data.fullLegalName) !== "") {
      plan.alreadySet++;
      continue;
    }
    if (text(doc.data.firstName) === "" || text(doc.data.lastName) === "") {
      plan.unnamed.push(doc.id);
      continue;
    }
    plan.updates.push({ docId: doc.id, fullLegalName: joinedName(doc.data), token: doc.token });
  }
  return plan;
}
