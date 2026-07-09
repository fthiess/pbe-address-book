import {
  type Discrepancy,
  type GhostAuditReport,
  type Profile,
  formatCanonicalName,
  normalizeEmail,
} from "@pbe/shared";
import type { GhostMemberRecord, GhostNewsletterEvent } from "../identity/ghost-reader.js";

/**
 * The Book/Ghost alignment audit (Phase 5b-2; API-SPEC §7) — the read pass that
 * joins Book profiles to Ghost members by `ghostMemberId` and reports every
 * disagreement, grouped by category (decisions D55/D99).
 *
 * **Report-only into Book, in every category (the 5b-2 decision amending D103).**
 * D103 originally had the audit *resolve* the newsletter flag by writing the later
 * side's value into Book (a scoped Ghost→Book exception). That write-back is
 * removed: the audit **never writes anything into Book**, restoring D55's
 * read-only-into-Book invariant in full. A newsletter disagreement is reported —
 * with both values and both change timestamps so the reviewer (a human, or the
 * future OFC-214 sysadmin) can see which side changed later and flip the correct
 * toggle by hand. The Ghost-side timestamp is *advisory context*, not a control
 * input, so a missing `ghostChangedAt` degrades the report, it does not break it.
 *
 * This is a **pure function** over already-fetched inputs: the route gathers Book
 * profiles (from the cache), Book `users` ids (from the store), and the Ghost
 * members + newsletter events (from the {@link GhostReader}), then calls this. That
 * keeps every join rule unit-testable without a network or a database.
 */

export interface GhostAuditInput {
  /** Every Book profile (the hydrated in-memory dataset). */
  profiles: readonly Profile[];
  /** Every Book `users` document id — to find a users doc with no live profile (D98). */
  userIds: readonly number[];
  /** Every Ghost member (from the read seam). */
  members: readonly GhostMemberRecord[];
  /** Newsletter subscribe/unsubscribe events — for the newsletterDrift `ghostChangedAt`. */
  newsletterEvents: readonly GhostNewsletterEvent[];
  /** The report timestamp (from the route's injected clock). */
  generatedAt: string;
}

/**
 * Compute the discrepancy report. Deterministic and side-effect-free; the order is
 * stable (profiles in input order, then unmatched Ghost members, then orphans) so
 * two runs over the same data produce an identical report.
 */
export function planGhostAudit(input: GhostAuditInput): GhostAuditReport {
  const { profiles, userIds, members, newsletterEvents, generatedAt } = input;

  const ghostById = new Map<string, GhostMemberRecord>();
  for (const member of members) {
    ghostById.set(member.id, member);
  }
  // The Ghost member ids Book *legitimately* references — from non-de-brothered
  // profiles only. A de-brothered profile's Ghost member is expected to be deleted
  // (D115), so if a stale `ghostMemberId` on one still resolves to a live member,
  // that member is a leftover that SHOULD surface as `unmatchedGhostMember` (a failed
  // Ghost delete) — excluding de-brothered ids here is what lets it (OFC review).
  const referencedGhostIds = new Set<string>();
  const profileIds = new Set<number>();
  for (const profile of profiles) {
    profileIds.add(profile.id);
    if (profile.ghostMemberId && !profile.debrothered.isDebrothered) {
      referencedGhostIds.add(profile.ghostMemberId);
    }
  }
  const latestNewsletterEventAt = latestEventByMember(newsletterEvents);

  const discrepancies: Discrepancy[] = [];

  for (const profile of profiles) {
    // A de-brothered profile is *expected* to have no Ghost member (D115): its
    // Ghost account was deleted. Skip every Ghost comparison for it.
    if (profile.debrothered.isDebrothered) {
      continue;
    }

    const member = profile.ghostMemberId ? ghostById.get(profile.ghostMemberId) : undefined;

    if (!member) {
      // A brother with no email is not expected to have a Ghost member (the
      // no-email/unidentified case, C15/D20) — not a gap. Otherwise a resolving
      // member is missing (a failed create, a stale id, or a never-linked profile).
      if (profile.email) {
        discrepancies.push({
          category: "missingGhostMember",
          profileId: profile.id,
          ...(profile.ghostMemberId ? { ghostMemberId: profile.ghostMemberId } : {}),
        });
      }
      continue;
    }

    // Matched — compare the three pushed fields (email, Canonical Name, newsletter).
    // Names are NFC-normalized on both sides before comparison, mirroring the email
    // comparison below: a name differing only by Unicode form (composed vs decomposed
    // accents) is the same name and must not read as permanent `fieldDrift` (review).
    const expectedName = formatCanonicalName(profile, false);
    if (member.name.normalize("NFC") !== expectedName.normalize("NFC")) {
      discrepancies.push({
        category: "fieldDrift",
        profileId: profile.id,
        ghostMemberId: member.id,
        field: "name",
        bookValue: expectedName,
        ghostValue: member.name,
      });
    }
    if (profile.email && normalizeEmail(profile.email) !== normalizeEmail(member.email)) {
      discrepancies.push({
        category: "fieldDrift",
        profileId: profile.id,
        ghostMemberId: member.id,
        field: "email",
        bookValue: profile.email,
        ghostValue: member.email,
      });
    }
    if (profile.allowNewsletterEmail !== member.subscribed) {
      const ghostChangedAt = latestNewsletterEventAt.get(member.id);
      discrepancies.push({
        category: "newsletterDrift",
        profileId: profile.id,
        ghostMemberId: member.id,
        field: "allowNewsletterEmail",
        bookValue: profile.allowNewsletterEmail,
        ghostValue: member.subscribed,
        bookChangedAt: profile.newsletterConsentChangedAt,
        ...(ghostChangedAt ? { ghostChangedAt } : {}),
      });
    }
  }

  // Ghost members that no Book profile references — a self-signup or a historical
  // unidentified address (identify/link).
  for (const member of members) {
    if (!referencedGhostIds.has(member.id)) {
      discrepancies.push({
        category: "unmatchedGhostMember",
        ghostMemberId: member.id,
        ghostValue: member.email,
      });
    }
  }

  // Book-internal orphans (D98): a dangling `bigBrotherId`, and a `users` doc with
  // no live profile (typically the residue of a partial delete).
  for (const profile of profiles) {
    if (
      profile.bigBrotherId !== undefined &&
      profile.bigBrotherId !== null &&
      !profileIds.has(profile.bigBrotherId)
    ) {
      discrepancies.push({
        category: "bookInternalOrphan",
        profileId: profile.id,
        field: "bigBrotherId",
        bookValue: profile.bigBrotherId,
      });
    }
  }
  for (const userId of userIds) {
    if (!profileIds.has(userId)) {
      discrepancies.push({
        category: "bookInternalOrphan",
        profileId: userId,
        field: "users",
      });
    }
  }

  return { generatedAt, discrepancies };
}

/**
 * Latest event timestamp per member id. Compares by parsed epoch millis rather than
 * lexically, so a mixed-precision feed (`…00.500Z` vs `…00Z`) can't misorder events
 * (review); an unparseable timestamp sorts as oldest (`-Infinity`) so it never wins.
 */
function latestEventByMember(events: readonly GhostNewsletterEvent[]): Map<string, string> {
  const latest = new Map<string, string>();
  const latestMs = new Map<string, number>();
  for (const event of events) {
    const ms = Date.parse(event.at);
    const at = Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
    const current = latestMs.get(event.memberId);
    if (current === undefined || at > current) {
      latestMs.set(event.memberId, at);
      latest.set(event.memberId, event.at);
    }
  }
  return latest;
}
