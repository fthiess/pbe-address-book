import { formatCanonicalName, normalizeEmail } from "@pbe/shared";
import { diagnosticLog } from "../audit/diagnostic-log.js";
import type { ProfileCache } from "../data/cache.js";
import type { KeyResolver } from "./ghost-jwks.js";
import type { GhostMemberLookup } from "./ghost-reader.js";
import { JWT_CLOCK_SKEW_SEC, JwtKeyResolutionError, verifyRsJwt } from "./jwt-verify.js";
import type { NonceService } from "./nonce-store.js";
import {
  AuthError,
  type Identity,
  type IdentityProvider,
  type Session,
  type SessionRequest,
} from "./types.js";

/** The 4-hour absolute session cap (DECISIONS D22; ENGINEERING-DESIGN §2.3). */
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * The allowed JWT signing algorithms. Ghost's members API signs with an
 * **asymmetric RS-family** key (currently RS512). The security-critical property
 * (D104) is enforced by the shared {@link verifyRsJwt}: only RSASSA-PKCS1-v1_5
 * variants map to a digest, so `alg:none` and every **symmetric** algorithm (the
 * two classic forges) are rejected before any key is touched.
 */
const DEFAULT_ALGS = ["RS256", "RS512"];

export interface GhostProviderDeps {
  /** Resolver for Ghost's JWKS key by `kid` (see `ghost-jwks.ts`). */
  keyResolver: KeyResolver;
  /** Expected `iss` of the Ghost members JWT. */
  issuer: string;
  /** Expected `aud` of the Ghost members JWT. */
  audience: string;
  /** The single-use callback nonce store (D104/D125). */
  nonceStore: NonceService;
  /** The in-memory dataset, for email→profile resolution. */
  cache: ProfileCache;
  /** Create-if-absent the caller's private `users` doc (stars); role is on the profile (OFC-139). */
  ensureUser: (profileId: number) => Promise<{ stars: number[] }>;
  /**
   * The Ghost member-uuid lookup for the analytics `distinct_id` (D137, OFC-287).
   *
   * **Optional by design, on two axes.** It is the sign-in path's first and only
   * Ghost HTTP dependency — before this, `createSession` resolved identity purely
   * from the verified email against the in-memory profile index and made zero Ghost
   * calls. Leaving it optional means (a) a deploy with no Ghost Admin-API key
   * configured still signs members in, exactly as before, minting uuid-less
   * sessions; and (b) the existing provider tests need no live Ghost and no fake.
   */
  memberLookup?: GhostMemberLookup;
  /** Session lifetime; defaults to the 4-hour cap. */
  sessionTtlMs?: number;
  /** Allowed signing algorithms; defaults to the asymmetric RS family (D104). */
  algorithms?: string[];
}

/**
 * The production identity provider: the real Ghost auth bridge (ENGINEERING-DESIGN
 * §2.1; DECISIONS D20/D21/D104/D97/D115). It is the only provider compiled into
 * the production bundle — the dev provider is excluded entirely (D108).
 *
 * `createSession` is the security-critical heart of the handshake:
 *  1. Verify the Ghost-issued JWT against Ghost's JWKS — signature, `iss`,
 *     `aud`, `exp` — with the **algorithm pinned to the asymmetric RS family**
 *     (Ghost uses RS512 over a 1024-bit key), which rejects `alg:none` and every
 *     symmetric algorithm (the two classic forges, D104). The signature is
 *     checked with Node `crypto` rather than jose, because jose rejects Ghost's
 *     1024-bit key (see `ghost-jwks.ts`).
 *  2. Verify and **consume the single-use `state` nonce** (D104) — replay-proof.
 *  3. Extract the member email from `sub`, **normalize it** (D97), and resolve it
 *     against the in-memory email index. Resolution **fails closed**: no match →
 *     `unlinked_member`; multiple matches → `ambiguous_member` (never a guess).
 *  4. Create-if-absent the brother's `users` document and read their role (R20).
 *  5. Fetch the Ghost member `uuid` for the analytics `distinct_id` (D137) — the
 *     one step that is **allowed to fail**, and the only Ghost HTTP call sign-in
 *     makes. It runs last, after the sign-in has already succeeded.
 *
 * Every failure in steps 1–4 throws an {@link AuthError} carrying the API-SPEC §2
 * status/code.
 */
export class GhostIdentityProvider implements IdentityProvider {
  readonly name = "ghost";

  constructor(private readonly deps: GhostProviderDeps) {}

  async createSession(request: SessionRequest): Promise<Session> {
    const { token, state } = request;
    if (!token) {
      throw new AuthError(401, "invalid_token", "no token supplied");
    }
    if (!state) {
      throw new AuthError(401, "invalid_state", "no state nonce supplied");
    }

    // 1. Cryptographically verify the Ghost JWT (alg/iss/aud/exp pinned).
    const email = await this.verifyAndExtractEmail(token);

    // 2. Resolve the verified email to a single profile, failing closed. This runs
    //    BEFORE the nonce is consumed (OFC-81): a denied account (unlinked /
    //    ambiguous / de-brothered) must not burn the one-time `state` token, so the
    //    denial checks gate first and the nonce is spent only once the sign-in is
    //    actually going to succeed. (No current client can retry a spent nonce —
    //    AuthCallback guards that — but a check should never consume a one-time
    //    token before it has decided to proceed.)
    const resolution = this.deps.cache.resolveByEmail(email);
    if (resolution.kind === "none") {
      throw new AuthError(403, "unlinked_member", "no profile matches this email");
    }
    if (resolution.kind === "ambiguous") {
      throw new AuthError(403, "ambiguous_member", "email matches more than one profile");
    }
    const profile = resolution.profile;

    // De-brother denial (D115; ENGINEERING-DESIGN §2.1): a resolved-but-
    // de-brothered profile is denied a session. The de-brothering already
    // deleted the Ghost member (§5.1); this Book-side check is the
    // belt-and-suspenders half that blocks any lingering token.
    if (profile.debrothered.isDebrothered) {
      throw new AuthError(403, "debrothered", "this member has been de-brothered");
    }

    // 3. Bind the callback to a Book-initiated flow; consume the nonce once — only
    //    now that every denial check has passed, so a rejected sign-in leaves the
    //    nonce unspent (OFC-81).
    const nonceOk = await this.deps.nonceStore.consume(state);
    if (!nonceOk) {
      throw new AuthError(401, "invalid_state", "missing or replayed state nonce");
    }

    // 4. Establish the caller's Book role from the resolved profile (OFC-139): role
    //    now lives on the profile, normalized to `brother` at hydration when the
    //    document omits it, so the value here is always concrete. `ensureUser` still
    //    runs to create-if-absent the private `users` doc that holds their stars (R20).
    await this.deps.ensureUser(profile.id);
    const role = profile.role;

    // 5. Fetch the Ghost member uuid for the analytics `distinct_id` (D137). Deliberately
    //    **last**, after every denial check and after the nonce has been consumed: the
    //    sign-in has already decided to succeed, so nothing this step does — including
    //    failing — can change the outcome. That ordering is what makes the fail-soft
    //    below honest rather than a claim.
    const ghostMemberUuid = await this.lookupMemberUuid(email);

    const identity: Identity = {
      subject: email,
      profileId: profile.id,
      email,
      role,
      displayName: formatCanonicalName(profile, false),
      // Omitted entirely when absent, rather than set to `undefined`: the session is
      // serialized into Firestore, which rejects an explicit `undefined` field value.
      ...(ghostMemberUuid ? { ghostMemberUuid } : {}),
    };
    const ttl = this.deps.sessionTtlMs ?? FOUR_HOURS_MS;
    return { identity, expiresAt: Date.now() + ttl };
  }

  /**
   * The analytics-identity lookup (D137), which **never throws**. A missing uuid costs
   * one session's worth of unidentified Mixpanel events; a thrown error here would cost
   * the brother his sign-in, and D137 is explicit that sign-in must never be blocked by
   * an analytics concern. So every failure mode — Ghost down, timeout, bad key, `400` on
   * the filter, no member at that address — collapses to `undefined`.
   *
   * The two outcomes are logged differently on purpose: no-member is an *expected* state
   * worth noticing (it means Book and Ghost disagree about who exists, which the
   * alignment audit exists to catch), while a throw is an infrastructure fault. Both are
   * `WARNING`, matching the structured shape `ghost-reader.ts` uses for its degraded
   * reads; neither is an `ERROR`, because the sign-in itself succeeded.
   */
  private async lookupMemberUuid(email: string): Promise<string | undefined> {
    if (!this.deps.memberLookup) {
      return undefined;
    }
    try {
      const uuid = await this.deps.memberLookup.findUuidByEmail(email);
      if (!uuid) {
        // The email is NOT logged: sign-in logs are not a PII sink, and the profile id
        // is already the identifier the rest of the log stream keys on.
        warn("ghost member lookup found no member for a verified sign-in email");
        return undefined;
      }
      return uuid;
    } catch (error) {
      warn("ghost member uuid lookup failed, session will be unidentified", describe(error));
      return undefined;
    }
  }

  /**
   * Verify the compact JWT and return its normalized subject email, or throw an
   * `AuthError`. Done with Node's `crypto.verify` (not jose) so it accepts
   * Ghost's 1024-bit RSA key — see `ghost-jwks.ts`. Every D104 property is
   * preserved: the algorithm is pinned to the asymmetric RS family (so
   * `alg:none` and all symmetric algorithms are rejected before any key is
   * touched), the `kid` is required and resolved against the JWKS, and `iss`,
   * `aud`, and `exp` are checked explicitly.
   */
  private async verifyAndExtractEmail(token: string): Promise<string> {
    // Signature + alg-pin + kid-resolve via the shared verifier (OFC-225). A bad
    // token or a key-resolution failure both surface as a `401 invalid_token`
    // during sign-in (unchanged from before the extraction).
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await verifyRsJwt(token, {
        keyResolver: this.deps.keyResolver,
        allowedAlgs: this.deps.algorithms ?? DEFAULT_ALGS,
      }));
    } catch (error) {
      // A `JwtKeyResolutionError` is a **transient** Ghost-JWKS availability fault
      // (OFC-223) — the key endpoint was unreachable, timed out, or returned a 5xx —
      // not a bad token. The client-facing response stays an unchanged `401
      // invalid_token`, but the error is tagged `jwks` so the auth route audits it as
      // the distinct infrastructure event `auth.jwks` (7a-3a) and keeps it out of the
      // sign-in-denial metric. Every other failure — malformed, forged, wrong alg, bad
      // signature, or a **no-matching-`kid`** (a bogus/rotated-away key id, which
      // `jwt-verify` classifies as a `JwtVerifyError`, not a resolution fault) — is a
      // genuine `invalid_token` denial, so a forged-token burst stays in the denial
      // signal rather than masquerading as an outage.
      if (error instanceof JwtKeyResolutionError) {
        throw new AuthError(401, "invalid_token", describe(error), { category: "jwks" });
      }
      throw new AuthError(401, "invalid_token", describe(error));
    }

    // Registered-claim checks (iss / aud / exp / nbf), with a small clock skew.
    const nowSec = Date.now() / 1000;
    if (payload.iss !== this.deps.issuer) {
      throw new AuthError(401, "invalid_token", "unexpected issuer");
    }
    const aud = payload.aud;
    const audMatches = Array.isArray(aud)
      ? aud.includes(this.deps.audience)
      : aud === this.deps.audience;
    if (!audMatches) {
      throw new AuthError(401, "invalid_token", "unexpected audience");
    }
    if (typeof payload.exp !== "number" || payload.exp + JWT_CLOCK_SKEW_SEC < nowSec) {
      throw new AuthError(401, "invalid_token", "token expired");
    }
    if (typeof payload.nbf === "number" && payload.nbf - JWT_CLOCK_SKEW_SEC > nowSec) {
      throw new AuthError(401, "invalid_token", "token not yet valid");
    }

    // Ghost carries the member email in `sub` (ENGINEERING-DESIGN §2.1).
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new AuthError(401, "invalid_token", "token has no subject email");
    }
    return normalizeEmail(payload.sub);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/**
 * A structured `WARNING` for a degraded-but-successful sign-in (matches
 * `ghost-reader.ts`). The `message` is a **constant**; any upstream Ghost error
 * text rides the separate `detail` slot, which the diagnostic logger scrubs — so
 * the P10 shape layer holds here as at every other migrated site, not just the
 * scrub safety net. Sign-in logs are not a PII sink (N14).
 */
function warn(message: string, detail?: string): void {
  diagnosticLog.warn(message, detail !== undefined ? { detail } : undefined);
}
