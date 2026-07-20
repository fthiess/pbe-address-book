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

/**
 * The single-member read the **sign-in path** needs (D137, OFC-287) — deliberately
 * its own one-method interface rather than a fifth method on {@link GhostReader}.
 * The two are implemented by the same class ({@link GhostAdminReader}) so there is
 * one Admin-API config and one transport, but they are separate *seams* because
 * their consumers have opposite tolerances: a report surface wants every member and
 * fails closed with `503`/`502` when Ghost is unreachable, whereas sign-in wants one
 * member, must never block on Ghost, and degrades to a uuid-less session. Declaring
 * the narrow interface is what lets `GhostIdentityProvider` depend on *only* the
 * capability it uses, and lets its tests supply a two-line fake.
 */
export interface GhostMemberLookup {
  /**
   * The Ghost member `uuid` for an already-verified email, or `null` when Ghost
   * has no member at that address. **Throws** on a transport/API failure — the
   * caller decides what a failure means (the provider swallows it; see D137's
   * fail-soft residual). `null` and "threw" are deliberately distinguishable.
   */
  findUuidByEmail(email: string): Promise<string | null>;
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
/**
 * How far back the audit/bounce reader fetches member events (OFC-231). Ghost's
 * member-event feed is **append-only**, so an unbounded `type:…` fetch grows without
 * limit as the years pass — eventually hundreds of paginated round-trips on a
 * synchronous admin request, risking a multi-second-to-timeout latency and a Cloud
 * Run `502` on the very report meant to diagnose Ghost health. Bounding it is safe:
 * the alignment audit needs only the **latest** newsletter event per member (and the
 * newsletter timestamp is advisory anyway — N69), and bounces matter only for
 * **recent** sends (PBE News is bi-annual). Two years spans ~4 newsletter sends, so
 * a 24-month window keeps every useful event while capping the fetch. (A larger page
 * `limit` is *not* an alternative — Ghost 6.0 caps `limit` at 100; OFC-217.)
 */
const EVENT_LOOKBACK_MONTHS = 24;

/**
 * The bound on the sign-in member lookup (OFC-287). Sign-in is interactive and the
 * lookup is *optional* — its only consumer is analytics identity (D137) — so the
 * budget is small: a Ghost that has not answered in this long is a Ghost that should
 * be given up on rather than waited out, and the session proceeds without a uuid.
 * Generous enough not to fire on an ordinary slow response from a small self-hosted
 * instance; short enough to be invisible against the magic-link round-trip.
 */
const MEMBER_LOOKUP_TIMEOUT_MS = 3000;

/**
 * Escape a value for interpolation into a **single-quoted NQL string**. Ghost's
 * filter documentation is explicit that a quote appearing inside a quoted string
 * must be escaped; the escape character is a backslash, so the backslash itself
 * must be doubled — and **doubled first**, or escaping the quote would produce a
 * `\'` that the subsequent backslash pass would turn back into `\\'`, re-exposing
 * the quote it was meant to neutralize.
 *
 * This is not theoretical for an email address: `'` is valid RFC 5322 atext, so
 * `o'brien@example.test` is an ordinary address that a fraternity roster will
 * eventually contain. Unescaped it terminates the NQL string after `o`, and the
 * two outcomes are a silent no-match (that brother is never identified) or — far
 * worse — a mangled filter that matches a **different** member, whose uuid would
 * then be adopted as this caller's `$user_id`. Under Simplified ID Merge that
 * misattribution is unrecoverable (D137), which is what makes this worth
 * foreclosing at the string level rather than trusting Ghost to reject it.
 *
 * Double quotes are escaped too: they cannot terminate a single-quoted string, but
 * Ghost's docs name both quote characters, so this follows the documented rule
 * rather than a narrower reading of it.
 */
function escapeNql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/['"]/g, "\\$&");
}

export class GhostAdminReader implements GhostReader, GhostMemberLookup {
  private readonly http: GhostAdminHttp;
  /** Injectable clock for the event-fetch cutoff; defaults to the wall clock. */
  private readonly now: () => number;
  /** The sign-in lookup's wait budget; defaults to {@link MEMBER_LOOKUP_TIMEOUT_MS}. */
  private readonly memberLookupTimeoutMs: number;

  constructor(
    config: Omit<GhostAdminConfig, "newsletterId"> & {
      newsletterId?: string;
      /** Test seam for {@link EVENT_LOOKBACK_MONTHS}'s cutoff; defaults to `Date.now`. */
      now?: () => number;
      /**
       * Test seam for {@link MEMBER_LOOKUP_TIMEOUT_MS}. Exists so the abort-path test
       * runs in milliseconds instead of stalling the suite for the real budget; not
       * intended as a production knob (nothing in `index.ts` sets it).
       */
      memberLookupTimeoutMs?: number;
    },
  ) {
    this.http = new GhostAdminHttp({
      apiUrl: config.apiUrl,
      adminApiKey: config.adminApiKey,
      acceptVersion: config.acceptVersion,
      fetchImpl: config.fetchImpl,
    });
    this.now = config.now ?? (() => Date.now());
    this.memberLookupTimeoutMs = config.memberLookupTimeoutMs ?? MEMBER_LOOKUP_TIMEOUT_MS;
  }

  /**
   * The lower `created_at` bound for the event fetch — `YYYY-MM-DD`,
   * {@link EVENT_LOOKBACK_MONTHS} before now (UTC). **Day** granularity is ample for a
   * multi-year advisory window and sidesteps time-of-day / timezone ambiguity in the
   * NQL date literal (Ghost parses a bare `'YYYY-MM-DD'` unambiguously).
   */
  private eventCutoff(): string {
    const cutoff = new Date(this.now());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - EVENT_LOOKBACK_MONTHS);
    return cutoff.toISOString().slice(0, 10);
  }

  /**
   * Emit a structured `WARNING` for a best-effort read that degraded rather than
   * failing the whole report — the shared shape for the two swallow sites below
   * ({@link listNewsletterEvents}'s advisory events, {@link listNewsletterEmails}'s
   * optional titles).
   */
  private logDegraded(message: string): void {
    process.stderr.write(`${JSON.stringify({ logType: "error", severity: "WARNING", message })}\n`);
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

  /**
   * {@link GhostMemberLookup.findUuidByEmail} — the sign-in path's single-member read
   * (D137, OFC-287). A **single** request, not `getAll`: exactly one member can match
   * an email in Ghost, so pagination is pointless and each extra round-trip is latency
   * on the magic-link callback.
   *
   * Two encoding subtleties, both verified against Ghost's docs rather than assumed
   * (OFC-275 is the standing reminder that a wrong NQL filter `400`s):
   *
   *  - The email is wrapped in **single quotes** inside the NQL filter. Ghost's filter
   *    syntax only requires quoting for strings containing syntax characters, but an
   *    email always contains `@` and may contain `+`, and an unquoted `+` is NQL's AND
   *    operator — `fred+news@x.com` unquoted parses as two clauses and silently matches
   *    nothing. Quoting is unconditional here so the rare address is not a special case.
   *  - `URLSearchParams` percent-encodes the assembled value (`+` → `%2B`, `@` → `%40`),
   *    which is the second half of what Ghost requires; building the query string by
   *    hand would reintroduce the `+`-means-space bug.
   *
   * `limit: "1"` because a match is unique and an unbounded page is wasted bytes.
   */
  async findUuidByEmail(email: string): Promise<string | null> {
    const query = new URLSearchParams({ filter: `email:'${escapeNql(email)}'`, limit: "1" });
    const body = (await this.http.request("GET", `/members/?${query.toString()}`, undefined, {
      timeoutMs: this.memberLookupTimeoutMs,
    })) as { members?: unknown } | undefined;
    const rows = body?.members;
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }
    const uuid = (rows[0] as Record<string, unknown>).uuid;
    // Defensive, in the house style: a member row without a string `uuid` is treated
    // as "no uuid" rather than trusted into the session and on to Mixpanel, where a
    // wrong `$user_id` is unrecoverable under Simplified ID Merge (D137).
    return typeof uuid === "string" && uuid.length > 0 ? uuid : null;
  }

  async listNewsletterEvents(): Promise<GhostNewsletterEvent[]> {
    // Bounded to the last EVENT_LOOKBACK_MONTHS (OFC-231): the `+` is NQL's AND, so
    // this is "newsletter events created after the cutoff". The date field is
    // `data.created_at`, not the bare `created_at`: Ghost's `/members/events` filter
    // allowlist is `[data.created_at, data.member_id, data.post_id, type, id]`, and a
    // bare `created_at` is rejected `400 "Cannot filter by created_at"` (OFC-275).
    let rows: unknown[];
    try {
      rows = await this.http.getAll("/members/events/", "events", {
        filter: `type:newsletter_event+data.created_at:>'${this.eventCutoff()}'`,
      });
    } catch (error) {
      // Advisory (N69): the audit enriches newsletterDrift with a Ghost-side change
      // timestamp, but a missing `ghostChangedAt` degrades the report, it does not
      // break it. So swallow a read failure to `[]` rather than 502 the whole audit —
      // mirroring the best-effort `listNewsletterEmails` swallow below. (The bounce
      // report's `listBounceEvents` genuinely needs its events and does NOT swallow.)
      this.logDegraded(
        `ghost-audit: newsletter change timestamps unavailable: ${(error as Error).message}`,
      );
      return [];
    }
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
    // Bounded to the last EVENT_LOOKBACK_MONTHS (OFC-231): bounces matter only for
    // recent sends, so old failure events are dropped rather than paginated forever.
    // Date field is `data.created_at`, not the bare `created_at` (OFC-275; see the
    // allowlist note in listNewsletterEvents). NOT swallowed on failure: the bounce
    // report needs these events, so a read error must surface as 502, not an empty
    // (and misleadingly "clean") report.
    const rows = await this.http.getAll("/members/events/", "events", {
      filter: `type:email_failed_event+data.created_at:>'${this.eventCutoff()}'`,
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
      this.logDegraded(`bounce-report: newsletter titles unavailable: ${(error as Error).message}`);
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
