# PBE Address Book — Triage Brief 5: Auth & input hardening

The pre-session brief for **Triage Session 5** per [`TRIAGE-PLAN.md`](TRIAGE-PLAN.md) §5 — the **auth-seam and untrusted-input hardening** cluster. It proposes a disposition (a/b/c/d) and a fix sketch for the eleven security findings assigned here — **S3, S4, S5, S7, S8, S11, S14, S15, S16, S18, S19** — plus it lands the implementation home of **P9** (the `Referrer-Policy`, already ratified (a) in Session 3) inside the S14 security-headers bundle. Per the §10 workflow you set on 2026-06-08, this brief is drafted **in-session**, immediately before the live triage that follows it.

> **Status:** Drafted 2026-06-11 at **High** depth (TRIAGE-PLAN §7), before the live Session 5 (live · **Medium–High**). **Every disposition here is a proposal, not a decision.** The recording surfaces (the composite §12 worksheet; the eight delivered docs; `DECISIONS.md` `D104+`) stay untouched until you ratify live. Provisional `D##` numbers (**D104–D108**) are drafts to be finalized/renumbered in the resolution pass (TRIAGE-PLAN §6). Input: [`DESIGN-REVIEW-COMPOSITE.md`](DESIGN-REVIEW-COMPOSITE.md) findings **S3, S4, S5, S7, S8, S11, S14, S15, S16, S18, S19** (and the already-dispositioned **P9**), plus `DECISIONS.md` **D20, D21, D22, D23, D24, D28, D51, D54, D55, D58, D62, D64, D72** and the Session-2/3/4 decisions **D78, D83, D86, D94, D99, D100, D101, D102, D103** read in full.
>
> **This session has the high ratify ratio TRIAGE-PLAN §5 predicted — but two of its findings were quietly reshaped by Session 4, which is the interesting part.** Unlike Session 3 (values calls under D77) or Session 4 (real reliability gaps the design conceded), Session 5 is **standard security best-practice the spec under-pinned** — the spec says a field is "rejected" without pinning *allowlist vs. denylist*, says the JWT is "verified" without pinning the *algorithm*, lists HSTS without listing a *CSP*. So almost everything is **(a) fix**, and the judgment is *which mechanism* and *how deep*, not *whether*. The two genuine forks are **S5** (how far to bound the accepted Ghost dependency, and whether step-up confirmation is worth it — or even meaningful) and **S16** (the depth of the dev-bypass lockdown). The one piece of real intellectual content beyond ratification: **Session 4 already overtook part of S5.** D99 closed the email-collision *takeover* path (S2); D100 **dropped Directory bulk-delete and made restore an offline operation**; D101 pushed the tampered-backup-plants-admin vector down to *"backup-bucket security + the S5 threat model."* So the reviewer's "add step-up for restore / bulk-delete / role grants" list has **shrunk to essentially role grants + single delete**, and S5's live residual is narrower than the raw finding reads.
>
> **Strengths this session must not dismantle (composite §9 / TRIAGE-PLAN principle 6):** server-side projection as the *sole* enforcement point (the S3 write-allowlist is its write-side dual, not a replacement); the **fragment-carried token** (D20 — the S8 nonce must ride *with* it, not undo it); the dedicated **server-set `verify` action** (D28 — S3/S4 protect exactly what it exists to protect); secrets in Secret Manager and the **keyless service-account path** (D58 — untouched here). Every fix below hardens an edge around these, none rearchitects them.

---

## What Session 5 settles

The composite's executive summary named the security fundamentals as *credited* — both reviewers volunteered that server-side projection, the read-only Ghost audit, the server-set `verify`, Secret-Manager secrets, and the keyless SA path are sound. Session 5's eleven findings are the **gaps around those good instincts**: the places where the spec states an *intent* ("out-of-scope fields are rejected," "the JWT is verified," "the last admin can't be demoted") but never pins the *enforcement mechanism* a builder would follow, and the standard hardening layers (CSP, alg-pinning, scheme allowlisting, decoded-image bounds, CORS scoping) that simply aren't written down yet.

The honest framing: **Book's security architecture is right and its security *contract* is under-specified.** None of this is "the design is wrong." It is "pin the mechanism so a naïve-but-faithful implementation can't introduce the hole." Sorted by the judgment each actually needs:

1. **The genuine forks (2).** **S5** — accept Ghost as a single point of total compromise (D54) with a *documented threat model*, and decide whether to add step-up confirmation for the few remaining online destructive actions (role grants; single delete). The sharp, slightly counter-intuitive point: **every authentication factor Book has traces back to the same Ghost identity, so an in-Book "step-up" is weak unless it goes out-of-band** — which costs infra a 1–2-admin volunteer nonprofit may not want. **S16** — harden the `DevIdentityProvider` bypass (D72) beyond its single env gate; really a "confirm the full belt-and-suspenders set" rather than a values call.
2. **Authorization-model pins — (a) fix, ratify-the-mechanism (3).** **S3** positive per-role write allowlist (mass-assignment), **S4** object-level owner/role predicate (IDOR), **S18** the last-admin invariant enforced server-side. These three are one coherent "who may write what, to whom" decision.
3. **Input & transport hardening — (a) fix, near-obvious (5).** **S7** JWT alg-pinning, **S8** login-CSRF `state`/nonce + redirect allowlist, **S11** decoded-image bounding, **S15** strict URL-scheme allowlist, **S14** CSP + headers (carrying P9's `Referrer-Policy`), **S19** deny-by-default CORS + host-only session cookie.

**Net effort:** make the **S5** call (threat model + step-up posture), confirm the **S16** lockdown depth, and ratify ~8 mechanism pins. No `(b) as-designed` escapes except the *architectural-residual half of S5* — the Ghost blast-radius dependency stays accepted (D54) with a written threat model, while its *closable* replay/forced-login facets are (a)-fixed.

| # | Finding · sev | Proposed disposition | The call that is yours |
|---|---|---|---|
| **S5** | Ghost token not minted for Book; a Ghost compromise = total Book compromise; no step-up · `blocker` | **(a) fix the closable vectors + (b) accept the architectural residual** — close replay/forced-login via S7+S8 and the D22 cap; **accept** the blast-radius dependency (D54) with a documented threat model that absorbs D101's offline-restore residual · **D105** | **The fork:** add step-up confirmation for role grants / single delete, or rely on the threat model + existing typed-ack confirmations? (And note step-up is weak unless out-of-band.) |
| **S16** | `DevIdentityProvider` is a single-gate total auth bypass · `should-fix` | **(a) fix** — compile it out of the prod bundle entirely + keep the runtime env gate + a CI assertion the prod artifact can't instantiate it + a startup alert if ever loaded under prod config · **D108** | Confirm the full layered set (it's cheap; blast radius is total) |
| **S3** | Field-write authz unspecified — mass-assignment · `blocker` | **(a) fix** — positive per-role **writable-field allowlist**; reject (422/403), never silently ignore; all system/verification/Ghost fields unwritable via PATCH/POST; consent/privacy fields owner-only · **D106** | Ratify; confirm the per-role write matrix is enumerated (the dual of the read projection) |
| **S4** | Object-level authz / IDOR on edits, `verify`, `stars` · `blocker` | **(a) fix** — mandate the server-side predicate `profileId == session.profileId OR role ∈ {manager,admin}` before any write; owner-vs-other on `verify`; scope `stars` writes to the `stars` field only · folded into **D106** | Ratify |
| **S18** | Last-admin safeguard appears UI-only · `should-fix` | **(a) fix** — enforce the last-admin invariant **server-side** in the role endpoint, independent of the UI; audit before/after on every role change (feeds D101's forensic roster log) · folded into **D106** | Ratify |
| **S7** | JWT verification doesn't pin the algorithm · `should-fix` | **(a) fix** — pin Ghost's asymmetric `alg`/`kid` from JWKS; reject `alg:none` and any symmetric alg; unit-test forged-`alg` · **D104** | Ratify |
| **S8** | No `state`/nonce on the auth callback (login CSRF); redirect-target integrity unstated · `should-fix` | **(a) fix** — single-use Book-generated `state`/nonce verified at callback (rides *with* D20's fragment); hardcode/allowlist every redirect target · **D104** | Ratify; confirm the nonce doesn't disturb the fragment handoff |
| **S11** | Image pipeline under-bounded (decode bombs, transcoder RCE) · `should-fix` | **(a) fix** — cap **decoded** W×H + total pixels before/at decode; decoder mem/time limits; verify magic bytes; pin+patch the imaging lib; least-privileged transcode · **D107** | Pin the max-decoded-pixels number |
| **S15** | Stored XSS via user URLs if scheme not strictly allowlisted · `should-fix` | **(a) fix** — strict `http`/`https` scheme allowlist on write (reject `javascript:`/`data:`); `rel="noopener noreferrer"` on render · folded into **D107** | Ratify |
| **S14** | No CSP or standard security headers beyond HSTS · `should-fix` | **(a) fix** — strict CSP (script/style/connect/img/frame-ancestors, **allowlisting the Mixpanel + Ghost/CDN origins**), `nosniff`, a framing policy, and the **P9 `Referrer-Policy`** · folded into **D107** | Confirm the CSP allowlist explicitly admits D62's Mixpanel script |
| **S19** | CORS + session-cookie domain scoping unstated · `minor` | **(a) fix** — deny-by-default CORS on `/api/*`; session cookie **host-only** on `book.pbe400.org` (no `Domain=.pbe400.org`), extending D23's CDN-cookie discipline · folded into **D107** | Ratify |

---

## §1 · The auth-token seam — S7, S8, and the S5 fork

These three are one story told at rising stakes: S7 hardens *how the token is verified*, S8 hardens *how the token arrives*, and S5 asks *what it means that the token is a Ghost token, not a Book token* — the architectural question the first two only partially answer.

### S7 — JWT verification does not pin the algorithm · `should-fix`

**What it is.** D20/§2.1 verify the Ghost JWT for "signature, `aud`, `iss`, `exp`" against Ghost's JWKS, but the expected **algorithm is never pinned**. The two classic bypasses are open: `alg: none` (a token with no signature passes if the verifier honors the header), and `alg: HS256` using the RSA *public* key (which is, by definition, public) as an HMAC secret — letting anyone forge a valid-looking token.

**The fix — clean (a).** Pin verification to Ghost's specific asymmetric `alg` and `kid` from JWKS; **reject `none` and every symmetric algorithm** outright; unit-test the forged-`alg` cases (a natural addition to the §6.6 JWT-against-mocked-JWKS tests already mandated by D65). This is pure hardening of a control that already exists — no design tension.

### S8 — No `state`/nonce on the callback (login CSRF), and redirect-target integrity is unstated · `should-fix`

**What it is.** Two facets. **(a) Forced login:** the fragment handoff (D20) has no `state`/nonce tying the callback to a flow *this* user initiated, so an attacker can deliver `…/auth/callback#token=<attacker token>` and silently establish the victim's browser as a session for the **attacker's** identity — the victim then edits/acts inside the attacker's account (a quiet data-poisoning / phishing vector, not a takeover of the victim). **(b) Open redirect:** if any redirect target in the bridge (Ghost Portal's `return`, or the callback URL) is caller-parameterizable, it becomes an open redirect that leaks the `#token` to an attacker origin — *that* is a takeover.

**The fix — clean (a), and it must respect D20.** Add a **single-use, Book-generated `state`/nonce** stored server-side at flow initiation and verified at the callback; **hardcode/allowlist every redirect target** so neither the Portal `return` nor the token-bearing destination can be attacker-controlled. The one design-coherence note: D20 deliberately carries the token in the URL **fragment** to keep it out of logs/history/`Referer` — the nonce must ride *alongside* that mechanism (e.g. a nonce in the initiation state + the token in the fragment), not replace the fragment with a query parameter that would re-expose the token. The two are orthogonal (D20 stops *leakage*; the nonce stops *forged flow*), so they compose cleanly.

> **Provisional D104 — Auth-token hardening: JWT verification pins Ghost's asymmetric `alg`/`kid` and rejects `none`/symmetric (S7); the auth callback carries a single-use Book-generated `state`/nonce verified server-side, and every redirect target (Portal `return`, callback) is hardcoded/allowlisted (S8) — both composing with D20's fragment-carried token, not replacing it.** Records to `ENGINEERING-DESIGN §2.1`/`§2.7`, `API-SPEC §2`.
>
> **Your call (S7/S8):** ratify both; confirm the nonce is layered *with* the fragment handoff (D20), not in place of it.

### S5 — The token is Ghost's, not Book's: a Ghost compromise is a total Book compromise, with no step-up · `blocker`

**What it is — three facets, and only some are closable.** Book authenticates with the token from Ghost's `/members/api/session`, whose `aud`/`iss` are the *Ghost members API*, not Book. The composite decomposes the finding:
- **(i) Replay / audience confusion** *(A-2 #4, live)* — verifying `aud` only proves "a Ghost members token," not "a token issued *for Book*." Anyone who can read a member's Ghost session token (XSS on `pbe400.org`, the comments widget, a future Ghost integration, a shared analytics script) can POST it to `/api/auth/session` and get a full Book session as that member. It's a bearer token with no proof-of-possession.
- **(ii) Blast radius** *(A-2 #19 / B-2 #2, architectural)* — Book derives *all* authorization, including admin, from the resolved email. Anyone who can mint or obtain a Ghost token for an admin's email (a Ghost Pro breach, a signing-key leak, control of an admin's email) gets full Book admin.
- **(iii) No step-up** — there's no second factor or out-of-band confirmation for the most destructive actions (the reviewer named delete-all, restore, role grants).

**Why this is the §10 decision-tension, and why Session 4 already moved it.** D54 *accepts* that Book hard-depends on Ghost — facet (ii) is, by design, an accepted architectural dependency, and the question is only whether to *bound its blast radius*, not whether to remove it (you can't; Ghost is the auth). What's changed since the reviewers wrote this: **the destructive-action surface (iii) has shrunk.** D100 **dropped Directory bulk-delete** and made **restore an offline operation** (an operator console behind backup-bucket ACLs, no longer an in-app button); D101 explicitly pushed the *"admin is socially-engineered into restoring a tampered backup that plants `role:admin`"* vector **down to backup-bucket security + this threat model**, and added a forensic privileged-roster log. And D99 already closed the *other* path to a wrong-profile takeover (the email-collision attack S2 named). So of the reviewer's "delete-all / restore / role grants," **delete-all and restore are no longer online actions** — the live online destructive surface is essentially **role grants (Toggle Privileges, D51) and single-profile delete.**

**The fix — (a) the closable parts, (b) the accepted residual, with a written threat model.**
- **Facet (i) replay/forced-login is closable and largely closed by §1:** the S8 nonce binds the handoff to a Book-initiated flow, S7 forecloses forged tokens, and D22's 4-hour server-side cap bounds how long a stolen token stays useful. The residual — an attacker who *steals a live victim token via XSS on `pbe400.org`* — is closed by **hardening `pbe400.org`** (the shared origin), which belongs in the threat model as an explicit dependency. A true Book-specific-audience token would be ideal but Ghost Pro exposes no way to mint one (D20 documents exactly this constraint), so handoff-binding is the realistic mechanism.
- **Facet (ii) blast radius is the accepted dependency (D54):** document it honestly — "Book's trust equals anyone who can obtain a member's (or admin's) Ghost token; Ghost Pro's security *is* Book's security for authorization." This is **(b) as-designed with a documented threat-model note**, the classic shape the composite's editor flagged for this finding.
- **Facet (iii) step-up — the genuine fork.** Here is the sharp argument worth your judgment: **every factor Book possesses derives from the same Ghost identity, so an *in-Book* step-up (re-enter, re-confirm) authenticates nothing new — it's the same compromised session confirming itself.** A *meaningful* step-up has to be **out-of-band** (an email/SMS confirmation to a separately-controlled channel), which adds infrastructure and friction for a 1–2-admin org whose destructive surface is now just role grants + single delete, both already behind typed-acknowledgment confirmations (D51/D52) and both audit-logged with before/after (S18) and surfaced in the forensic roster log (D101).

**My lean:** **(a)** close (i) via S7/S8/D22 + name `pbe400.org` hardening as a threat-model dependency; **(b)** accept (ii) with a written threat model; **skip out-of-band step-up for MVP** — it's disproportionate given the shrunken surface and the fact that the audit trail (S18 + D101) already makes a malicious role grant *visible* and *reversible*. But step-up is a pure risk-appetite call, and it's legitimately yours — if a single rogue admin-grant is a scenario you want *prevented* rather than *detected-and-reversed*, an out-of-band confirm on role grants is the one place it would buy the most for the least.

> **Provisional D105 — Ghost single-point-of-compromise: the replay/forced-login vectors are closed (S7 alg-pin, S8 nonce + redirect allowlist, D22 cap), with `pbe400.org` origin-hardening named as an explicit threat-model dependency; the blast-radius dependency on Ghost is *accepted* (D54) and documented in a threat model that also absorbs D101's offline-restore residual; [step-up on role grants / single delete = added out-of-band / not added].** Records composite **S5** as (a)+(b); records to `ENGINEERING-DESIGN §2.1`/`§2.2`, a new threat-model note; cites D22, D54, D99, D100, D101.
>
> **Your call (S5 — the session's main fork):** ratify the close-the-closable + accept-the-residual posture; **decide step-up** — add an *out-of-band* confirmation on role grants (and/or single delete), or rely on the threat model + the existing typed-ack confirmations + the S18/D101 audit trail (recommended). Confirm `pbe400.org` hardening as a named dependency.

---

## §2 · The authorization model — S3, S4, S18

One coherent decision: **who may write what field, to whose record, and the one invariant that must never be violable.** All three are "the intent is in the spec; the *enforcement mechanism* isn't pinned." They build directly on the server-side projection (the credited strength) — the write-allowlist is its write-side mirror.

### S3 — Field-write authorization is unspecified; mass-assignment risk · `blocker`

**What it is.** `PATCH` is "field-scoped … fields the caller may not edit are rejected," but the docs never pin this as a positive **allowlist**. A denylist or "ignore-unknown-fields" implementation would let a manager set another brother's `privacy.*`/consent flags, or *any* caller set system/verification fields (`lastVerifiedDate`, `verifiedBy`, `lastModified`, `headshotVersion`, `id`, `role`, `adminNote`, `ghostMemberId`) — forging verification (the very thing the server-set `verify` action, D28, exists to prevent) or escalating role. Only `ghostMemberId`/uuid are documented as explicitly refused today.

**The fix — clean (a) on the mechanism.** Specify and implement a **per-role positive writable-field allowlist**; reject (422/403) — never silently ignore — any field outside it, including *all* system/verification/Ghost fields for *every* role (those are set only by dedicated server actions: `verify` per D28, role toggle per D51, the outbox's `ghostMemberId` capture per D96), and consent/privacy fields for managers (owner-only). This is the **write-side dual of the read projection** — the same per-role matrix, applied to writes — so it extends the credited enforcement point rather than bolting on a new one. The capability matrix (C6, Session 1) is the natural home for the enumerated rows. Test exhaustively by role × field (the §6.6 plan already mandates this on the read side).

### S4 — Object-level authorization (IDOR) must be explicit · `blocker`

**What it is.** Constitution IDs are contiguous, guessable integers. `PATCH /api/profiles/{id}` lists auth as "owner, manager, or admin" but never spells out the server-side check that a *plain brother writes only his own record* — a naïve "is authenticated" check is an IDOR. The same applies to `POST …/verify` (a plain brother must not stamp provenance on *anyone* — PRD §4.3 reserves verifying others to manager/admin) and to the `users` doc, which holds both self-writable `stars` and admin-only `role` (the stars endpoints must be scoped to the `stars` field and not coercible into a `role` write).

**The fix — clean (a).** Mandate the explicit server-side predicate **`request.profileId == session.profileId OR session.role ∈ {manager, admin}`** before any `PATCH`/`PUT`; enforce owner-vs-other on `verify`; scope stars writes to the `stars` field exclusively. S3 (field-level) and S4 (object-level) are the two orthogonal axes of the same endpoint — decided together. Test each.

### S18 — The last-admin safeguard appears to live only in the UI · `should-fix`

**What it is.** D51's "prevents demoting the last remaining administrator" is described as on-profile UI behavior; the role endpoint contract (API-SPEC §5) lists only admin-only + 404/422 and says nothing about it. If unenforced server-side, a direct API call removes the final admin and locks the org out of *all* admin functions (backup/restore, add/delete, role changes, Ghost sync).

**The fix — clean (a).** Enforce the last-admin invariant **server-side** in `PUT /api/users/{id}/role` (reject demotion of the only admin), independent of the UI; **audit-log every role change with before/after** — which also feeds D101's forensic privileged-roster log and supports the S5 "detect-and-reverse" posture. This is the invariant half of the same authorization model.

> **Provisional D106 — Server-side authorization model: a positive per-role writable-field allowlist (reject, never ignore, every out-of-scope field; all system/verification/Ghost fields set only by dedicated server actions; consent/privacy fields owner-only) [S3]; an explicit object-level predicate (`profileId == session.profileId OR role ∈ {manager,admin}`) before any write, owner-vs-other on `verify`, stars scoped to the `stars` field [S4]; the last-admin invariant enforced in the role endpoint with before/after audit on every role change [S18]. The write-allowlist is the write-side dual of the read projection; the matrix lives with C6's capability rows.** Records to `API-SPEC §3`/`§4`/`§5`, `DATABASE-SCHEMA §8`, `ENGINEERING-DESIGN §1.4`; the audit feeds D101.
>
> **Your call (S3/S4/S18):** ratify the allowlist + object-level predicate + server-side last-admin invariant; confirm the per-role write matrix is enumerated alongside the read-projection matrix (C6).

---

## §3 · Untrusted input, XSS & HTTP-boundary hardening — S11, S15, S14, S19

The "data and requests crossing Book's boundary" cluster — uploaded image bytes (S11), user-supplied URLs (S15), the response-header defense-in-depth that backstops both (S14, carrying P9), and the request-side CORS/cookie scoping (S19). All standard, all (a), bundled into one boundary-hardening decision.

### S11 — The image pipeline is under-bounded (decode bombs, transcoder RCE) · `should-fix`

**What it is.** Uploads are "validated for type and a sane maximum size," then transcoded to WEBP and downscaled. A **byte-size cap does not bound *decoded* dimensions** — a small, highly-compressed pixel-flood / decompression bomb exhausts memory/CPU at decode — and the transcode library (sharp/libvips/ImageMagick-class) is a recurring RCE/DoS surface on attacker-controlled input.

**The fix — clean (a), one number to pin.** Validate and cap **decoded width×height and total pixels** before/at decode (reject above the cap); set decoder **memory/time limits**; verify **magic bytes**, not just the declared `Content-Type`; **pin and patch** the imaging library; run transcoding **least-privileged**. The one value to pin is the max-decoded-pixels bound — headshots are small, so a modest cap (e.g. on the order of ~25–40 MP, comfortably above any real photo) is ample. Couples to R16 (Session 1's opaque headshot tokens) and the D86 rate limits.

### S15 — Stored XSS via user-supplied URLs if the scheme isn't strictly allowlisted · `should-fix`

**What it is.** `links[].url`, `obituaryUrl`, and `inMemoriamUrl` are validated as "valid `http(s)` URL" (DATABASE-SCHEMA §8), but if the check is a *loose match* rather than a *strict scheme allowlist*, a stored `javascript:`/`data:` URL becomes script-on-click when rendered as an anchor.

**The fix — clean (a), partly implementation-discipline.** Strictly **allowlist the `http`/`https` scheme on write** (reject all others, explicitly `javascript:`/`data:`); on render, emit anchors with **`rel="noopener noreferrer"`** and never interpolate URLs into dangerous sinks. Since the spec already says "valid `http(s)` URL," this pins it as a *strict allowlist + safe render*, with S14's CSP as the defense-in-depth backstop.

### S14 — No Content-Security-Policy or standard security headers beyond HSTS · `should-fix`  *(lands P9's `Referrer-Policy`)*

**What it is.** D64/§6.4 list HSTS + the cookie attributes and nothing else — no CSP, no `X-Content-Type-Options: nosniff`, no framing policy. Book stores and renders user-supplied content (names, links, `adminNote`, obituary URLs) *and* loads a third-party analytics script (Mixpanel, D62) — exactly the profile where a CSP is the key defense-in-depth against stored/reflected XSS.

**The fix — clean (a), one content-decision.** Define a **strict CSP** (`script-src`/`style-src`/`connect-src`/`img-src`/`frame-ancestors`), `X-Content-Type-Options: nosniff`, and a framing policy (`frame-ancestors`/`X-Frame-Options`), documented alongside HSTS in §6.4. This is also the implementation home of **P9's `Referrer-Policy`** (ratified (a) in Session 3) — set `strict-origin-when-cross-origin` or stricter so the Name-Search term and `/brother/:id` path don't leak as `Referer` to `/api`, `/img`, or external obituary links. **The one decision:** a strict CSP must *explicitly allowlist the origins Book legitimately loads* — D62's Mixpanel script/`connect-src` endpoint and the Ghost/CDN image origins — and use nonces/hashes for any unavoidable inline script. My lean: strict CSP with an enumerated Mixpanel allowlist entry, no `unsafe-inline`.

### S19 — CORS and session-cookie domain scoping must be explicit · `minor`

**What it is.** The cookie-auth + `SameSite=Strict` CSRF defense quietly depends on two unstated things: **(a)** `/api/*` must not enable permissive/credentialed CORS (no `Access-Control-Allow-Origin` reflection with credentials, especially for `pbe400.org`), or cross-origin reads of authenticated responses become possible; **(b)** the session cookie must be **host-only** on `book.pbe400.org` (no `Domain=.pbe400.org`), or Ghost / any sibling subdomain could read it. The *CDN* cookie is already stated host-only (D23/§2.5); the *session* cookie's host-only status is not.

**The fix — clean (a).** State and enforce a **deny-by-default CORS** policy on `/api/*` and an **explicit host-only session cookie** (no `Domain` attribute) — extending D23's existing CDN-cookie discipline to the session cookie. Pure specification-completeness.

> **Provisional D107 — Input & HTTP-boundary hardening: decoded-image bounding (cap decoded W×H + pixels before decode, magic-byte check, decoder mem/time limits, pinned least-privileged imaging lib) [S11]; strict `http`/`https` URL-scheme allowlist on write + `rel="noopener noreferrer"` render [S15]; a strict CSP (allowlisting D62's Mixpanel + Ghost/CDN origins, no `unsafe-inline`) + `nosniff` + `frame-ancestors` + the P9 `Referrer-Policy` [S14/P9]; deny-by-default CORS on `/api/*` + host-only session cookie [S19].** Records to `ENGINEERING-DESIGN §2.5`/`§2.7`/`§6.4`, `DATABASE-SCHEMA §7`/`§8`, `API-SPEC §6`; amends D64 (the headers list grows); lands P9's implementation.
>
> **Your call (S11/S15/S14/S19):** ratify the bundle; pin the **max-decoded-pixels** cap; confirm the **CSP explicitly admits the Mixpanel script** (D62) so analytics isn't broken by the policy.

---

## §4 · The test-seam bypass — S16

### S16 — `DevIdentityProvider` is a single-gate total auth bypass · `should-fix`

**What it is.** The dev provider (D72) "issues a session for a chosen identity and role with no Ghost," guarded by **one** env check ("the backend refuses to start if the dev provider is combined with a production configuration"). A single misconfiguration there = anyone can mint *any* identity at *any* role (including admin) against production. The blast radius is total; the control is a single point of failure.

**The fix — clean (a), defense-in-depth (the second, lighter fork).** Make it belt-and-suspenders, because the failure mode is catastrophic and the layers are cheap:
1. **Compile it out of the production bundle entirely** — the prod artifact should not *contain* the dev provider's code (a separate entry point / build-time tree-shake), so it can't be instantiated even if mis-configured. This is the load-bearing layer: "can't be loaded" beats "is disabled."
2. **Keep the runtime env gate** (D72's existing refuse-to-start) as a second independent layer.
3. **A CI/build assertion** that the production artifact cannot instantiate the dev provider (a test that fails the build if it can).
4. **A startup alert** if the dev provider is ever loaded under a prod-like configuration.

This hardens a deliberate, valuable test seam (D21/D72) without removing it — and D102's move to *ephemeral, script-provisioned* staging means the dev provider's legitimate home is now even more clearly "throwaway environments stood up on demand," never anything adjacent to prod. The "fork" here is really just *how many layers* — and since (1) alone closes the class and (2)–(4) are nearly free, my lean is **all four**.

> **Provisional D108 — `DevIdentityProvider` defense-in-depth: compiled out of the production bundle entirely (not merely disabled), behind the retained runtime env gate (D72), with a CI assertion that the prod artifact cannot instantiate it and a startup alert if ever loaded under prod config.** Records to `ENGINEERING-DESIGN §6.6`, `CODING-PROJECT-PLAN` (the CI gate); hardens D72.
>
> **Your call (S16):** confirm the full four-layer set (recommended) vs. a lighter subset.

---

## Recording surfaces (per TRIAGE-PLAN principle 4)

Per principle 5, doc edits happen in the concentrated propagation phase (TRIAGE-PLAN §6); the worksheet + any inline `D##` are recorded as each is ratified.

| Item | Worksheet (§12) | Delivered docs | `DECISIONS.md` |
|---|---|---|---|
| S7 | (a) fix | `ENGINEERING-DESIGN §2.1`/`§2.7`, `API-SPEC §2` | **D104** |
| S8 | (a) fix | `ENGINEERING-DESIGN §2.1`, `API-SPEC §2` | **D104** |
| S5 | (a)+(b) | `ENGINEERING-DESIGN §2.1`/`§2.2` + threat-model note | **D105** (cites D22/D54/D99/D100/D101) |
| S3 | (a) fix | `API-SPEC §3`, `DATABASE-SCHEMA §8`, `ENGINEERING-DESIGN §1.4` | **D106** |
| S4 | (a) fix | `API-SPEC §3`/`§4`, `DATABASE-SCHEMA §6.1` | folded into **D106** |
| S18 | (a) fix | `API-SPEC §5`, `PRD §5.7.10` | folded into **D106** (audit feeds D101) |
| S11 | (a) fix | `API-SPEC §6`, `DATABASE-SCHEMA §7`, `PRD §5.7.5` | **D107** |
| S15 | (a) fix | `DATABASE-SCHEMA §8`, `PRD §5.7.4`/`§5.7.7` | folded into **D107** |
| S14 | (a) fix | `ENGINEERING-DESIGN §6.4`/`§2.7` (amends D64); lands **P9** | folded into **D107** |
| S19 | (a) fix | `ENGINEERING-DESIGN §2.5`/`§2.7` | folded into **D107** |
| S16 | (a) fix | `ENGINEERING-DESIGN §6.6` (hardens D72), `CODING-PROJECT-PLAN` | **D108** |

`D104`–`D108` are provisional drafts; the resolution pass (TRIAGE-PLAN §6) finalizes and renumbers (D104 may merge with D105; D107 bundles four findings and may split). **Cross-session ties to flag in resolution:** D105 consumes D54 (accepted dependency), D22 (session cap), D99 (S2's closed takeover path), D100 (restore offline / bulk-delete dropped), D101 (offline-restore residual + forensic roster log); D106's write-matrix pairs with C6 (Session 1) and is the write-side dual of the read projection; D106's role-audit feeds D101; D107 amends D64 and lands P9 (Session 3); D108 hardens D72 and aligns with D102's ephemeral staging.

---

## The questions, consolidated

Most of this session is ratify-the-mechanism (S7, S8, S3, S4, S18, S11, S15, S14, S19, and the layered S16). What I actually need from you, grouped:

**The one real fork — S5 (Ghost as a single point of total compromise):**
1. Ratify the posture: **close** the replay/forced-login vectors (via S7 alg-pin + S8 nonce + D22 cap, with `pbe400.org` hardening named as a threat-model dependency), and **accept** the blast-radius dependency on Ghost (D54) with a written threat model that absorbs D101's offline-restore residual.
2. **Step-up — your risk-appetite call:** add an *out-of-band* confirmation on role grants (and/or single delete), or rely on the threat model + the existing typed-ack confirmations + the S18/D101 audit trail (recommended)? *(Note the sharp constraint: an in-Book step-up authenticates nothing new, since every factor traces back to the same Ghost identity — only an out-of-band channel is meaningful.)*

**The second, lighter fork — S16 (dev bypass):**
3. Confirm the **four-layer** lockdown (compile-out + env gate + CI assertion + startup alert) (recommended) vs. a lighter subset.

**The authorization model — S3/S4/S18 (one quick confirm):**
4. Ratify the **positive per-role write allowlist** + **object-level predicate** + **server-side last-admin invariant**; confirm the write-matrix is enumerated alongside the read-projection matrix (C6).

**Input & HTTP-boundary hardening — S11/S15/S14/S19 (one quick confirm):**
5. Ratify the bundle; **pin the max-decoded-pixels cap** (S11); confirm the **strict CSP explicitly admits D62's Mixpanel script** so analytics isn't broken (S14).

**Auth-token hardening — S7/S8 (near-automatic):**
6. Ratify alg-pinning and the callback nonce + redirect allowlist; confirm the nonce layers *with* D20's fragment handoff, not in place of it.

*— Drafted 2026-06-11 in-session at High depth, for review before live Session 5 (Medium–High). Next: you redline these proposals, then we run the live Session 5 triage in this same session to record dispositions into the §12 worksheet and any `D104+`. Next session after: Session 6 — UI / a11y + leftovers.*
