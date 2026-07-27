import { normalizeEmail } from "@pbe/shared";

/**
 * The pure delta-reconcile planner for the ghost-staging mirror (Book↔Ghost
 * write-path testing). Given the members we *want* on ghost-staging (derived from
 * the freshly-seeded fake profiles) and the seed-owned members that currently
 * *exist* there, it computes the minimal set of create / update / delete
 * operations that brings Ghost into correspondence with Book — so re-running it is
 * the "reset" after a testing session mutated Ghost, and it only touches what
 * actually differs (see `mirror-ghost-staging.ts` for the I/O shell).
 *
 * Matching is by **normalized email** (Ghost members are unique by email). A
 * desired member with no existing match is created; a match whose name or
 * subscription differs is updated; an existing seed-owned member matched by no
 * desired member is an orphan and is deleted. Email is never updated in place — a
 * changed email simply orphans the old member and creates a new one, which keeps
 * the planner trivial and is exactly the right reset behavior.
 */

/** A member we want present on Ghost, derived from a seeded fake profile. */
export interface DesiredMember {
  profileId: number;
  email: string;
  /** The Canonical Name (byline form, no disambiguation suffix) — matches the app push. */
  name: string;
  /** Whether the member should be subscribed to the newsletter. */
  subscribed: boolean;
}

/** A seed-owned member currently on ghost-staging (from the `book-seed`-labelled list). */
export interface ExistingMember {
  id: string;
  email: string;
  name: string;
  subscribed: boolean;
}

export interface ReconcilePlan {
  /** Desired members with no existing match — create them (id assigned on create). */
  toCreate: DesiredMember[];
  /** Existing members whose name/subscription drifted — update them in place. */
  toUpdate: { id: string; desired: DesiredMember }[];
  /** Seed-owned member ids matched by no desired member — delete them (orphans). */
  toDelete: string[];
  /** profileId → ghostMemberId for members that already existed (matched by email). */
  matchedLinks: { profileId: number; ghostMemberId: string }[];
}

/** A Ghost member as listed, carrying whatever labels it holds. */
export interface LabelledMember extends ExistingMember {
  readonly labels?: readonly { readonly name?: string; readonly slug?: string }[];
}

/**
 * Choose which of ghost-staging's members {@link planReconcile} is allowed to see,
 * for the **roster** tool (OFC-248). Two disjoint jobs, two different scopes — and
 * conflating them is a bug this function exists to prevent.
 *
 *  - **Matching** must be by **email**, because that is the key Ghost itself
 *    enforces uniqueness on, globally and regardless of labels.
 *  - **Deleting** must be by **label**, because the label is the tool's own mark:
 *    it may only ever remove members it created.
 *
 * So the scope is the union: every member holding a roster email, plus every member
 * carrying the label. A member that is neither is invisible here and therefore can
 * never be touched — the safety property that makes a delete branch acceptable at
 * all against a Ghost instance holding real accounts.
 *
 * ⚠ **Found in live testing, not by reasoning.** The first cut scoped to labelled
 * members alone. The operator's own ghost-staging account already existed — created
 * during the D72 bridge work, long before any label existed — so the plan could not
 * see it, planned a create, and Ghost answered `422 Member already exists`. Anything
 * that narrows this scope back to labels alone re-introduces that failure, and it
 * will only surface against an instance that already has the account.
 */
export function selectReconcileScope(
  allMembers: readonly LabelledMember[],
  rosterEmails: readonly string[],
  label: string,
): ExistingMember[] {
  const wanted = new Set(rosterEmails.map((e) => normalizeEmail(e)));
  return allMembers
    .filter(
      (m) =>
        wanted.has(normalizeEmail(m.email)) ||
        (m.labels ?? []).some((l) => l.name === label || l.slug === label),
    )
    .map(({ id, email, name, subscribed }) => ({ id, email, name, subscribed }));
}

export function planReconcile(
  desired: readonly DesiredMember[],
  existing: readonly ExistingMember[],
): ReconcilePlan {
  const existingByEmail = new Map<string, ExistingMember>();
  for (const member of existing) {
    existingByEmail.set(normalizeEmail(member.email), member);
  }

  const plan: ReconcilePlan = { toCreate: [], toUpdate: [], toDelete: [], matchedLinks: [] };
  const claimed = new Set<string>();

  for (const want of desired) {
    const key = normalizeEmail(want.email);
    const match = existingByEmail.get(key);
    if (!match) {
      plan.toCreate.push(want);
      continue;
    }
    claimed.add(key);
    plan.matchedLinks.push({ profileId: want.profileId, ghostMemberId: match.id });
    if (match.name !== want.name || match.subscribed !== want.subscribed) {
      plan.toUpdate.push({ id: match.id, desired: want });
    }
  }

  for (const member of existing) {
    if (!claimed.has(normalizeEmail(member.email))) {
      plan.toDelete.push(member.id);
    }
  }

  return plan;
}
