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
