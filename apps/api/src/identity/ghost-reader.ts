import { GhostAdminHttp } from "./ghost-admin-http.js";
import type { GhostAdminConfig } from "./ghost-admin.js";

/**
 * The read-only Ghost Admin-API seam (Phase 5b-2), sibling to the write-only
 * {@link import('./ghost-lifecycle.js').GhostLifecycle}. It backs the two admin
 * report surfaces that read *from* Ghost and never write to it:
 *
 *  - the **Book/Ghost alignment audit** (`GET /api/admin/ghost-audit`) — joins Book
 *    profiles to Ghost members and reports drift; the newsletter flag is enriched
 *    with the Ghost-side change timestamp from the member event feed but, per the
 *    5b-2 decision amending D103, the audit **writes nothing back into Book** (every
 *    category is report-only — a human or the future OFC-214 sysadmin resolves it);
 *  - the **email-bounce report** (`GET /api/admin/bounce-report`) — the
 *    `export-bounces.js` join, folded server-side (D120).
 *
 * Both are read-only, so — unlike the write lifecycle, which defaults to a
 * succeed-and-log stub so an unconfigured dev deploy still functions — an
 * unconfigured reader has nothing meaningful to return, and the routes fail closed
 * with `503` when no reader is wired (mirroring the roster verifier). Tests inject
 * a fake reader; the real client is {@link GhostAdminReader}.
 */
export interface GhostReader {
  /** Every Ghost member, projected to the fields the audit and bounce join need. */
  listMembers(): Promise<GhostMemberRecord[]>;
  /** Newsletter subscribe/unsubscribe events (for the audit's `ghostChangedAt`). */
  listNewsletterEvents(): Promise<GhostNewsletterEvent[]>;
  /** Email-bounce events (`email_failed_event`) for the bounce report (D120). */
  listBounceEvents(): Promise<GhostBounceEvent[]>;
  /**
   * A best-effort `emailId → newsletter title` source for the bounce report.
   * Ghost's `/posts/?include=email` is the only route to these titles for a
   * custom-integration token (the `/admin/emails/` endpoint 403s), and even that
   * can fail — so this **returns `[]` on failure** rather than throwing, exactly as
   * `export-bounces.js` treats it as optional; the bounce report then shows the raw
   * email id instead of a title.
   */
  listNewsletterEmails(): Promise<GhostNewsletterEmail[]>;
}

/** A Ghost member, projected to what the audit + bounce join read. */
export interface GhostMemberRecord {
  /** The Ghost Admin-API member id (Book's `ghostMemberId` join key). */
  id: string;
  email: string;
  /** The member's Ghost name (the Canonical Name form Book pushes). */
  name: string;
  /** Whether the member is subscribed to the newsletter. */
  subscribed: boolean;
}

/** A newsletter subscribe/unsubscribe event — the audit's Ghost-side causal signal. */
export interface GhostNewsletterEvent {
  memberId: string;
  /** `true` = subscribe, `false` = unsubscribe. */
  subscribed: boolean;
  /** ISO timestamp of the event. */
  at: string;
}

/** An email-bounce event (`email_failed_event`), fields extracted defensively. */
export interface GhostBounceEvent {
  memberId: string | null;
  emailId: string | null;
  /** ISO timestamp (`failed_at`, else `created_at`), or `null` if absent. */
  at: string | null;
}

/** A newsletter-email id ↔ human title, for the bounce report's newsletter column. */
export interface GhostNewsletterEmail {
  emailId: string;
  title: string;
}

/**
 * The real read client. Reuses {@link GhostAdminHttp} (shared auth + pagination
 * with the write client, so the two never drift on how they reach Ghost) and does
 * pure, defensive field extraction into the projected shapes above. Constructed
 * from the same {@link GhostAdminConfig} as the write client (the `newsletterId` is
 * unused here and may be omitted).
 */
export class GhostAdminReader implements GhostReader {
  private readonly http: GhostAdminHttp;

  constructor(config: Omit<GhostAdminConfig, "newsletterId"> & { newsletterId?: string }) {
    this.http = new GhostAdminHttp({
      apiUrl: config.apiUrl,
      adminApiKey: config.adminApiKey,
      acceptVersion: config.acceptVersion,
      fetchImpl: config.fetchImpl,
    });
  }

  async listMembers(): Promise<GhostMemberRecord[]> {
    // Only `newsletters` is read (the label relation was requested but never used).
    const rows = await this.http.getAll("/members/", "members", { include: "newsletters" });
    const members: GhostMemberRecord[] = [];
    for (const row of rows) {
      const m = row as Record<string, unknown>;
      const id = typeof m.id === "string" ? m.id : null;
      const email = typeof m.email === "string" ? m.email : null;
      if (!id || !email) {
        continue;
      }
      members.push({
        id,
        email,
        name: typeof m.name === "string" ? m.name : "",
        // The `newsletters` **relation** is authoritative in Ghost v5 (it is what the
        // write path sets); the top-level `subscribed` boolean is a legacy/global
        // flag that can disagree with per-newsletter membership. So derive from the
        // relation when present (Book is single-newsletter → non-empty = subscribed),
        // falling back to the boolean only if the relation wasn't returned (review).
        subscribed: Array.isArray(m.newsletters)
          ? m.newsletters.length > 0
          : typeof m.subscribed === "boolean" && m.subscribed,
      });
    }
    return members;
  }

  async listNewsletterEvents(): Promise<GhostNewsletterEvent[]> {
    const rows = await this.http.getAll("/members/events/", "events", {
      filter: "type:newsletter_event",
    });
    const events: GhostNewsletterEvent[] = [];
    for (const row of rows) {
      const event = row as Record<string, unknown>;
      const data = event.data as Record<string, unknown> | undefined;
      const memberId = eventMemberId(data);
      // Same defensive timestamp extraction as bounce events (data.created_at, then
      // the event-level created_at) so a shape shift doesn't drop every event (review).
      const at = eventTimestamp(event, data);
      if (!memberId || at === null || typeof data?.subscribed !== "boolean") {
        continue;
      }
      events.push({ memberId, subscribed: data.subscribed, at });
    }
    return events;
  }

  async listBounceEvents(): Promise<GhostBounceEvent[]> {
    const rows = await this.http.getAll("/members/events/", "events", {
      filter: "type:email_failed_event",
    });
    return rows.map((row) => {
      const data = (row as Record<string, unknown>).data as Record<string, unknown> | undefined;
      return {
        memberId: eventMemberId(data),
        emailId: eventEmailId(data),
        at: eventTimestamp(row as Record<string, unknown>, data),
      };
    });
  }

  async listNewsletterEmails(): Promise<GhostNewsletterEmail[]> {
    let rows: unknown[];
    try {
      rows = await this.http.getAll("/posts/", "posts", {
        include: "email",
        fields: "id,title,email",
      });
    } catch (error) {
      // Best-effort (D120): the posts/email endpoint can 403 for a custom
      // integration token. Log server-side and proceed without titles.
      process.stderr.write(
        `${JSON.stringify({
          logType: "error",
          severity: "WARNING",
          message: `bounce-report: newsletter titles unavailable: ${(error as Error).message}`,
        })}\n`,
      );
      return [];
    }
    const emails: GhostNewsletterEmail[] = [];
    for (const row of rows) {
      const email = (row as Record<string, unknown>).email as Record<string, unknown> | undefined;
      const emailId = typeof email?.id === "string" ? email.id : null;
      if (!emailId) {
        continue;
      }
      const subject = typeof email?.subject === "string" ? email.subject : null;
      const title =
        typeof (row as Record<string, unknown>).title === "string"
          ? ((row as Record<string, unknown>).title as string)
          : null;
      emails.push({ emailId, title: subject ?? title ?? `(email ${emailId})` });
    }
    return emails;
  }
}

/**
 * Ghost has shipped minor variations of the member-event shape across versions;
 * these mirror `export-bounces.js`'s defensive accessors so the same join keeps
 * working across those shapes.
 */
function eventMemberId(data: Record<string, unknown> | undefined): string | null {
  if (!data) {
    return null;
  }
  if (typeof data.member_id === "string") {
    return data.member_id;
  }
  const member = data.member as Record<string, unknown> | undefined;
  return typeof member?.id === "string" ? member.id : null;
}

function eventEmailId(data: Record<string, unknown> | undefined): string | null {
  if (!data) {
    return null;
  }
  if (typeof data.email_id === "string") {
    return data.email_id;
  }
  const email = data.email as Record<string, unknown> | undefined;
  return typeof email?.id === "string" ? email.id : null;
}

function eventTimestamp(
  event: Record<string, unknown>,
  data: Record<string, unknown> | undefined,
): string | null {
  if (typeof data?.failed_at === "string") {
    return data.failed_at;
  }
  if (typeof data?.created_at === "string") {
    return data.created_at;
  }
  return typeof event.created_at === "string" ? event.created_at : null;
}
