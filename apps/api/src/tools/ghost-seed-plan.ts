/**
 * The pure half of `ghost-seed.ts` (OFC-340 / D183): given the stored profile
 * documents and the Ghost member list, decide which profiles are linked to which
 * Ghost member and what each link writes.
 *
 * THE MATCH. A profile with no `ghostMemberId` is matched to the Ghost member at
 * its primary `email`; failing that, to the member at its `alternateEmail`. Emails
 * are compared normalized (`normalizeEmail`), so case and Unicode form never split
 * a match. A deceased or de-brothered profile is never linked (D80/D115 — it is
 * expected to have no member). A profile that already carries a `ghostMemberId` is
 * never re-linked, whatever Ghost holds at its addresses.
 *
 * WHAT A LINK WRITES.
 *  - `ghostMemberId` — always.
 *  - `adminNote` — the member's Ghost note, only when Book's is blank.
 *  - `allowNewsletterEmail` — OVERWRITTEN from Ghost when the two disagree, with
 *    `newsletterConsentChangedAt` taken from Ghost (its newsletter event, else the
 *    member's `updated_at`). The genesis load stamped every living brother `true`
 *    as a placeholder (D180), so until this runs Ghost holds the only real consent
 *    state. The exception is a profile whose consent stamp is NOT the genesis
 *    placeholder: the brother (or staff) changed it in Book since launch, which is
 *    a real choice — the link is still made, the consent is left alone and the
 *    disagreement is reported for a human.
 *  - a Ghost email push — when the match was on the ALTERNATE address only, the
 *    member's email is moved to the profile's primary (Forrest's call: the
 *    newsletter going somewhere other than the Book primary was never intended).
 *
 * WHAT IS ONLY REPORTED. A second member belonging to an already-matched brother
 * (`leftovers` — a human decides whether to delete it), a member no profile
 * accounts for (`unmatched`), and every case the rules above refuse to guess at
 * (`conflicts`). The tool deletes nothing in Ghost.
 *
 * Kept separate from the CLI so every rule is unit-tested without Firestore or a
 * network.
 */
import { normalizeEmail } from "@pbe/shared";

/** The subset of a stored profile document the planner reads. */
export interface SeedProfileSource {
  email?: unknown;
  alternateEmail?: unknown;
  ghostMemberId?: unknown;
  adminNote?: unknown;
  allowNewsletterEmail?: unknown;
  newsletterConsentChangedAt?: unknown;
  deceased?: unknown;
  debrothered?: unknown;
}

/** A Ghost member, projected to what the seed reads. */
export interface SeedMember {
  id: string;
  email: string;
  /** Derived from the `newsletters` relation (authoritative in Ghost v5). */
  subscribed: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeedConsent {
  allowNewsletterEmail: boolean;
  /** The Ghost-side change time written to `newsletterConsentChangedAt`. */
  changedAt: string;
  /** Where `changedAt` came from: a newsletter event, or the member's `updated_at`. */
  source: "event" | "member";
}

export interface SeedAction<Token = unknown> {
  /** The Firestore document id (`String(id)`), carried verbatim. */
  docId: string;
  /** The document's `updateTime` at the read; the write is conditional on it. */
  token: Token;
  ghostMemberId: string;
  /** The matched member's Ghost email, for the plan's reviewer. */
  memberEmail: string;
  matchedOn: "email" | "alternateEmail";
  /** Present only when Book's note is blank and Ghost's is not. */
  adminNote?: string;
  /** Present only when Ghost's subscription state overwrites Book's. */
  consent?: SeedConsent;
  /** Present only for an alternate-only match: move the member to the primary address. */
  ghostEmailPush?: { from: string; to: string };
  /** The values the write replaces — the undo record. */
  prior: { allowNewsletterEmail?: boolean; newsletterConsentChangedAt?: string };
}

export type LeftoverReason =
  /** The brother's other member, at his alternate address. */
  | "second-member-at-alternate"
  /** A member at an address of a profile already linked to a different member. */
  | "extra-member-of-linked-profile"
  /** A member at an address of a deceased or de-brothered profile. */
  | "member-of-exempt-profile";

export interface SeedLeftover {
  docId: string;
  memberId: string;
  email: string;
  subscribed: boolean;
  createdAt: string;
  reason: LeftoverReason;
  /** True when this member's subscription state differs from the brother's kept member. */
  subscriptionDiffers: boolean;
}

export type ConflictKind =
  /** The stored `ghostMemberId` names no current Ghost member. */
  | "stale-ghost-member-id"
  /** Already linked, and Book's consent disagrees with the linked member's. */
  | "linked-consent-mismatch"
  /** Consent disagrees, but Book's was changed since the genesis load — left alone. */
  | "book-consent-changed-since-launch"
  /** The matched member is already another profile's `ghostMemberId`. */
  | "member-linked-to-another-profile";

export interface SeedConflict {
  docId: string;
  kind: ConflictKind;
  memberId?: string;
}

export interface GhostSeedPlan<Token = unknown> {
  seeds: SeedAction<Token>[];
  /** Profiles whose stored `ghostMemberId` resolves to a live member; untouched. */
  alreadyLinked: string[];
  /** Living, non-de-brothered profiles with an email but no member at any address. */
  ghostlessWithEmail: string[];
  /** Living, non-de-brothered profiles with no email (normal: ~1/3 of the roster). */
  ghostlessNoEmail: number;
  /** Deceased or de-brothered profiles — never linked. */
  exempt: number;
  leftovers: SeedLeftover[];
  conflicts: SeedConflict[];
  /** Members no profile accounts for. */
  unmatched: SeedMember[];
  /** The genesis placeholder stamp the consent rule keyed on, and how many carry it. */
  genesisConsentStamp: { value: string | null; count: number };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function emailKey(value: unknown): string {
  const raw = text(value);
  return raw === "" ? "" : normalizeEmail(raw);
}

function flag(container: unknown, key: string): boolean {
  return (
    typeof container === "object" &&
    container !== null &&
    (container as Record<string, unknown>)[key] === true
  );
}

/**
 * The genesis load stamped every profile's `newsletterConsentChangedAt` with one
 * load instant (D180), so that instant is the most common value by a wide margin.
 * A profile carrying any other stamp had its consent changed in Book since.
 */
function mostCommonConsentStamp(docs: readonly { data: SeedProfileSource }[]): {
  value: string | null;
  count: number;
} {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    const stamp = text(doc.data.newsletterConsentChangedAt);
    if (stamp !== "") {
      counts.set(stamp, (counts.get(stamp) ?? 0) + 1);
    }
  }
  let best: { value: string | null; count: number } = { value: null, count: 0 };
  for (const [value, count] of counts) {
    if (count > best.count) {
      best = { value, count };
    }
  }
  return best;
}

/** The lookups and the accumulating plan, shared by the per-profile steps. */
interface PlanContext<Token> {
  plan: GhostSeedPlan<Token>;
  memberById: Map<string, SeedMember>;
  memberByEmail: Map<string, SeedMember>;
  /** Every member id some profile already stores. */
  linkedMemberIds: Set<string>;
  /** Every member the plan has accounted for (linked, seeded, or a leftover). */
  accounted: Set<string>;
  consentEventAt: ReadonlyMap<string, string>;
}

type SeedDoc<Token> = { id: string; data: SeedProfileSource; token: Token };

function addLeftover<Token>(
  ctx: PlanContext<Token>,
  docId: string,
  member: SeedMember,
  reason: LeftoverReason,
  keptSubscribed: boolean | null,
): void {
  ctx.accounted.add(member.id);
  ctx.plan.leftovers.push({
    docId,
    memberId: member.id,
    email: member.email,
    subscribed: member.subscribed,
    createdAt: member.createdAt,
    reason,
    subscriptionDiffers: keptSubscribed !== null && keptSubscribed !== member.subscribed,
  });
}

/** The distinct members at a profile's two addresses. */
function membersAt(atPrimary?: SeedMember, atAlternate?: SeedMember): SeedMember[] {
  return [...new Set([atPrimary, atAlternate])].filter((m): m is SeedMember => m !== undefined);
}

/** A profile that already stores a `ghostMemberId`: never re-linked, only reported on. */
function planLinked<Token>(
  ctx: PlanContext<Token>,
  doc: SeedDoc<Token>,
  storedId: string,
  candidates: readonly SeedMember[],
): void {
  const linked = ctx.memberById.get(storedId);
  if (linked) {
    ctx.accounted.add(linked.id);
    ctx.plan.alreadyLinked.push(doc.id);
    if (linked.subscribed !== (doc.data.allowNewsletterEmail === true)) {
      ctx.plan.conflicts.push({
        docId: doc.id,
        kind: "linked-consent-mismatch",
        memberId: linked.id,
      });
    }
  } else {
    ctx.plan.conflicts.push({ docId: doc.id, kind: "stale-ghost-member-id", memberId: storedId });
  }
  for (const member of candidates) {
    if (member.id !== storedId) {
      addLeftover(
        ctx,
        doc.id,
        member,
        "extra-member-of-linked-profile",
        linked ? linked.subscribed : null,
      );
    }
  }
}

/**
 * Decide the consent half of a link: overwrite Book's genesis placeholder from
 * Ghost, or — when Book's stamp is not the placeholder — leave it and report.
 */
function planConsent<Token>(
  ctx: PlanContext<Token>,
  doc: SeedDoc<Token>,
  match: SeedMember,
  action: SeedAction<Token>,
): void {
  const bookConsent = doc.data.allowNewsletterEmail === true;
  if (match.subscribed === bookConsent) {
    return;
  }
  const genesis = ctx.plan.genesisConsentStamp.value;
  const bookStamp = text(doc.data.newsletterConsentChangedAt);
  if (genesis === null || bookStamp !== genesis) {
    ctx.plan.conflicts.push({
      docId: doc.id,
      kind: "book-consent-changed-since-launch",
      memberId: match.id,
    });
    return;
  }
  const eventAt = ctx.consentEventAt.get(match.id);
  action.consent = {
    allowNewsletterEmail: match.subscribed,
    changedAt: eventAt ?? match.updatedAt,
    source: eventAt ? "event" : "member",
  };
  action.prior = { allowNewsletterEmail: bookConsent, newsletterConsentChangedAt: bookStamp };
}

/** A living, unlinked profile: link it to its member, or count it Ghost-less. */
function planUnlinked<Token>(
  ctx: PlanContext<Token>,
  doc: SeedDoc<Token>,
  primaryKey: string,
  atPrimary?: SeedMember,
  atAlternate?: SeedMember,
): void {
  const { plan } = ctx;
  const match = atPrimary ?? atAlternate;
  if (!match) {
    if (primaryKey === "") {
      plan.ghostlessNoEmail++;
    } else {
      plan.ghostlessWithEmail.push(doc.id);
    }
    return;
  }
  // Book keeps `email` and `alternateEmail` in one uniqueness namespace, so two
  // profiles claiming one member means the data is not what this tool assumes.
  if (ctx.linkedMemberIds.has(match.id) || plan.seeds.some((s) => s.ghostMemberId === match.id)) {
    plan.conflicts.push({
      docId: doc.id,
      kind: "member-linked-to-another-profile",
      memberId: match.id,
    });
    return;
  }
  ctx.accounted.add(match.id);
  if (atPrimary && atAlternate && atAlternate.id !== atPrimary.id) {
    addLeftover(ctx, doc.id, atAlternate, "second-member-at-alternate", atPrimary.subscribed);
  }

  const action: SeedAction<Token> = {
    docId: doc.id,
    token: doc.token,
    ghostMemberId: match.id,
    memberEmail: match.email,
    matchedOn: atPrimary ? "email" : "alternateEmail",
    prior: {},
  };
  if (text(doc.data.adminNote) === "" && match.note.trim() !== "") {
    action.adminNote = match.note.trim();
  }
  planConsent(ctx, doc, match, action);
  // An alternate-only match moves the member to the primary address. (An
  // `alternateEmail` is only valid alongside an `email`, so the primary exists;
  // the guard keeps a malformed record from pushing an empty address.)
  if (!atPrimary && primaryKey !== "") {
    action.ghostEmailPush = { from: match.email, to: primaryKey };
  }
  plan.seeds.push(action);
}

export function planGhostSeed<Token>(
  docs: readonly SeedDoc<Token>[],
  members: readonly SeedMember[],
  /** Latest newsletter-event time per member id, where one was fetched. */
  consentEventAt: ReadonlyMap<string, string> = new Map(),
): GhostSeedPlan<Token> {
  const ctx: PlanContext<Token> = {
    plan: {
      seeds: [],
      alreadyLinked: [],
      ghostlessWithEmail: [],
      ghostlessNoEmail: 0,
      exempt: 0,
      leftovers: [],
      conflicts: [],
      unmatched: [],
      genesisConsentStamp: mostCommonConsentStamp(docs),
    },
    memberById: new Map(members.map((m) => [m.id, m])),
    memberByEmail: new Map(members.map((m) => [normalizeEmail(m.email), m])),
    linkedMemberIds: new Set(docs.map((d) => text(d.data.ghostMemberId)).filter((id) => id !== "")),
    accounted: new Set(),
    consentEventAt,
  };

  for (const doc of docs) {
    const primaryKey = emailKey(doc.data.email);
    const alternateKey = emailKey(doc.data.alternateEmail);
    const atPrimary = primaryKey === "" ? undefined : ctx.memberByEmail.get(primaryKey);
    const atAlternate = alternateKey === "" ? undefined : ctx.memberByEmail.get(alternateKey);
    const candidates = membersAt(atPrimary, atAlternate);
    const storedId = text(doc.data.ghostMemberId);

    if (flag(doc.data.deceased, "isDeceased") || flag(doc.data.debrothered, "isDebrothered")) {
      ctx.plan.exempt++;
      for (const member of candidates) {
        addLeftover(ctx, doc.id, member, "member-of-exempt-profile", null);
      }
    } else if (storedId !== "") {
      planLinked(ctx, doc, storedId, candidates);
    } else {
      planUnlinked(ctx, doc, primaryKey, atPrimary, atAlternate);
    }
  }

  ctx.plan.unmatched = members.filter((member) => !ctx.accounted.has(member.id));
  return ctx.plan;
}
