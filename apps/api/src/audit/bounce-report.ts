import type { BounceReport, BounceRow } from "@pbe/shared";
import type {
  GhostBounceEvent,
  GhostMemberRecord,
  GhostNewsletterEmail,
} from "../identity/ghost-reader.js";

/**
 * The email-bounce report (Phase 5b-2; decision D120), folded server-side from the
 * proven `ghost-member-export/export-bounces.js` join. It is a **separate** admin
 * report from the alignment audit — a different job (email-address maintenance, not
 * Book↔Ghost drift), so its own endpoint and its own CSV download (the 5b-2
 * decision splitting it out and choosing a CSV download over an in-UI panel or a
 * log line — an admin wants this in a spreadsheet).
 *
 * The join: bounce events (`email_failed_event`) → member email (`member_id` →
 * email) → aggregated per brother. Events for a member Ghost has since hard-deleted
 * can't resolve to an email and are skipped (counted in {@link BounceReport.skipped}).
 * The newsletter title is best-effort (the titles source can be empty when Ghost's
 * posts/email endpoint 403s a custom-integration token — D120); the raw email id is
 * shown when a title is unavailable.
 *
 * Pure over already-fetched inputs, so the join is unit-testable without a network.
 */

export interface BounceReportInput {
  members: readonly GhostMemberRecord[];
  bounceEvents: readonly GhostBounceEvent[];
  /** Best-effort email-id → newsletter title (may be empty; D120). */
  newsletterEmails: readonly GhostNewsletterEmail[];
  generatedAt: string;
}

export function planBounceReport(input: BounceReportInput): BounceReport {
  const { members, bounceEvents, newsletterEmails, generatedAt } = input;

  const emailByMemberId = new Map<string, string>();
  for (const member of members) {
    emailByMemberId.set(member.id, member.email);
  }
  const titleByEmailId = new Map<string, string>();
  for (const email of newsletterEmails) {
    titleByEmailId.set(email.emailId, email.title);
  }

  const byEmail = new Map<string, BounceRow>();
  let skipped = 0;

  for (const event of bounceEvents) {
    const memberEmail = event.memberId ? emailByMemberId.get(event.memberId) : undefined;
    if (!memberEmail) {
      // Member hard-deleted from Ghost after the bounce — can't resolve an email.
      skipped += 1;
      continue;
    }
    const newsletter = newsletterLabel(event.emailId, titleByEmailId);
    const at = event.at ?? "";

    const existing = byEmail.get(memberEmail);
    if (!existing) {
      byEmail.set(memberEmail, {
        email: memberEmail,
        bounce_count: 1,
        last_bounce_at: at,
        last_bounce_newsletter: newsletter,
      });
      continue;
    }
    existing.bounce_count += 1;
    // Keep the "last" fields pointing at the most recent event (ISO compares lexically).
    if (at && (!existing.last_bounce_at || at > existing.last_bounce_at)) {
      existing.last_bounce_at = at;
      existing.last_bounce_newsletter = newsletter;
    }
  }

  // Most bounces first, then most recent, then email A–Z for a stable order.
  const rows = [...byEmail.values()].sort((a, b) => {
    if (b.bounce_count !== a.bounce_count) {
      return b.bounce_count - a.bounce_count;
    }
    if (a.last_bounce_at !== b.last_bounce_at) {
      return b.last_bounce_at.localeCompare(a.last_bounce_at);
    }
    return a.email.localeCompare(b.email);
  });

  return { generatedAt, rows, skipped };
}

function newsletterLabel(emailId: string | null, titleByEmailId: Map<string, string>): string {
  if (!emailId) {
    return "(unknown newsletter)";
  }
  return titleByEmailId.get(emailId) ?? `(unknown newsletter ${emailId})`;
}
