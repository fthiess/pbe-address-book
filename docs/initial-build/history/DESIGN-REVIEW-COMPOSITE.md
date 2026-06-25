# PBE Address Book — Composite Design-Review Findings

The single, authoritative, de-duplicated punch list distilled from the clean-context design review of the initial-build design suite. It consolidates **eight raw reviewer reports** (two reviewers × four lenses) into one register so a triage session can decide each issue once. The review method and reviewer setup are in [`DESIGN-REVIEW-PLAN.md`](DESIGN-REVIEW-PLAN.md); the raw reports are in [`raw-dr-feedback/`](raw-dr-feedback); the suite reviewed is the eight delivered documents in [`../`](../).

> **Status:** Compiled 2026-06-07 from the raw reports, in a session with full access to the delivered docs *and* the withheld `history/` folder. **This is the input to triage, not the triage itself** — every Disposition/Action cell is intentionally blank. This document **supersedes** the empty `DESIGN-REVIEW-FINDINGS.md`, which now redirects here.

---

## 1. How to read this document

**Provenance.** Two reviewers, each a different high-end LLM set to maximum thinking depth, reviewed the eight delivered docs with no access to the planning history, each adversarially, across four lenses:

| | Reviewer **A** (granular — 96 raw findings) | Reviewer **B** (terse — 29 raw findings) |
|---|---|---|
| Review 1 — Structural / completeness / consistency | DR-A-1 (29) | DR-B-1 (8) |
| Review 2 — Security | DR-A-2 (23) | DR-B-2 (8) |
| Review 3 — Privacy | DR-A-3 (20) | DR-B-3 (7) |
| Review 4 — Operations & reliability | DR-A-4 (24) | DR-B-4 (6) |

**125 raw findings** are consolidated below into **81 composite findings**, grouped into five domains: **S**ecurity, **P**rivacy, Operations & **R**eliability, **C**ross-cutting consistency & documentation, and **U**I & accessibility. Cross-domain issues appear **once**, in their most natural home, with "see also" cross-references.

**Each finding carries:**
- **ID & title · severity.** The ID (e.g. `S1`) is stable; cite it in triage. Severity is the **highest** any reviewer assigned; where reviewers disagreed, the **Raised by** line shows each one's own rating and the **Synthesis** note explains the spread.
- **Where.** The `file §section` / `D##` locations the finding touches.
- **Finding.** The merged substance — every reviewer's distinct angle on the same issue, fused.
- **Suggested fix.** The strongest/union of the reviewers' proposed resolutions (still just *their* proposals — triage decides).
- **Raised by.** The raw finding IDs that feed this composite, each with its reviewer-assigned severity. This is the traceability anchor.
- **Synthesis.** Convergence (both reviewers independently?), divergence, and how related findings interact.
- **Editor's context note.** *Added during compilation, with access to the decisions and history the reviewers lacked.* These are **neutral pointers only** — "D55 bears on this," "already a deferred item in PRD §3.2" — never a disposition or a verdict. They exist to save triage a lookup; they must still be weighed in triage, not taken as decided.

**Severity legend (reviewer-assigned).** `blocker` = must be resolved before building from these docs · `should-fix` = a real problem worth correcting, not a build-stopper · `minor` = small clarity/consistency nit · `question` = the reviewer is unsure; needs a judgment call.

**Disposition legend (for triage — left blank here).** `(a) fix` (note if it alters a decision → new `D##`) · `(b) as-designed` (reject, with reason) · `(c) deferral` (already an intentional post-MVP deferral; cross-check `PRD.md` §3.2) · `(d) external-context` (the reviewer lacked a real constraint we have). The triage worksheet at §12 is where dispositions get recorded.

---

## 2. Executive summary

The suite came through this adversarial review well: both reviewers volunteered, unprompted, that the architecture's core instincts are sound (server-side projection as the single enforcement point, the read-only Ghost reconciliation audit, names-not-values audit logging, the fragment-carried auth token, optimistic concurrency on `updateTime`). Almost nothing here is "the architecture is wrong." The findings are gaps **at the edges** — where data leaves the projection, where two systems are written non-atomically, where a decision was made but never pushed down into the contract a builder would follow.

**Two blocker spines run through the whole review:**

1. **Consent & privacy at the system's boundary.** The projection/consent model rigorously governs *reads of the live record*, but not the *copies and exports that leave it*. Three undisclosed or under-consented egress paths recur in both reviewers' privacy reports: **Mixpanel** (every brother's email, name, Constitution ID, and role shipped to a third party with `ignore_dnt: true`, absent from the only user-facing privacy notice); **MITAA** (external-sharing consent defaults to opt-in, and identity/death data flows even on opt-out); and the **inability to actually delete a person** (hard delete survives in backups, GCS versioning, Mixpanel, prior MITAA snapshots, and is resurrected by Restore). Layered on top: there is no privacy notice / data-subject-request machinery at all, which both reviewers flag as a CCPA problem (with one open question about whether CCPA legally binds a nonprofit fraternal group).

2. **Authentication & data integrity at the Ghost seam.** **Email is the authentication join key but has no uniqueness or normalization constraint** — which both reviewers independently escalate to account-takeover and wrong-profile sign-in. The **Book→Ghost dual-write is non-atomic with no outbox or alerting**, whose headline consequence — a brother changes their own email, the Ghost push silently fails, and they are locked out on next sign-in — was found by *both* reviewers in *three* of the four lenses. And Reviewer A alone caught the subtlest and arguably most serious security item: the **memoized compressed `/api/profiles` buffer is keyed only by encoding, not by caller**, so the owner-aware projection that *is* the security model can serve one caller's data to everyone until the next write.

**Convergence is high.** Roughly twenty issues were found independently by both reviewers — the strongest possible signal from a two-model review. Where they diverged it was usually on *severity* (Reviewer B rated raw infrastructure risks like brotli-11 and the snapshot listener as blockers; Reviewer A rated the same mechanisms should-fix but rated consent/auth-integrity as the blockers), and once on *fact* (the Linter's Cloud Run IAM "front door" — see `S17`). Reviewer A's volume came from the structural lens (back-propagation drift from the Session-5/6 additions, and MVP mechanics still marked "TBD" inside "delivered" docs); Reviewer B's value was in a few sharp catches the granular reviewer missed (phonetic indexing blocking the main thread, virtualized-list ARIA, the 401-mid-edit data-loss path).

The domain counts and the full convergence map are in §3; the findings themselves begin in §4.

---

## 3. Severity & convergence overview

**By severity (composite findings):** see the per-domain counts in the triage worksheet (§10). The blocker-level themes, consolidated, are: `S1` memoized-payload projection leak · `S2` email-uniqueness/takeover · `S3` mass-assignment · `S4` object-level authz/IDOR · `S5` Ghost-as-total-compromise · `P1` Mixpanel undisclosed PII · `P2` no CCPA/data-subject machinery · `P3` data cannot be deleted · `P4`/`P5` MITAA external-sharing default & forced flow · `R1` non-atomic Ghost dual-write / lockout · `R2` snapshot-listener staleness · `R3` brotli-11 on the request path. (Cross-cutting and UI carry no blockers; each reviewer's own blocker list differs — this is the union, by max severity.)

**Found by *both* reviewers (high-confidence — ~20 clusters):** email-as-join-key with no uniqueness (`S2`); non-atomic Ghost dual-write / email-change lockout (`R1`); Mixpanel PII + `ignore_dnt` (`P1`); MITAA opt-in default & forced-flow-on-opt-out (`P4`/`P5`); synchronous brotli-11 latency/DoS (`R3`); snapshot-listener staleness on scale-to-zero Cloud Run (`R2`); long-running ops as synchronous Cloud Run requests (`R4`); mass-assignment / write-allowlist (`S3`); object-level authz / IDOR (`S4`); CSV/formula injection (`S9`); `adminNote` vs. right-to-access (`P8`); restore resurrects deleted users (`P3`); retained old headshot versions (`P7`); `Referrer-Policy` URL leak (`P9`); missing notice-at-collection / CCPA machinery (`P2`); JWKS cold-start auth outage (`R6`); Ghost as a single point of total compromise (`S5`); restore non-atomicity / Ghost divergence (`R5`); API versioning / stale-SPA contract (`C9`); eager-migration execution environment (`R15`).

**Found by Reviewer A only:** the memoized-payload projection leak (`S1`), JWT alg-pinning (`S7`), login-CSRF nonce (`S8`), the `DevIdentityProvider` bypass (`S16`), image decode-bomb surface (`S11`), CSP/headers (`S14`), the entire Session-5/6 back-propagation drift cluster (`C1`–`C3`), dangling references on delete (`R12`), and most of the long tail of concurrency/atomicity minors.

**Found by Reviewer B only:** phonetic indexing on the main thread (`U5`), virtualized-list ARIA (`U6`), toggle-verbosity clutter (`U7`), the 401-mid-edit data-loss path (`U3`), and the sharpened "Cloud Run IAM is per-service, so the roster front-door is infeasible" argument (`S17`).

---

## 4. Security findings (`S`)

> Both reviewers credited the security fundamentals (server-side projection as the sole enforcement point, read-only Ghost audit, the dedicated server-set `verify` action, secrets in Secret Manager, the keyless service-account path). These findings are the gaps *around* those good instincts. Where a control may exist in implementation but is unstated in the design, the finding is against the **specification**, since the build proceeds from these docs.

---

**`S1` — Memoized compressed `/api/profiles` buffer collapses the per-caller privacy projection · `blocker`**
- **Where:** `ENGINEERING-DESIGN §1.6 (D75)` vs `§1.4`/`§2.4` & `DATABASE-SCHEMA §9 (D5/D19/D44)`
- **Finding:** D75 memoizes a *single* brotli/gzip buffer of the projected payload, "invalidated on write … amortized over every download until the next write." But the projection is **owner-aware**: each caller sees their *own* record in full (including values behind their own off-toggles, but never their own `adminNote`) and every other record projected to the caller's role and that record's flags — so the correct payload differs **per user**, not merely per role. A buffer distinguished only by `br`/`gzip` therefore serves the first post-write caller's projection to everyone: if an admin or manager is the first GET after any write, subsequent brothers receive admin/manager data (hidden contact values, restricted flags, `adminNote`). Even a charitable "one buffer per role" reading still leaks owner-only fields across brothers. Correct per-user keying (~N variants) negates D75's stated economic benefit (one slow brotli-11 amortized over all downloads).
- **Suggested fix:** Serve a uniform **per-role** bulk payload (others' records only) and deliver the caller's own full record separately (e.g. via `GET /api/me` or a self-record fetch), making the memoized buffer per-role (≈6 variants) and correct; or drop memoization of the *projected* buffer and compress per request at a tuned level; or key any cache by the full projection identity (role **and** caller id) and never reuse a buffer across identities. Add a test asserting no two callers can receive each other's projection.
- **Raised by:** A-2 #1 (`blocker`), A-4 #2 (`blocker`).
- **Synthesis:** Reviewer A only, but its single most serious security finding and independently re-derived in the ops lens — the convergence is *within* one reviewer across two lenses. The cost re-evaluation (per-user keying breaks the D75 amortization) is the crux that ties it to `R3` (brotli cost) and `S6` (ETag keying).
- **Editor's context note:** D75's text (ENGINEERING-DESIGN §1.6) literally describes "*the* cached compressed buffer" keyed only by encoding, with no mention of caller/role; §1.4/§2.4/§9 and D44 establish the projection as owner-aware. The two are in direct tension exactly as the finding states — this is not a misreading. The §6.6 test plan already mandates exhaustive per-role projection tests but does **not** mention a cross-caller buffer-isolation test.

---

**`S2` — Email is the authentication join key but has no uniqueness or normalization constraint · `blocker`**
- **Where:** `ENGINEERING-DESIGN §2.1`/`§5.1`; `DATABASE-SCHEMA §8`; `API-SPEC §2`
- **Finding:** Sign-in "resolves the verified email to a `profiles` record," and Mixpanel/Ghost matching also key on email — but validation enforces uniqueness only on `id`; email has format validation only, and no canonicalization (case/Unicode/whitespace). Two profiles sharing an email (incomplete dedup, data-entry error, or a malicious admin/`PATCH`) make resolution ambiguous; if one is a manager/admin, a brother can authenticate onto the **wrong, higher-privilege profile**. Reviewer B frames the active attack: a brother edits their email to match an admin's, and once Ghost carries it their next JWT maps them to the admin profile — full takeover. Case/normalization drift between Ghost and Book can also break legitimate logins.
- **Suggested fix:** Enforce primary-email (and `alternateEmail`) uniqueness server-side at create/edit/import (e.g. a transactional `emails/{email}` reservation doc, since Firestore can't unique-constrain a non-key field); define canonical normalization (lowercase, trim, Unicode-normalize) applied identically at write and at resolution; make resolution **fail closed** (deny) on any ambiguity rather than picking a record.
- **Raised by:** B-2 #1 (`blocker`), A-2 #6 (`should-fix`), A-4 #12 (`should-fix`, "treat as blocker if uniqueness can't be guaranteed before the email is used for auth").
- **Synthesis:** Both reviewers, security + ops lenses. Severity spread (B: blocker / A: should-fix) is really agreement — A explicitly says it becomes a blocker precisely because email gates auth, which is the situation here. See also `R1` (the *failed-push* path to the same lockout symptom) — distinct mechanism, distinct fix.
- **Editor's context note:** `DATABASE-SCHEMA §8` confirms only `id` uniqueness + email *format*; no uniqueness/normalization rule exists. D55/ENGINEERING-DESIGN §5.1 deliberately address Ghost *updates* by `ghostMemberId` (not email) so an email *change* is unambiguous — but that does not address two Book profiles resolving from one inbound login email, which is the gap here.

---

**`S3` — Field-write authorization is unspecified — mass-assignment risk; needs a positive server-side allowlist · `blocker`**
- **Where:** `API-SPEC §3 (PATCH/POST)`; `DATABASE-SCHEMA §8`
- **Finding:** PATCH is "field-scoped … fields the caller may not edit are rejected," but the docs never specify this as a positive **allowlist**. A denylist or "ignore-unknown-fields" implementation would let a manager set another brother's `privacy.*`/consent flags, or any caller set system/verification fields (`lastVerifiedDate`, `verifiedBy`, `lastModified`, `headshotVersion`, `id`, `role`, `adminNote`, `ghostMemberId`) — forging verification (the dedicated `verify` action exists precisely to prevent this) or escalating role. Only `ghostMemberId`/uuid are documented as explicitly refused.
- **Suggested fix:** Specify and implement a per-role **writable-field allowlist**; reject (422/403), never silently ignore, any field outside it — including all system/verification/Ghost fields for every role and consent/privacy fields for managers. Test exhaustively by role × field.
- **Raised by:** B-2 #3 (`blocker`), A-2 #7 (`should-fix`).
- **Synthesis:** Both reviewers; identical fix (positive allowlist). Pairs with `S4` (object-level vs. field-level authorization — different axes of the same PATCH endpoint).
- **Editor's context note:** `API-SPEC §3` states out-of-scope fields are "rejected" and returns `403` for "a field outside their powers," and `DATABASE-SCHEMA §8` says `ghostMemberId`/uuid are "never accepted from … a brother-facing edit." The *intent* is rejection; the finding is that the enforcement **mechanism** (allowlist vs. denylist) is unpinned, and the allowlist is not enumerated per role. The §6.6 test plan does mandate exhaustive per-role projection testing on the *read* side.

---

**`S4` — Object-level authorization must be explicitly enforced server-side (IDOR on edits; `verify`; `stars` ≠ `role`) · `blocker`**
- **Where:** `API-SPEC §3 (PATCH, verify)`, `§4 (stars)`; `DATABASE-SCHEMA §6.1`
- **Finding:** Constitution IDs are contiguous, guessable integers. `PATCH /api/profiles/{id}` lists auth as "owner, manager, or admin" but does not spell out the server-side check that a plain brother may write only their *own* record; a naïve "is authenticated" check is an IDOR. Likewise `POST …/verify` must enforce owner-vs-other (a plain brother must not stamp provenance on anyone), and the `users` document holds both self-writable `stars` and admin-only `role` — the stars endpoints must be scoped to the `stars` field only and not coercible into a `role` write.
- **Suggested fix:** Mandate the explicit server-side predicate `request.profileId == session.profileId OR session.role IN ('manager','admin')` before any `PATCH`/`PUT`; enforce owner-vs-other on `verify`; scope stars writes to the `stars` field exclusively. Add tests for each.
- **Raised by:** B-2 #4 (`blocker`, IDOR), A-2 #23 (`question`, confirm verify/stars object-level checks).
- **Synthesis:** Both reviewers; B asserts the IDOR as a blocker, A raises the verify/stars facets as confirm-this questions. Same underlying requirement: object-level authz is implied but never stated. Pairs with `S3` (field-level).
- **Editor's context note:** D28 / API-SPEC §3 make `verify` a dedicated server-set action specifically so it "cannot be forged by the client," and PRD §4.3 reserves verifying *others* to manager/admin — so the *intent* exists; the finding is that the per-call object-level check is unstated in the contract. The §6.6 test plan lists the projection and auth as exhaustively-tested areas.

---

**`S5` — Ghost token is not minted for Book; a Ghost compromise is a total Book compromise, including admin, with no step-up · `blocker`**
- **Where:** `ENGINEERING-DESIGN §2.1 (step 3)`, `§2.2`; `DECISIONS D54`
- **Finding:** Book authenticates with the token from Ghost's `/members/api/session`, whose `aud`/`iss` are "set to the members API" — so verifying `aud` only confirms a *Ghost members* token, not one issued *for Book*. Any party who can read a member's Ghost session token (XSS or a malicious element on `pbe400.org`, the comments widget, a future Ghost integration, a shared analytics script) can POST it to `/api/auth/session` and obtain a full Book session as that member — a bearer token with no proof-of-possession or Book-specific audience. More broadly, because Book derives *all* authorization (including admin) from the resolved email, anyone who can mint/obtain a Ghost token for an admin's email (Ghost Pro breach, signing-key leak, admin-email control) gets full Book admin, and there is no second factor or step-up for the most destructive actions (delete-all, restore, role grants).
- **Suggested fix:** Prefer a token whose audience is Book specifically (a Ghost integration/JWT scoped to `book.pbe400.org`), or bind the handoff to Book (one-time, nonce/PKCE-style, single-use); document that Book's trust equals "anyone who can read a member's Ghost token" and harden `pbe400.org`; consider out-of-band/step-up confirmation for restore, bulk delete, and role grants so they don't ride solely on a single SaaS identity assertion.
- **Raised by:** B-2 #2 (`blocker`), A-2 #4 (`should-fix`, audience confusion), A-2 #19 (`minor`, blast radius + step-up).
- **Synthesis:** Both reviewers converge on "Ghost is a single point of total compromise." A decomposes it (audience-confusion as a concrete replay vector, blast-radius as an architectural note); B states it as one blocker. The step-up recommendation is the shared mitigation. This is an *accepted architectural dependency* (D54) being asked to bound its blast radius.
- **Editor's context note:** D54 explicitly accepts Book's hard-dependence on Ghost and ENGINEERING-DESIGN §2.1 confirms the token's `aud`/`iss` are the Ghost members API (not Book). D21/§2.2's `IdentityProvider` seam is about *swapping providers*, not about a same-provider token-replay; it does not address this. The blast-radius framing (A-2 #19) is the kind of accepted-tradeoff that triage may classify (b) with a documented threat-model note — but the audience/replay vector (A-2 #4) and the step-up question are live.

---

**`S6` — Bulk `ETag` ignores role/identity → stale authorization after a role change · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §1.6 (D76)`; `API-SPEC §1.4`
- **Finding:** The `/api/profiles` ETag is derived solely from the dataset's Firestore `updateTime`, so it is identical for every caller and role. (a) A role change is a write to `users`, not `profiles`, so it does **not** change `updateTime`: a demoted manager/admin who reloads gets `304 Not Modified` and keeps serving the browser-cached higher-privilege payload until some unrelated `profiles` write occurs. (b) Identical ETags across roles mean only `Cache-Control: private` separates projections — a thin margin for the most sensitive response in the app.
- **Suggested fix:** Incorporate the projection identity (role + caller id, plus a role-version or `users` updateTime) into the ETag so the token changes when authorization changes; ensure a role downgrade immediately invalidates cached payloads.
- **Raised by:** A-2 #2 (`should-fix`), A-4 #2 (`blocker`, as facet (b) of the cache-keying finding).
- **Synthesis:** Reviewer A, security + ops. Same root cause as `S1` (cache key omits the projection identity); fixing `S1`'s keying should fix this if the ETag is derived from the same identity.
- **Editor's context note:** D76 confirms the ETag is "derived from the dataset's latest Firestore `updateTime`"; `role`/`stars` live in the `users` collection (DATABASE-SCHEMA §6.1), which `updateTime` on `profiles` does not track — so the stale-authz-on-demotion path is consistent with the design as written.

---

**`S7` — JWT verification does not pin the algorithm · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §2.1`, `§2.7`; `API-SPEC §2`
- **Finding:** Verification is "signature, `aud`, `iss`, `exp`" against Ghost's JWKS, but the expected **algorithm is never pinned**. The classic bypasses — `alg: none`, or `alg: HS256` using the RSA public key as an HMAC secret — are not foreclosed.
- **Suggested fix:** Pin verification to Ghost's specific asymmetric `alg`/`kid` from JWKS; explicitly reject `none` and any symmetric algorithm; unit-test forged-`alg` cases (add to the §6.6 auth tests).
- **Raised by:** A-2 #3 (`should-fix`).
- **Synthesis:** Reviewer A only; standard JWT hardening.
- **Editor's context note:** ENGINEERING-DESIGN §2.1 and API-SPEC §2 both enumerate "signature, `aud`, `iss`, `exp`" with no `alg` pin — accurate to the text. §6.6 already lists JWT verification against a mocked JWKS as exhaustively-tested, a natural home for the forged-`alg` cases.

---

**`S8` — No `state`/nonce on the auth callback (login CSRF) and redirect-target integrity is unstated · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §2.1 (steps 1–4)`; `API-SPEC §2`
- **Finding:** The fragment handoff has no `state`/nonce tying the callback to a flow the user initiated, so an attacker can deliver `…/auth/callback#token=<attacker token>` and force the victim's browser to establish a session as the **attacker** (forced login — the victim then edits/acts inside the attacker's identity). Separately, if any redirect target in the bridge (the Portal `return`, or the callback URL) is caller-parameterizable, it becomes an open redirect that leaks the `#token` to an attacker origin (account takeover).
- **Suggested fix:** Add a single-use `state`/nonce generated by Book and verified at the callback; hardcode/allowlist every redirect target so neither the `return` nor the token-bearing destination can be attacker-controlled.
- **Raised by:** A-2 #5 (`should-fix`).
- **Synthesis:** Reviewer A only; complements `S5` (both concern the token handoff's integrity).
- **Editor's context note:** ENGINEERING-DESIGN §2.1's flow describes the fragment handoff with no `state`/nonce step — accurate. The fragment is deliberately used (D20) to keep the token out of logs/history/Referer, which addresses *leakage* but not *forged-flow*; the two are orthogonal.

---

**`S9` — CSV / formula injection in exports (including the MITAA file to a third party) · `should-fix`**
- **Where:** `DATABASE-SCHEMA §10`; `PRD §5.6.8`; `ENGINEERING-DESIGN §5.3`, `§6.6`
- **Finding:** The client-side Directory export and the MITAA export emit user-controlled free-text (`firstName`, `employerName`, `adminNote`, links) to CSV. A value beginning `=`, `+`, `-`, or `@` is executed as a formula when opened in Excel/Sheets (e.g. `=cmd|'/C calc'!A0`). RFC-4180 quoting does **not** neutralize formula injection — and the MITAA file flows to an external party.
- **Suggested fix:** Neutralize leading formula characters on every text cell (prefix `'` or wrap per OWASP) in both the client export and the MITAA mapping; add a test for malicious leading characters.
- **Raised by:** A-2 #9 (`should-fix`), B-2 #7 (`should-fix`).
- **Synthesis:** Both reviewers; identical fix. Ties to `C4` (the CSV format/escaping is still marked "finalized in Session 6").
- **Editor's context note:** `DATABASE-SCHEMA §10` explicitly defers "the authoritative format, escaping, and edge cases … to Session 6," and that finalization did not occur for escaping/formula-injection (D68 resolved only the verification-field rule). §6.6 mentions CSV "escaping" as tested but conflates RFC-4180 quoting with injection defense — so the finding stands and is not yet specified.

---

**`S10` — No rate-limiting or abuse controls (auth, writes, JWKS refresh, compression amplification) · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §1.6 (D75)`, `§2.7`; `API-SPEC §2`
- **Finding:** No endpoint defines throttling. Concrete amplifiers: (a) any brother can loop `PATCH`-own-profile (invalidates the compressed buffer) → `GET /api/profiles` (forces a full-dataset **brotli-11** recompression) to burn CPU — a low-privilege CPU DoS; (b) "refresh JWKS on an unknown `kid`" lets crafted tokens force repeated outbound JWKS fetches; (c) `POST /api/auth/session` does unauthenticated crypto work. Alerting on denial bursts (§6.1) detects but does not prevent.
- **Suggested fix:** Add rate limits / concurrency caps on auth, writes, and the bulk read; single-flight and cap unknown-`kid` JWKS refetches; debounce compression-buffer rebuilds so a write burst doesn't trigger repeated full recompressions.
- **Raised by:** A-2 #10 (`should-fix`), A-4 #23 (`minor`).
- **Synthesis:** Reviewer A, security + ops. The brotli amplifier is the bridge to `R3`; the JWKS refetch lever also feeds `R6` (JWKS cold-start).
- **Editor's context note:** ENGINEERING-DESIGN §2.7 confirms JWKS "refreshes … on an unknown `kid`," and D75/§1.6 confirms the invalidate-then-recompress-on-next-request model — both amplifiers are real per the text. No rate-limiting is mentioned anywhere in the suite.

---

**`S11` — Image-pipeline attack surface is under-bounded (decode bombs, transcoder RCE) · `should-fix`**
- **Where:** `PRD §5.7.5`; `API-SPEC §6 (PUT …/headshot)`; `DATABASE-SCHEMA §7`
- **Finding:** Uploads are "validated for type and a sane maximum size," then server-side transcoded to WEBP and downscaled. A byte-size cap does **not** bound *decoded* dimensions: a small, highly-compressed pixel-flood / decompression-bomb image can exhaust memory/CPU during decode, and the transcode library (libvips/sharp/ImageMagick-class) is a recurring RCE/DoS surface on attacker-controlled input.
- **Suggested fix:** Validate and cap decoded width×height (and total pixels) before/at decode; set decoder memory/time limits; verify magic bytes (not just declared `Content-Type`); pin and patch the imaging library; run transcoding least-privileged.
- **Raised by:** A-2 #11 (`should-fix`).
- **Synthesis:** Reviewer A only; standard image-upload hardening.
- **Editor's context note:** API-SPEC §6 confirms server-side transcode-to-WEBP on upload; PRD §5.7.5 and DATABASE-SCHEMA §7 describe type + size validation only. Decoded-dimension bounding is not specified — accurate.

---

**`S12` — Bulk PII export is unauditable · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §6.1`, `§5.3`; `PRD §5.6.8`
- **Finding:** The Directory CSV export is "pure client-side" and the MITAA export reuses it; neither hits a backend endpoint, and the audit stream's enumerated events do **not** include export. So the highest-volume exfiltration path — a manager/admin downloading the whole visible directory, or an admin exporting consenting brothers' full contact set to MITAA — leaves no security audit trail (the Mixpanel client-side "export" event is analytics, and client-controlled).
- **Suggested fix:** Route bulk/MITAA export through (or notify) a thin backend endpoint that writes an audit entry (actor, scope/row-count, timestamp), even if generation stays client-side; add "export" to the §6.1 audit event list.
- **Raised by:** A-2 #12 (`should-fix`).
- **Synthesis:** Reviewer A only. Tension with the deliberate client-side-export design (D41); see context note.
- **Editor's context note:** D41 makes export client-side *by design* (it "falls straight out of the bulk-download architecture and inherits the per-role projection for free, so no export endpoint … is needed") — so this finding asks to add back a server touchpoint purely for auditability, which is a real decision tradeoff for triage, not an oversight. §6.1's audit event list indeed omits export.

---

**`S13` — Restore can set roles outside the audited role-change path, and backups are unguarded crown-jewels · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §6.3 (D63)`; `API-SPEC §7 (/api/admin/restore)`
- **Finding:** Backups are a JSON export of all three collections (incl. `users` = `role`), and restore is a "faithful whole-database replacement" that writes system/verification fields verbatim, exempt from import rules. An admin tricked into restoring an attacker-supplied/altered backup thereby grants `role: admin` (and arbitrary `verifiedBy`/`ghostMemberId`) with **no per-record role-change audit**. The manual backup is also a complete off-platform PII archive whose integrity, encryption, and storage ACLs are unspecified.
- **Suggested fix:** Validate/authenticate restore inputs (schema + integrity check, e.g. a signed manifest); audit-log the full role delta a restore applies; specify access controls/retention/encryption for the backup bucket and the downloadable archive; consider excluding or separately gating `role` on restore.
- **Raised by:** A-2 #15 (`should-fix`).
- **Synthesis:** Reviewer A. Intersects `R5` (restore atomicity/divergence, which also absorbs the "restore bypasses structural validation" facet) and `P3` (restore resurrects deleted) — restore is a multi-lens hotspot. Different fixes; triage may bundle.
- **Editor's context note:** D63/§6.3 confirm restore is verbatim and "not subject to the import rules"; D52 gates it behind a typed acknowledgment + back-up-first prompt (a UX guard, not an input-integrity guard). Backup bucket encryption/ACL/retention is genuinely unspecified in §6.3.

---

**`S14` — No Content-Security-Policy or standard security headers beyond HSTS · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §2.7`, `§6.4 (D64)`
- **Finding:** The hardening list covers cookies, CSRF (SameSite), and HSTS, but there is no CSP, `X-Content-Type-Options: nosniff`, or framing/`frame-ancestors` policy. Book stores and renders user-supplied content (names, links, `adminNote`, obituary URLs) and loads a third-party analytics script — a CSP is the key defense-in-depth against stored/reflected XSS.
- **Suggested fix:** Define a strict CSP (script/style/connect/img/frame-ancestors), `X-Content-Type-Options: nosniff`, and a framing policy; document them alongside HSTS in §6.4.
- **Raised by:** A-2 #14 (`should-fix`).
- **Synthesis:** Reviewer A. Defense-in-depth companion to `S15` (URL-scheme XSS).
- **Editor's context note:** D64/§6.4/§2.7 list HSTS + the `Secure`/`HttpOnly`/`SameSite=Strict` cookie attributes and nothing else — no CSP or nosniff. Accurate.

---

**`S15` — Stored XSS via user-supplied URLs if the scheme is not strictly allowlisted · `should-fix`**
- **Where:** `DATABASE-SCHEMA §8`; `PRD §5.7.4`, `§5.7.7`
- **Finding:** `links[].url`, `obituaryUrl`, and `inMemoriamUrl` are validated as "valid `http(s)` URL," but if the check is a loose URL match rather than a strict scheme allowlist, a stored `javascript:`/`data:` URL becomes script-on-click when rendered as an anchor.
- **Suggested fix:** Strictly allowlist the `http`/`https` scheme on write (reject all others); on render, emit anchors with `rel="noopener noreferrer"` and never interpolate URLs into dangerous sinks.
- **Raised by:** A-2 #16 (`should-fix`).
- **Synthesis:** Reviewer A. Pairs with `S14`.
- **Editor's context note:** DATABASE-SCHEMA §8 does say "valid `http(s)` URL" — so a scheme constraint is *specified*; the finding is about ensuring the implementation is a strict allowlist (reject `javascript:`/`data:`) rather than a permissive match, plus safe rendering. Partly an implementation-discipline flag rather than a pure spec gap.

---

**`S16` — `DevIdentityProvider` is a single-gate total auth bypass · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §6.6 (D72)`
- **Finding:** The dev provider "issues a session for a chosen identity and role with no Ghost," guarded by one env check ("the backend refuses to start if the dev provider is combined with a production configuration"). A single misconfiguration there = anyone can mint any identity at any role (incl. admin) against production.
- **Suggested fix:** Defense-in-depth — exclude the dev provider from the production build/bundle entirely (not just disable it); require multiple independent signals to enable it; add a CI assertion that the prod artifact cannot instantiate it; alert if it is ever loaded in prod.
- **Raised by:** A-2 #17 (`should-fix`).
- **Synthesis:** Reviewer A; hardens a deliberate test seam (D21/D72).
- **Editor's context note:** D72/§6.6 confirm the single env-gate ("refuses to start if … combined with a production configuration"). The finding asks to strengthen a control that exists, not to add a missing one.

---

**`S17` — Linter roster auth: pin the service-account *subject*, and the Cloud Run IAM "front door" may be infeasible · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §5.2 (D58)`; `API-SPEC §8`
- **Finding:** Two related points. (A, Reviewer A) The roster auth must require **all of** Google issuer, audience = Book, **and** subject = the designated `linter` service account; if the in-code path checks only issuer + audience, *any* Google-issued token for that audience is accepted. (B, Reviewer B) The proposed alternative — verifying the SA token "at the Cloud Run front door (require auth + grant `roles/run.invoker`)" — is **architecturally impossible** for Book, because Cloud Run IAM is all-or-nothing per service: you cannot require IAM auth on `/api/roster` while leaving `/api/auth/session` and the SPA publicly reachable on the same service. So the in-code Google-JWKS check is the only viable option.
- **Suggested fix:** Drop the IAM-front-door option; mandate in-code verification of the Google OIDC token against Google's JWKS for `/api/roster`, requiring issuer + audience + the exact `linter` SA subject; least-privilege any `run.invoker` grant. Test wrong-issuer/wrong-audience/wrong-subject rejection.
- **Raised by:** A-2 #18 (`should-fix`, subject-pinning), B-2 #5 (`should-fix`, front-door infeasible).
- **Synthesis:** **A factual divergence worth surfacing:** D58/§5.2/§8 offer *both* the IAM front-door and the in-code check as acceptable; A treats both as viable and focuses on subject-pinning; B argues the front-door cannot coexist with the public SPA/auth endpoints on one service. Triage should resolve which is correct (B's per-service-IAM claim is the load-bearing one) and then apply A's subject-pinning to the surviving option.
- **Editor's context note:** ENGINEERING-DESIGN §5.2 and API-SPEC §8 both present the two options as equivalent ("either the Cloud Run front door … or an in-code JWKS check"). B's argument hinges on the SPA, `/auth/session`, and `/api/roster` all being served by the *same* Cloud Run service behind one URL map (as §1.1/§1.2 describe), where per-service IAM would lock out the public endpoints — so the concern is consistent with the stated architecture.

---

**`S18` — The last-admin safeguard appears to live only in the UI · `should-fix`**
- **Where:** `PRD §5.7.10 (D51)`; `API-SPEC §5 (PUT /api/users/{id}/role)`
- **Finding:** "A safeguard prevents demoting the last remaining administrator" is described as on-profile UI behavior; the role endpoint contract lists only admin-only + 404/422 and says nothing about it. If unenforced server-side, a direct API call can remove the final admin and lock the org out of all admin functions (backup/restore, add/delete, role changes, Ghost sync).
- **Suggested fix:** Enforce the last-admin invariant server-side in the role endpoint (reject demotion of the only admin), independent of the UI; audit-log every role change with before/after.
- **Raised by:** A-2 #8 (`should-fix`).
- **Synthesis:** Reviewer A. The audit-log-role-changes ask also supports `S13`.
- **Editor's context note:** D51/PRD §5.7.10 describe the safeguard in UI terms ("prevents demoting the last remaining administrator … warns on self-demotion"); API-SPEC §5 lists only `404`/`422` — server-side enforcement of the invariant is indeed unstated in the contract.

---

**`S19` — CORS and session-cookie domain scoping must be explicit · `minor`**
- **Where:** `ENGINEERING-DESIGN §2.3`, `§2.5`, `§2.7`
- **Finding:** Cookie-auth + `SameSite=Strict` CSRF defense depends on two unstated things: (a) `/api/*` must not enable permissive/credentialed CORS (no `Access-Control-Allow-Origin` reflection with credentials, especially for `pbe400.org`), or cross-origin reads of authenticated responses become possible; (b) the session cookie must be **host-only** on `book.pbe400.org` (no `Domain=.pbe400.org`), or Ghost / any sibling subdomain could read it. The CDN cookie is stated host-only; the session cookie's host-only status is not.
- **Suggested fix:** State and enforce a deny-by-default CORS policy on `/api/*` and an explicit host-only session cookie (no `Domain` attribute).
- **Raised by:** A-2 #21 (`minor`).
- **Synthesis:** Reviewer A; specification-completeness.
- **Editor's context note:** §2.5 says the *CDN* cookie is kept host-only; §2.3/§2.7 specify the session cookie's `Secure`/`HttpOnly`/`SameSite` but not host-only, and no CORS policy is stated anywhere — accurate.

---

## 5. Privacy findings (`P`)

> Both reviewers judged the design's *internal* privacy posture genuinely strong (server-side projection as the enforced floor, the fragment-carried token, names-not-values audit logging, `localStorage` not cookies, the well-minimized Book→Ghost push, `adminNote` barred from MITAA files). Every finding here is a **boundary-crossing** issue: the consent/projection model governs reads of the live record but not the copies and exports that leave it. One cross-cutting fix would close most of them — a single "data leaving Book" register enumerating each egress, its consent basis, retention, and deletion behavior, feeding the privacy notice (`P2`).

---

**`P1` — Identifying PII is shipped to Mixpanel regardless of consent, with Do-Not-Track overridden and no disclosure · `blocker`**
- **Where:** `ENGINEERING-DESIGN §6.2 (D62)`; `USER-MANUAL §8`
- **Finding:** Every brother's **email** (`distinct_id`), **full name**, **Constitution ID**, and **role** are sent to a third-party analytics vendor on `identify()`/user-properties, regardless of any privacy or consent toggle, with **`ignore_dnt: true`** overriding Do-Not-Track/GPC, and Identity Merge linking it to PBE-News (Ghost) browsing. This entire flow is **absent from the only user-facing privacy disclosure** (USER-MANUAL §8, which lists only PBE News and MITAA). It routes identifying PII around the projection/consent model the design otherwise relies on, contradicts the stated "data never leaves the brotherhood" posture, and is a likely CCPA "sharing/sale"; shipping `role` also exposes the admin roster to Mixpanel.
- **Suggested fix:** Disclose Mixpanel in a privacy notice (→ `P2`); minimize what is sent (drop name; use an opaque/hashed `distinct_id` rather than raw email; reconsider sending Constitution ID and `role`); execute a Mixpanel service-provider/DPA term; provide an opt-out and re-justify or remove `ignore_dnt: true`; propagate brother deletion to Mixpanel (→ `P3`).
- **Raised by:** A-3 #1 (`blocker`), B-3 #1 (`blocker`), A-2 #13 (`should-fix`, from the security lens).
- **Synthesis:** Both reviewers, privacy + security. The most-cited privacy issue. The "minimize the payload" fix overlaps `P6` (no PII in *event properties*).
- **Editor's context note:** D62/§6.2 confirm email-as-`distinct_id`, Constitution ID + role + name as user properties, and `ignore_dnt: true` verbatim, with a one-line defense ("defensible for a consensual, members-only internal tool") that does not address disclosure or DNT/GPC legal exposure. USER-MANUAL §8 confirms only PBE News + MITAA are disclosed — Mixpanel is genuinely absent. D62 itself states properties should carry "no PII," which aligns with `P6`.

---

**`P2` — No CCPA / data-subject machinery and no notice-at-collection · `blocker`**
- **Where:** whole design; `USER-MANUAL §8`; `API-SPEC §2`
- **Finding:** There is no privacy policy / notice-at-collection, no documented data-subject **access** (right-to-know), **deletion**, or **opt-out-of-share** request path, and no verification process for such requests. The system auto-provisions a profile on first Ghost handshake with no intercept disclosing data processing, analytics, or external-sharing defaults. A CCPA-covered system cannot meet its core obligations as designed.
- **Suggested fix:** Add a privacy policy + notice-at-collection enumerating categories, purposes, third parties (Ghost, Mixpanel, MITAA, Google, the log-reader agent), and retention; design a verifiable consumer-request workflow (access incl. `adminNote`, deletion, opt-out of MITAA/Mixpanel sharing), even if admin-mediated; name the controller/business; consider a first-login acknowledgment interstitial.
- **Raised by:** A-3 #2 (`blocker`), B-3 #7 (`should-fix`, "notice at collection").
- **Synthesis:** Both reviewers. The umbrella for `P1`/`P3`/`P5`/`P8`. Its legal force hinges on `P18` (does CCPA apply to a nonprofit?).
- **Editor's context note:** Nothing in the suite specifies a privacy notice beyond USER-MANUAL §8's two-paragraph sharing summary; no DSAR path exists. See `P18` for the applicability question that scopes this.

---

**`P3` — Data cannot be fully deleted on request; Restore resurrects deleted people · `blocker`**
- **Where:** `API-SPEC §3 (DELETE)`; `ENGINEERING-DESIGN §6.3 (D63)`, `§6.2`, `§5.3`; `DATABASE-SCHEMA §7`
- **Finding:** Delete is a hard delete ("recoverable only from backups") but the person persists in: daily/monthly JSON backups, **GCS object versioning** (old headshots), the **audit log** bucket (target ID + actions, months-to-years), **Mixpanel** (no deletion call), and **already-sent MITAA snapshots** — and **Restore re-creates** deleted brothers verbatim. CSV exports and manual backup archives are further uncontrolled copies.
- **Suggested fix:** Define a deletion lifecycle across every store: a **tombstone / deny-list of deleted IDs** so Restore/import never resurrect them; documented backup expiry that ultimately purges (or crypto-shred); GCS non-current-version cleanup; audit-log retention/minimization; a Mixpanel deletion call; and disclosure that MITAA copies already shared cannot be recalled.
- **Raised by:** A-3 #3 (`blocker`), B-3 #4 (`should-fix`, restore resurrects → tombstone).
- **Synthesis:** Both reviewers; B's tombstone is A's deny-list. Intersects `R5`/`S13` (restore) and `P7` (image versions). The tombstone also guards the runtime-resurrection path in `R1` create-orphans.
- **Editor's context note:** API-SPEC §3 confirms DELETE cascades to the `users` doc + GCS objects only; D63/§6.3 confirm restore is a verbatim whole-database replacement "not subject to the import rules" with no deletion-aware step; GCS versioning is on (D8/§7). All copies named are real.

---

**`P4` — `allowShareWithMITAA` defaults to opt-in for *external* sharing, and migration never seeds it · `blocker`**
- **Where:** `DATABASE-SCHEMA §3.1`/`§9`; `DECISIONS D45`/`D57`/`D59`; `PRD §5.7.3`
- **Finding:** The external-sharing master switch defaults `true`, so a passive brother's email/phone/postal address is shared with MITAA on the next admin export, and migration **does not seed it from any prior consent** (only newsletter/comment prefs are seeded from Ghost, D57). At launch ~840 brothers are silently opted into external sharing — reinstating the exact opt-out harm the product exists to fix, and contradicting D45's ethical defense of open defaults, which rests explicitly on "the data never leaves the brotherhood" (false for this one flag).
- **Suggested fix:** Default `allowShareWithMITAA` to **false** (affirmative opt-in for external sharing), or seed it from a defensible prior consent record; decouple its default from the peer-sharing toggles; do not rely on the intra-brotherhood nudge rationale for data that exits the brotherhood.
- **Raised by:** A-1 #1 (`blocker`, structural), A-3 #6 (`should-fix`, privacy).
- **Synthesis:** Both lenses of Reviewer A; B's `P5` is the closely-related forced-flow facet. The convergence is A-structural + A-privacy + B-privacy all on the MITAA consent model. Splitting `P4` (the default) from `P5` (the opt-out carve-out) keeps the two distinct fixes triageable.
- **Editor's context note:** D45 lists `allowShareWithMITAA` among the six booleans defaulting open and grounds open defaults in "the data never leaves the brotherhood"; D59 makes it a master switch; §9/§3.3 confirm default `true`; D57 confirms migration seeds only `allowNewsletterEmail`/`allowCommentReplyEmail` from Ghost, not the MITAA flag. The finding's premise is precisely the design as written.

---

**`P5` — MITAA export forces identity/class/death even on opt-out; "off shares none" is misleading; no use-limitation agreement · `blocker`**
- **Where:** `ENGINEERING-DESIGN §5.3`; `DATABASE-SCHEMA §9`; `PRD §6.3`; `USER-MANUAL §8`/helper text
- **Finding:** When `allowShareWithMITAA` is **off**, the export still sends **name + class year + public deceased status/obituary**. The switch is presented to brothers as a master "off shares none of it" control (helper text), with the always-flow carve-out only in fuller fine print — and under CCPA you cannot force-transfer identity data to a third party after a valid opt-out. Separately, **no data-sharing/use-limitation agreement with MITAA** is specified for what the receiving side may do with the shared contact set.
- **Suggested fix:** Either honor the opt-out for identity too (omit opted-out brothers entirely), or make the toggle copy unambiguous that name/class/death always flow; put a written use-limitation agreement in place with MITAA governing retention and secondary use.
- **Raised by:** B-3 #2 (`blocker`), A-3 #7 (`should-fix`).
- **Synthesis:** Both reviewers. **A genuine design-decision tension for triage:** the always-flow is *deliberate* (see context note), so this is a candidate for (b)-as-designed-with-clearer-copy *or* (a)-fix-on-legal-grounds — exactly the kind of call triage exists to make. Pairs with `P4`.
- **Editor's context note:** D59/§5.3/§9 deliberately always-flow identity + public death data "regardless of the flag," with a stated rationale — it is MIT's own data and the join key, and the death info is the reciprocal of the import's death-catching value (PBE sometimes learns of a death before MITAA). USER-MANUAL §8 *does* disclose the carve-out ("basic facts already public … always flow"), but the one-line helper text says "off shares none of it" — so the inconsistency the reviewers flag is between the helper text and the fuller disclosure, and the legal question is whether the deliberate carve-out survives a CCPA opt-out (→ `P18`).

---

**`P6` — Mixpanel event properties risk carrying person-to-person PII (who searched/viewed/starred whom) · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §6.2`
- **Finding:** The taxonomy tracks per-event context bound to the brother's real identity. "No PII in properties" is asserted but fragile: if `search performed` carries the query (a name), the Profile page-view carries the `/brother/:id` target, or `star toggled` carries the starred ID, Mixpanel learns **who searched for / viewed / starred whom** — leaking the explicitly-private `stars` list and a peer-interest graph to a third party.
- **Suggested fix:** Explicitly forbid sending the search term, viewed-brother ID, and starred-brother ID (and any record values) as event properties; add a test/lint that fails if person identifiers appear in event payloads.
- **Raised by:** A-3 #14 (`should-fix`).
- **Synthesis:** Reviewer A. Enforces what D62 already *intends* ("properties … never PII") — so this is largely a "make the intent testable" finding. Companion to `P1`.
- **Editor's context note:** §6.2's taxonomy lists `search performed`, `filter applied (which field)`, `star toggled`, `Starred only`, etc., and asserts "Properties carry context … but never PII." The finding is that nothing yet *enforces* the assertion for the person-identifier cases.

---

**`P7` — Removed/prior headshots remain permanently retrievable · `should-fix`**
- **Where:** `DATABASE-SCHEMA §7`; `API-SPEC §6`; `ENGINEERING-DESIGN §2.5 (D23)`
- **Finding:** Each upload writes a new path `…/{id}/{version}.webp` with a **sequential integer** version, object versioning is on, and the signed cookie grants the **whole `/img` prefix** — so any authenticated brother can enumerate and fetch a brother's *old* photos at guessable URLs, and "Remove photo"/replacement does not actually make earlier images unreachable (also complicating true deletion, `P3`). A brother who removes their photo would reasonably expect it gone.
- **Suggested fix:** Use non-guessable version tokens (random/opaque, not sequential); on replace/remove/delete, delete *all* prior object versions for that brother; add a GCS lifecycle rule to purge non-current versions after a short window; confirm the CDN does not serve superseded objects.
- **Raised by:** A-3 #8 (`should-fix`), B-3 #6 (`should-fix`), A-2 #20 (`minor`, security framing: coarse non-revocable grant + persistent removed photos).
- **Synthesis:** Both reviewers, privacy + security. The opaque-token fix is the same one `R16` wants for the upload race. The coarse-grant *itself* is deliberate (D23); the finding is about old-version retention, which D23 does not address.
- **Editor's context note:** API-SPEC §6 shows `headshotVersion` as `"7"→"8"` (sequential), though DATABASE-SCHEMA §3.1 types it as an opaque string — a latent inconsistency triage should settle. D23 deliberately makes the read grant coarse and §7 enables object versioning; neither addresses purging superseded objects.

---

**`P8` — `adminNote` is personal data hidden from its subject, with no right-to-access path · `should-fix`**
- **Where:** `DATABASE-SCHEMA §9`; `PRD §4.2`/`§5.7.2`; `DECISIONS D56`
- **Finding:** `adminNote` is free-text personal data about a brother, deliberately invisible to that brother, seeded from arbitrary historical Ghost notes, and copied into manager/admin CSV exports and backups. CCPA right-to-know generally requires disclosing PI held about a subject on request — directly at odds with "the first field the owner cannot see."
- **Suggested fix:** Confirm `adminNote` is disclosable on a verified access request (→ `P2`); constrain its use (no special-category content); add retention limits; treat it as in-scope for deletion; keep its export tightly controlled.
- **Raised by:** A-3 #11 (`should-fix`), B-3 #3 (`blocker`, DSAR endpoint).
- **Synthesis:** Both reviewers; B escalates to blocker and proposes a concrete DSAR export endpoint. The hidden-from-owner property is a deliberate design choice (D56) now colliding with a legal-access right — a triage tension.
- **Editor's context note:** D56/§9 make `adminNote` staff-internal *by design* ("its whole value depends on the brother not seeing it"), the first field the owner cannot see. §10 already bars it from MITAA files. The finding does not dispute the design's intent; it flags the access-right collision, which is real if CCPA applies (`P18`).

---

**`P9` — URL view-state leaks names via `Referer` and browser history; no `Referrer-Policy` · `should-fix`**
- **Where:** `PRD §5.4`/`§5.6.x (D31)`; `ENGINEERING-DESIGN §6.1`
- **Finding:** The Name Search term (a name), filters (incl. consent/verification), and `/brother/:id` live in the URL query/path. With no stated `Referrer-Policy`, same-origin requests to `/api/*` and `/img/*` — and clicks on external links (`obituaryUrl`, `links`) — attach the full URL as `Referer`, landing search terms and "who viewed whom" in access logs and on external sites; the URLs also sit in browser history on shared machines. The auth flow carefully avoids this for the *token* (D20) but ongoing view-state is unprotected.
- **Suggested fix:** Set a strict `Referrer-Policy` (`same-origin`/`strict-origin-when-cross-origin`/`no-referrer`); keep the search term out of access-loggable surfaces; confirm Firebase/LB logs don't retain query strings/Referer with PII.
- **Raised by:** A-3 #12 (`should-fix`), B-3 #5 (`should-fix`).
- **Synthesis:** Both reviewers; B emphasizes the external-link leak, A the access-log leak. Same fix.
- **Editor's context note:** D31 confirms view-state (search/filters/sort) lives in the URL query and `/brother/:id` in the path; no `Referrer-Policy` is specified in §2.7/§6.4. D20's fragment trick protects the token only.

---

**`P10` — The names-not-values discipline covers only the audit stream; diagnostic/error logs (and a star's target ID) can hold values · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §6.1 (D61)`
- **Finding:** The "log identifiers and field names, never values" rule is scoped only to the **audit** stream. The **diagnostic** stream (Ghost-push successes/failures, "unexpected states," slow ops) has no such constraint, so a push-failure or error path can capture contact **values** (email, name, preferences) into logs with looser access controls. Relatedly, for a `stars` action the audit's "target ID" *is* the value being manipulated (who was starred) — a technical exception to the no-values rule worth documenting.
- **Suggested fix:** Extend the names-not-values discipline to **all** log streams; forbid logging request/response bodies or Ghost payloads; scrub PII from error/diagnostic logs and test it; document the explicit relationship-edge exception (stars, big-brother) where the target ID is inherently part of the action metadata.
- **Raised by:** A-3 #9 (`should-fix`), B-2 #8 (`minor`, from the security lens — stars target ID is a value).
- **Synthesis:** Both reviewers. A wants the discipline extended outward; B notes a boundary case inside it. Same control surface (§6.1).
- **Editor's context note:** §6.1/D61 state the names-not-values discipline specifically for the *audit* stream and list the diagnostic stream's contents ("Ghost-push successes and failures … unexpected states") with no values constraint — accurate. The audit entry shape is "actor ID, target ID, action, outcome," so a star's target ID is indeed the person.

---

**`P11` — Full projected dataset persists in the browser's HTTP disk cache on shared/public machines · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §1.6 (D76)`; `USER-MANUAL §2`
- **Finding:** The conditional-GET design relies on the browser persisting the full projected dataset in its HTTP disk cache across tab close/restart (`private, no-cache` stores-but-revalidates). On a shared/public computer (a use the manual anticipates), the entire directory — every contact value the role may see — remains on disk after the 4-hour session lapses, until evicted, partially undercutting the deliberate "no service worker; on-device member data is a privacy cost" choice (D73).
- **Suggested fix:** Bound the on-disk residue — consider `no-store` for `/api/profiles` (accepting the 304 trade-off) or a shorter cache lifetime; advise sign-out-and-clear on shared machines; document the residual-copy risk in the privacy notice.
- **Raised by:** A-3 #10 (`should-fix`).
- **Synthesis:** Reviewer A. Direct tension with the `R3`/`P` wire-efficiency goals (D76 exists to avoid re-downloading) — a privacy-vs-performance trade for triage. Related to `U4` (no logout to clear on shared machines).
- **Editor's context note:** D76 confirms `Cache-Control: private, no-cache` and that "the browser's HTTP cache survives tab close and restart"; D73 confirms the no-service-worker choice was made on exactly these privacy grounds — so the finding is an internally-consistent observation that the HTTP cache reintroduces a smaller version of the residue D73 avoided.

---

**`P12` — A planned log-reader "agent" may egress audit data (who-did-what-to-whom) to a third party · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §6.1 (D61)`
- **Finding:** A log-reader agent is granted `roles/logging.viewer` over the audit stream, which records who did what to whom across the membership — a behavioral profile. If the agent is LLM-backed and cloud-hosted (as "agent" implies), audit contents egress to an external model provider — an unexamined third-party data flow covered by no disclosure.
- **Suggested fix:** Specify the agent's data flow; if it sends log content to an external LLM, disclose and contractually constrain that processor, minimize fields exposed, or keep the agent first-party/on-premise; reflect it in the privacy notice (`P2`).
- **Raised by:** A-3 #13 (`should-fix`).
- **Synthesis:** Reviewer A. Another egress for the "data leaving Book" register (`P2`).
- **Editor's context note:** §6.1 names a "planned log-reader agent" with `roles/logging.viewer` but does not specify whether it is on-premise or a cloud LLM — so the data-flow is genuinely unspecified, as the finding says.

---

**`P13` — Emergency contacts (third-party, non-member data) default to shared and are broadcast to all peers · `should-fix`**
- **Where:** `DATABASE-SCHEMA §3.2`/`§9`; `PRD §5.7.3`
- **Finding:** Emergency contacts are a non-member's name/phone/email, yet `shareEmergency` defaults `true`, so by default every brother's emergency contact is broadcast into all ~840 living brothers' browsers and backups. The design itself recognizes this as third-party data (it excludes it from MITAA export) but broadcasts it inside Book by default; the third party never consented and has no control.
- **Suggested fix:** Default `shareEmergency` to **off** (opt-in), and/or restrict emergency-contact visibility to managers/admins; note the third-party basis in the consent copy; reconcile with the MITAA-exclusion rationale.
- **Raised by:** A-3 #4 (`should-fix`).
- **Synthesis:** Reviewer A. Same "third-party data, no consent" theme as `P14` (spouse/partner). Tension with the deliberate all-toggles-default-open nudge (D45).
- **Editor's context note:** D16/§3.2 confirm `shareEmergency` is toggle-class defaulting `true`; §5.3 confirms emergency data is *excluded* from MITAA precisely as third-party data — so the design's own classification supports the finding's premise. D45's open-default rationale ("data never leaves the brotherhood") applies inside Book but the data subject is a non-member who didn't consent.

---

**`P14` — `spousePartnerName` (third-party), `employerName`, `jobTitle`, and `links` are public-class with no visibility toggle · `should-fix`**
- **Where:** `DATABASE-SCHEMA §3.1`/`§3.3` (Visibility = public)
- **Finding:** A brother cannot hide these, and a spouse/partner has their name published to the whole brotherhood with no opt-out or knowledge. Every other contact category is toggle-controlled; these are not.
- **Suggested fix:** Give at least `spousePartnerName` (ideally employer/jobTitle) a share-toggle like the other contact fields; treat spouse/partner as third-party data with a documented basis, or store only with the partner's awareness.
- **Raised by:** A-3 #5 (`should-fix`).
- **Synthesis:** Reviewer A; the no-toggle companion to `P13`'s default-on. Both ask whether the consent surface should extend to these fields.
- **Editor's context note:** §3.3 confirms `spousePartnerName`/`employerName`/`jobTitle`/`links` are public class with no toggle — accurate. This is a deliberate classification (no decision singles these out as needing a toggle), so it is a design-completeness question for triage.

---

**`P15` — `ghostMemberUuid` is collected and retained with no current purpose · `minor`**
- **Where:** `DATABASE-SCHEMA §3.1`; `DECISIONS D70`
- **Finding:** `ghostMemberUuid` is stored now but "reserved for future use (e.g. cross-app analytics identity)" — collecting/retaining an identifier with no current consumer is contrary to data-minimization / purpose-limitation, and (structurally) is mild gold-plating that widens the projection/backup/migration surface with no PRD requirement.
- **Suggested fix:** Defer capturing `ghostMemberUuid` until a concrete need exists, or document the specific purpose and retention; revisit once the Mixpanel-uuid-identity idea (D62/D70) is actually decided.
- **Raised by:** A-3 #16 (`minor`, privacy/minimization), A-1 #24 (`question`, structural/gold-plating).
- **Synthesis:** Both lenses of Reviewer A on the same field. The "free to capture now" rationale (D70) is reasonable; the finding asks whether it earns its MVP place.
- **Editor's context note:** D70/§3.1 confirm `ghostMemberUuid` is "captured alongside [the id] and reserved for future use" with no MVP consumer — accurate. The companion `ghostMemberId` *is* used (Ghost-update addressing, D55); only the uuid is speculative.

---

**`P16` — No data-retention schedule is documented per category · `minor`**
- **Where:** `ENGINEERING-DESIGN §6.1`/`§6.3`; whole design
- **Finding:** No retention schedule is documented for living-brother profiles, departed/inactive members, audit logs (only "months to a few years"), or backups (only "N dailies plus a few monthlies"). CPRA requires disclosing retention periods per category.
- **Suggested fix:** Define and disclose retention periods per data category, including a basis for indefinite retention of deceased memorial data and a policy for departed members.
- **Raised by:** A-3 #17 (`minor`).
- **Synthesis:** Reviewer A; feeds the privacy notice (`P2`).
- **Editor's context note:** §6.1 gives audit retention as "months to a few years" and §6.3 backups as "N dailies plus a few monthlies"; no per-category schedule exists — accurate.

---

**`P17` — Headshots have no per-brother visibility control while every other contact field does · `minor`**
- **Where:** `DATABASE-SCHEMA §7`; `DECISIONS D23`
- **Finding:** A brother who can hide email/phone/address cannot hide their photo from peers (the coarse signed-cookie grant). A facial image is personal data; the inconsistency may surprise brothers.
- **Suggested fix:** Decide deliberately whether a photo opt-out is warranted; if intentionally none, state it clearly in the privacy disclosure so the asymmetry is transparent.
- **Raised by:** A-3 #18 (`minor`).
- **Synthesis:** Reviewer A; the coarseness is deliberate (D23) — this asks that the deliberate asymmetry be made transparent rather than changed.
- **Editor's context note:** D23 deliberately makes photo access coarse ("photos carry no per-brother privacy") — so this is a candidate for (b)-as-designed with a disclosure note, distinct from `P7` (which is about *retention* of removed photos, a real gap).

---

**`P18` — Whether CCPA legally binds a nonprofit fraternal/alumni group is unsettled · `question`**
- **Where:** whole design
- **Finding:** This review assumed CCPA applies (per the review prompt), but PBE appears to be a nonprofit fraternal/alumni group, generally outside CCPA's "business" definition. Whether the obligations behind `P1`/`P2`/`P3`/`P5`/`P8` are legally mandatory vs. best-practice turns on this.
- **Suggested fix:** Obtain a legal determination of CCPA (and any other regime) applicability; until then, build to the stricter assumption for the privacy blockers.
- **Raised by:** A-3 #19 (`question`).
- **Synthesis:** Reviewer A. **Scopes the legal force of the entire privacy-blocker cluster** — triage should resolve this early, as it governs whether `P1`/`P2`/`P3`/`P5`/`P8` are "must" or "should."
- **Editor's context note:** Correct that CCPA's "business" thresholds and nonprofit carve-out make applicability a genuine open question for PBE; the underlying data-protection *practices* the findings recommend are sound regardless of legal compulsion.

---

**`P19` — Possible minors in the data may require special opt-in consent · `question`**
- **Where:** `USER-MANUAL §1`/`§11`; `DATABASE-SCHEMA §4`
- **Finding:** The audience is stated as "as young as 18," and `classYear` admits current undergraduates (`currentYear + 6`). CCPA imposes special opt-in consent for minors (<16). Are any data subjects under 18 (or under 16)?
- **Suggested fix:** Confirm whether any brother could be a minor; if so, add the required minor-consent handling; otherwise note the population is 18+ to close the question.
- **Raised by:** A-3 #20 (`question`).
- **Synthesis:** Reviewer A; quickly closeable either way.
- **Editor's context note:** Initiation is at MIT (undergraduate), so the population is effectively 18+, but the schema's `currentYear + 6` upper bound and "as young as 18" framing leave the edge unstated — a one-line clarification likely closes it.

---

## 6. Operations & reliability findings (`R`)

> Both reviewers credited the reliability bones: write-through Firestore so memory is never authoritative, optimistic concurrency on a server-authoritative `updateTime` with a non-destructive reconcile, versioned object storage, the read-only Ghost audit's never-write-Book invariant, and managed TLS. The recurring failure theme is **non-atomic multi-system mutations with no compensation and no observability to catch the resulting drift**: nearly every write of consequence touches two or more of {Firestore, GCS, Ghost}, the failure path is "the manual audit will catch it eventually," and the only specified alert is on sign-in denials — not on the push failures that actually drive divergence.

---

**`R1` — The Book→Ghost dual-write is non-atomic with no outbox, retry policy, or alert · `blocker`**
- **Where:** `ENGINEERING-DESIGN §5.1`; `DECISIONS D55`; `PRD §6.1`
- **Finding:** Create/update/delete/deceased each write Firestore *and* call the Ghost Admin API with no transaction; the docs say only "retried a few times and otherwise left for this audit to catch (retry mechanics are a Session-6 operations detail)" — but §6 never specifies them. Concrete failure modes: **(a) email-change lockout** — a brother edits their own email, the push to Ghost fails, Book holds the new email while Ghost holds the old; the next sign-in JWT carries an email Book can't resolve → denied until a human reconciles; **(b) deceased brother still emailed** — a failed unsubscribe-push means Ghost keeps mailing PBE News toward a deceased brother (family-facing harm); **(c) create orphans** — Firestore profile written but Ghost create fails (brother can never sign in), or Ghost member created but `ghostMemberId` fails to persist (next update can't address the member; a retried POST 409s on the existing Firestore doc). If the push is synchronous in the request, Book's write latency/availability is also coupled to Ghost.
- **Suggested fix:** A durable **transactional outbox / pending-push queue** with idempotent, bounded-backoff retry and a dead-letter that drives an **alert** (not a manual audit); make pushes idempotent (address by `ghostMemberId`; treat "already exists" as success); commit Firestore then enqueue the push, decoupling Save latency from Ghost; surface a user-visible status when a push is pending; treat email-change specially since it gates auth.
- **Raised by:** A-1 #2 (`blocker`), A-4 #1 (`blocker`), B-4 #1 (`blocker`), B-1 #5 (`should-fix`), A-4 #4 (`should-fix`, sync coupling), A-4 #24 (`question`, "is the push sync or async?").
- **Synthesis:** **The single most-converged issue in the review** — both reviewers, found in three of four lenses (structural, security-adjacent, ops). Both independently prescribe the outbox pattern. The email-change lockout is its headline; distinct from `S2` (the *duplicate-email* path to the same symptom). A-4 #24's open question — is the push sync or async? — is the design decision that must be pinned *before* the outbox is built.
- **Editor's context note:** §5.1 confirms the push is "real time on save," that failures are "retried a few times and otherwise left for this audit (retry mechanics are a Session-6 operations detail)," and that §6 never delivers those mechanics — the deferral is real and unclosed. D55 deliberately made the reconciliation audit *read-only into Book* to kill the failed-push-undo hazard, so any fix must keep that invariant (the outbox re-pushes Book→Ghost; it must not let Ghost overwrite Book). Addressing-by-`ghostMemberId` (D55) already makes email-change pushes unambiguous; the gap is purely the failure/retry path.

---

**`R2` — The snapshot-listener freshness model is unestablished on scale-to-zero Cloud Run and has no staleness detection · `blocker`**
- **Where:** `ENGINEERING-DESIGN §1.5`; `DECISIONS D26`
- **Finding:** D26 asserts each instance's cache stays correct "within a fraction of a second … self-healing and correct at any instance count." But Cloud Run throttles instance CPU to ~zero between requests unless "CPU always allocated" is set — so a background Firestore snapshot listener may not process change events (or may stay disconnected) while no request is in flight, and listeners can drop on network resets without redelivery. Because `GET /api/profiles` is served **only** from cache (zero Firestore reads) and the ETag is derived from that same cache, a stalled/dead listener serves stale data *and* 304-confirms it as current — the read path can never self-correct, and nothing alerts.
- **Suggested fix:** Establish the model before building — either set "CPU always allocated" (accept the cost change — it ends scale-to-zero economics) or drive cache refresh from the request path / scheduled revalidation rather than a purely-background listener; add a listener-health signal (last-event timestamp / resume-token watchdog) that fails the readiness probe and sheds the stale instance, plus a metric/alert on listener disconnects and cache age; hydrate from the listener's initial snapshot to avoid the read-then-subscribe gap.
- **Raised by:** B-1 #1 (`blocker`), A-4 #3 (`blocker`), B-4 #4 (`should-fix`).
- **Synthesis:** Both reviewers; B-1 even offers the alternative (Pub/Sub push subscriptions that wake instances via HTTP). The "stale-but-304-confirmed" insight (A-4) is the sharpest version — the cache and its freshness token share a single point of failure.
- **Editor's context note:** §1.5/D26 confirm the design claims "self-healing and correct at any instance count" and serves bulk reads from cache with zero Firestore reads; neither mentions Cloud Run's idle-CPU throttling of background work, which is the concrete platform behavior all three findings invoke. This is the most important *un-addressed* operational assumption in the suite.

---

**`R3` — Synchronous brotli-11 compression on the request path blocks the event loop (latency/DoS) · `blocker`**
- **Where:** `ENGINEERING-DESIGN §1.6 (D75)`
- **Finding:** The first `GET /api/profiles` after any write (or cold start) pays a full-dataset **brotli level 11** compression synchronously on the single-threaded Node event loop — notoriously CPU-intensive. The unlucky cache-miss caller eats a latency spike (potentially tripping gateway timeouts), and a brother making frequent edits triggers constant invalidate→recompress cycles, a low-privilege CPU DoS for all users.
- **Suggested fix:** Downgrade dynamic compression to brotli ~4–6, or move compression to an async background worker on cache invalidation rather than the request thread; debounce rebuilds during edit bursts; bound and measure the compression time at ~2,000 records as a Phase-7 perf gate.
- **Raised by:** B-1 #2 (`blocker`), B-2 #6 (`should-fix`), A-1 #27 (`question`).
- **Synthesis:** Both reviewers (B in two lenses; A as a perf question). **Severity divergence:** B rates it a blocker, A a question — but note `S1`/`R8` may force a *bigger* change here: if the buffer must be keyed per-caller (`S1`), the "amortize one slow compression over all downloads" rationale for choosing level 11 collapses entirely, which is the heart of D75. The rate-limiting fix (`S10`) addresses the abuse facet.
- **Editor's context note:** D75/§1.6 explicitly choose brotli-11 *because* "the one compression is amortized over every subsequent download," and confirm the invalidate-on-write/recompress-on-next-request model — so the synchronous-on-request cost is exactly as described, and its justification is the very amortization `S1` undermines. Triage should resolve `S1`, `R3`, and `S6` together.

---

**`R4` — Whole-database / bulk operations run as synchronous Cloud Run requests and will exceed the request timeout · `should-fix`**
- **Where:** `API-SPEC §6`/`§7`; `PRD §5.8`; `ENGINEERING-DESIGN §6.3`
- **Finding:** Backup (zip every headshot/thumbnail), restore, bulk-CSV apply, and Regenerate-all-thumbnails are specified as plain request/response endpoints; bulk delete is "iterate the selection against the per-record `DELETE`." "Regenerate all" has *no batch endpoint* — only per-id `thumbnail:regenerate`, so "all" is ~2,000 sequential HTTP calls; backup streams/zips ~50–150 MB of images through Cloud Run's ~32 MiB request limit. These exceed the request timeout (well before 10× load), leaving operations half-done with no progress, resumability, or rollback.
- **Suggested fix:** Move long-running ops to asynchronous jobs (Cloud Run jobs / Cloud Tasks / a function) with progress, chunking, idempotent resumability, and a result the Admin page polls; move large byte transfers via GCS signed URLs; add a dedicated server-side bulk-delete (batch write/transaction). The automated backup already uses Cloud Scheduler→function — apply the same shape to the manual/admin operations.
- **Raised by:** A-4 #8 (`should-fix`), A-1 #6 (`should-fix`, regenerate-all has no batch endpoint), A-1 #7 (`should-fix`, backup/restore size through Cloud Run), B-1 #6 (`should-fix`, client-side bulk-delete looping).
- **Synthesis:** Both reviewers, multiple facets of one shape ("long-running work doesn't belong in a request"). `R11` (bulk import) and `R5` (restore) are specific instances with extra concerns of their own.
- **Editor's context note:** API-SPEC §7 lists `/api/admin/backup` (GET) and `/restore` (POST) as plain endpoints with contracts "finalized in later sessions"; §6's `thumbnail:regenerate` is per-id, "may be issued per-id over a selection" — there is genuinely no batch/async job specified. D52 specifies these as *surfaces with mechanics deferred*; the deferred mechanics are what these findings ask for.

---

**`R5` — Restore is non-atomic, has no read-freeze, triggers a listener storm, bypasses validation, and silently diverges Book from Ghost · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §6.3 (D63)`, `§5.1`, `§1.5`; `DECISIONS D55`
- **Finding:** Firestore has no atomic "replace collection," so restore rewrites ~2,000 docs while live instances serve from caches churning under a snapshot-listener invalidation storm (potential OOM / read-amplification) — users see half-restored states, and a mid-restore failure leaves a mixed database with no rollback. Restore writes verbatim and is exempt from import rules, so a corrupted/edited backup can reintroduce big-brother cycles, duplicate IDs, or dangling references at the most destructive operation. And restore rewrites Book but **never reconciles Ghost** (sync is read-only by design), so rolling back to an older snapshot strands Ghost ahead of Book — the email-change lockout (`R1`) *en masse*, plus re-created/deleted-member divergence.
- **Suggested fix:** Put Book in read-only maintenance mode during restore (reject/queue writes; signal the SPA); make restore transactional-or-resumable with a verify step; run structural validation (cycles, ID uniqueness, reference integrity) even though field-level edit rules are intentionally bypassed; define an explicit post-restore Ghost reconciliation (a controlled bulk re-push), and state the RPO restore implies; disable/route-around snapshot listeners (or debounce hydration) during the bulk write.
- **Raised by:** A-4 #7 (`should-fix`), A-1 #17 (`should-fix`, Ghost divergence), B-4 #3 (`should-fix`, listener storm/OOM), A-1 #29 (`question`, bypasses structural validation).
- **Synthesis:** Both reviewers; four facets (atomicity, listener storm, Ghost divergence, validation) of the same operation. Intersects `S13` (restore role-grant audit), `P3` (restore resurrects deleted), `R2` (listener), `R1` (Ghost divergence). Restore is the suite's single biggest multi-lens hotspot.
- **Editor's context note:** §6.3/D63 confirm restore is a verbatim whole-database replacement "not subject to the import rules"; §5.1/D55 confirm the Ghost audit is read-only and never writes Book — so there is, by design, no path that re-aligns Ghost after a restore. The read-only invariant (D55) is deliberate and good; the gap is that it leaves *bulk* post-restore divergence with only the manual audit to catch it.

---

**`R6` — Sign-in availability is coupled to the JWKS endpoint with no fallback · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §2.1`, `§2.7`
- **Finding:** JWT verification needs Ghost's JWKS; the cache is in-memory, so a freshly cold-started instance with an empty JWKS cache cannot verify any login until it fetches JWKS — if Ghost/JWKS is unreachable at that moment, **all sign-ins fail**. Separately, "refresh on an unknown `kid`" lets an attacker force repeated JWKS refetches with random `kid`s.
- **Suggested fix:** Persist/seed the JWKS (or pin keys) so verification survives a cold start during a Ghost blip; serve a short grace window on last-known-good keys; rate-limit and single-flight unknown-`kid` refetches; add a synthetic sign-in canary (→ `R10`).
- **Raised by:** A-4 #5 (`should-fix`), B-4 #5 (`should-fix`).
- **Synthesis:** Both reviewers; identical fix (persist JWKS as a fallback store). The unknown-`kid` lever also appears in `S10`.
- **Editor's context note:** §2.7 confirms JWKS is cached in-memory and "refreshes … on a schedule and on an unknown `kid`"; nothing persists it across cold starts — accurate.

---

**`R7` — Multi-store mutations (headshot, delete, create) are non-atomic with no compensation; ordering unspecified · `should-fix`**
- **Where:** `API-SPEC §3`, `§6`; `ENGINEERING-DESIGN §5.1`; `DATABASE-SCHEMA §7`
- **Finding:** Headshot `PUT` = two GCS writes (512² + 96²) + one Firestore write; a partial failure leaves an orphaned object or a profile pointing at a version whose objects don't exist (CDN 404 / broken image). `DELETE` cascades profiles + `users` + N GCS objects + the Ghost member; any mid-cascade failure half-deletes the brother. `POST` create + Ghost-id capture has the same shape (`R1`c).
- **Suggested fix:** State ordering and cleanup/compensation for each — write objects then advance the version pointer (so the pointer only ever points at existing objects); order delete steps so a failure is re-runnable; add a periodic orphan-sweep (objects/`users`/Ghost members with no live profile); make each step idempotent so the whole op is safely retryable (→ `R13`).
- **Raised by:** A-4 #6 (`should-fix`).
- **Synthesis:** Reviewer A. The non-Ghost companion to `R1`; the orphan-sweep also helps `R12` (dangling refs).
- **Editor's context note:** API-SPEC §6/§3 confirm the headshot PUT touches two GCS objects + Firestore and DELETE cascades to `users` + GCS objects (+ Ghost member per §5.1), with no ordering or compensation stated — accurate.

---

**`R8` — Scale-to-zero cold starts re-read all ~2,000 documents and run brotli on a cold instance — spiking first-load latency for the slow-connection cohort · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §1.5`, `§1.6`; `PRD §3.2`, `§5.5`
- **Finding:** With scale-to-zero, bursty alumni traffic cold-starts often; each cold start reads all ~2,000 docs and the first `GET /profiles` pays a full brotli-11 compression on a possibly CPU-throttled instance. The product bends over backwards for slow links (D73–D76), yet the cold-start path adds seconds precisely there. At 10× this also multiplies per-instance memory (raw dataset + the per-projection buffers of `S1`).
- **Suggested fix:** Engage the cost/latency trade explicitly — consider `min-instances=1` (ends free-tier economics), or **pull the deferred denormalized all-profiles snapshot forward** so cold start is one read, not ~2,000; measure cold-start first-byte on a throttled connection as a Phase-7 release gate.
- **Raised by:** A-4 #9 (`should-fix`).
- **Synthesis:** Reviewer A. Cross-refs `R3` (cold brotli) and `R2` (cold-start hydration). The recommended mitigation is already a recorded deferral — a clean triage candidate.
- **Editor's context note:** The "single denormalized all-profiles snapshot … collapsing cold-start reads from ~2,000 to one" that the finding recommends is **already documented as a deferred optimization in PRD §3.2** (folded in during the Session-6c close-out), with the rationale that the free tier comfortably absorbs the reads today. Triage can simply decide whether to pull it forward.

---

**`R9` — No request/trace correlation across the multi-service save path · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §6.1`
- **Finding:** A single "Save" spans PATCH → verification side-effect → Ghost push → photo PUT/DELETE across Cloud Run + Firestore + Ghost + GCS, but there is no trace/correlation ID tying these together, so reconstructing a partial failure (which step failed, in which user action) is guesswork.
- **Suggested fix:** Propagate a correlation/trace ID (Cloud Run injects `X-Cloud-Trace-Context`) through every log line and external call; adopt Cloud Trace for the save path; include the correlation ID in audit entries.
- **Raised by:** A-4 #10 (`should-fix`).
- **Synthesis:** Reviewer A. The observability companion to `R1`/`R7` (you can't diagnose a partial multi-store failure without it).
- **Editor's context note:** §6.1 specifies actor/target/action audit entries and severity-tagged diagnostics but no correlation/trace ID — accurate.

---

**`R10` — The one failure mode that drives silent data divergence (Ghost-push failure) has no alert · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §6.1`, `§5.1`; `PRD §6.1`
- **Finding:** Only "a burst of sign-in denials" is specified to drive alerting. Ghost-push failures — the root of `R1`/`R5` — are merely logged, and the reconciliation audit that catches them is **manual and admin-triggered**, so drift accumulates silently until an admin runs it. There is also no synthetic canary on the sign-in flow or the Ghost contract.
- **Suggested fix:** Add log-based metrics + alerts on Ghost-push failure rate, push-queue depth/age (`R1`), and cache staleness/listener health (`R2`); add a scheduled synthetic transaction exercising sign-in (and a non-mutating Ghost call) that alerts on failure (→ `R14`).
- **Raised by:** A-4 #11 (`should-fix`).
- **Synthesis:** Reviewer A. The alerting half of `R1`/`R2`/`R14` — those fixes need this to be operationally real.
- **Editor's context note:** §6.1 confirms the only named alert trigger is a "burst of sign-in denials"; Ghost-push success/failure goes to the *diagnostic* stream with no alert — accurate.

---

**`R11` — Bulk import lacks a batch-atomicity / partial-failure story, and its Ghost-push consequence is unaddressed · `should-fix`**
- **Where:** `PRD §5.8.2`; `ENGINEERING-DESIGN §6.5`; `API-SPEC §7`
- **Finding:** The dry-run validates, but Apply writes many rows with no stated transaction boundary — a mid-batch Firestore failure leaves some rows applied and some not. And a bulk import that changes emails/names is a set of pushable changes: pushing per row may hit Ghost Admin-API rate limits at hundreds of rows; not pushing silently diverges Book from Ghost for every changed email (`R1` at scale). Processing the CSV synchronously over HTTP also hits the request timeout (→ `R4`).
- **Suggested fix:** Specify Apply semantics — chunked, idempotent, resumable, with per-row success/failure reporting and a re-runnable failure set; run it as an async worker (upload CSV to GCS → Cloud Task) that respects Ghost rate limits; state whether/how import enqueues Ghost pushes.
- **Raised by:** A-4 #13 (`should-fix`), B-4 #2 (`blocker`).
- **Synthesis:** Both reviewers; B rates it a blocker (timeouts + rate-limits crash the op). Shares the async-job fix with `R4` and the rate-limit/divergence concern with `R1`.
- **Editor's context note:** §6.5 specifies the per-row-non-owner-edit semantics and the dry-run count (D68) but says nothing about batch atomicity, resumability, or whether import enqueues Ghost pushes — accurate; the import↔Ghost-push interaction is genuinely unspecified.

---

**`R12` — Deleting a brother leaves dangling `bigBrotherId` (and `stars`) references · `should-fix`**
- **Where:** `API-SPEC §3 (DELETE)`; `DATABASE-SCHEMA §8`, `§5.2`
- **Finding:** Write-time validation requires `bigBrotherId` to reference an existing profile, but deleting the *referent* doesn't re-validate or clean up the brothers who point at him — the big-brother chip links to a 404 and the derived Little-Brothers scan silently drops the edge. Likewise the delete does not scrub other users' `stars` arrays containing the deleted ID.
- **Suggested fix:** On delete, find and clear/reassign inbound `bigBrotherId` and scrub inbound `stars` in the same operation (or block delete while referenced), or run a referential-integrity sweep; at minimum render a dangling reference gracefully and report it in the audit.
- **Raised by:** A-1 #12 (`should-fix`, stars + bigBrother), A-4 #14 (`should-fix`, bigBrother).
- **Synthesis:** Both lenses of Reviewer A. The orphan-sweep of `R7` would cover this.
- **Editor's context note:** §8 confirms `bigBrotherId` integrity is checked only at *write* time; API-SPEC §3 confirms DELETE cascades to the deleted brother's own `users`/images but not to *inbound* references from other documents — accurate.

---

**`R13` — No idempotency keys on mutating endpoints, so lost-response retries are not clean · `should-fix`**
- **Where:** `API-SPEC §1.4`, `§3`, `§6`
- **Finding:** If a write succeeds server-side but the response is lost (network drop), the client's retry produces a spurious **412** on PATCH (its own prior write moved `updateTime`), a **409** on `POST /profiles`, or an orphaned extra version on headshot `PUT`. The prompt's "safely retryable" property isn't met for the lost-response case.
- **Suggested fix:** Accept an idempotency key on mutating requests and de-duplicate retries server-side (return the original result); for PATCH, detect "the conflicting `updateTime` is my own just-applied write" and treat the retry as success.
- **Raised by:** A-4 #15 (`should-fix`).
- **Synthesis:** Reviewer A. Complements `R1`/`R7` idempotency (safe retry is the precondition for the outbox and the multi-store fixes).
- **Editor's context note:** API-SPEC §1.4 specifies `If-Match`/412 optimistic concurrency but no idempotency-key mechanism; the lost-response self-conflict is a real consequence of `updateTime`-based OCC.

---

**`R14` — Brittleness to Ghost contract change, with nothing to detect it · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §2.1`, `§5.1`; `DECISIONS D20`, `D55`
- **Finding:** The bridge depends on Ghost Pro specifics: `/members/api/session` returning a member JWT, the JWKS endpoint and claim shapes, Portal redirect behavior, `routes.yaml`/Handlebars, the Admin-API create/update/delete shapes, and the account-link override / JS-injection redirect. Ghost Pro auto-updates; any change can cause a silent auth outage — or, in the account-redirect case, **silently revert to "members edit in Ghost"** (two-master, the exact thing D55 removes) with no detection. The whole auth path also assumes the Ghost member-session JWT/JWKS is a *stable* contract Ghost won't change as an implementation detail.
- **Suggested fix:** Pin/version what's pinnable; document the exact Ghost surfaces depended on; add monitoring — a sign-in canary (`R10`) for the read path, and a periodic check that Ghost's account UI is still redirected (detects the injection silently breaking); keep the `IdentityProvider` seam's contract test running against real Ghost on a schedule, not only at build time; confirm/cite the stability of the Ghost member-session JWT + JWKS contract.
- **Raised by:** A-4 #16 (`should-fix`), A-1 #25 (`question`, JWT/JWKS contract stability).
- **Synthesis:** Both lenses of Reviewer A. The "account-redirect silently reverting to two-master" is the sharpest catch — a silent failure that undoes D55's single-master guarantee. Detection ties to `R10`.
- **Editor's context note:** §5.1 confirms the account-redirect is done by overriding the theme target "or, failing that, via Ghost Pro's JS Code Injection" — a fragile hook that an auto-update could break, reverting to Ghost-side editing; §2.1/D20 confirm the JWT/JWKS dependency. D54 accepts the Ghost hard-dependency but does not address change-detection.

---

**`R15` — Eager batch migration: runs over the public internet, hits the 500-op batch limit with no resume, and mutates Firestore while old-code instances are subscribed mid-deploy · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §6.5`; `DECISIONS D26`, `D71`
- **Finding:** A breaking eager migration of ~2,000 docs: if triggered from a laptop/CI over the public internet, a network drop leaves a partially-migrated state, and Firestore caps batch writes at 500 ops (so it must be chunked) with no atomic rollback. Worse, the migration mutates Firestore while an **old-code** instance is still subscribed (D26 allows ≥2 instances during a deploy); the snapshot listener pushes new-shaped documents into that instance's cache mid-deploy, which may mis-parse/serve them.
- **Suggested fix:** Execute migrations only via a Cloud Run Job / Cloud Task inside the Google network with cursor tracking for safe resume; specify deploy-backward-compatible-reads-then-migrate, or drain old instances before migrating.
- **Raised by:** B-4 #6 (`should-fix`), A-1 #26 (`question`, mid-deploy old-code instances).
- **Synthesis:** Both reviewers; B on the execution environment + batch mechanics, A on the rollout-ordering hazard. Same migration, complementary angles.
- **Editor's context note:** §6.5/D71 confirm "eager batch migration" run "after a backup," and D26 explicitly notes Cloud Run "can transiently run two instances during a deploy"; neither addresses the 500-op batch limit, resumability, or the new-shaped-docs-into-old-instance race — accurate gaps.

---

**`R16` — `headshotVersion` is a sequential counter → read-increment-write race · `minor`**
- **Where:** `API-SPEC §6`; `DATABASE-SCHEMA §7`
- **Finding:** `headshotVersion` is shown as a sequential counter ("7"→"8"), implying read-current-then-increment: two concurrent uploads for the same brother both read 7 and write `…/8.webp`, clobbering one.
- **Suggested fix:** Use an opaque, collision-free token (UUID or write timestamp); it serves cache-busting without a read-increment-write race (and is the non-guessable token `P7` wants).
- **Raised by:** A-4 #17 (`minor`).
- **Synthesis:** Reviewer A. Same fix as `P7` (opaque tokens) for a different reason (race vs. enumeration).
- **Editor's context note:** API-SPEC §6 example shows `"7"`/`"8"` (sequential), while DATABASE-SCHEMA §3.1 types `headshotVersion` as an opaque string — settling that inconsistency toward an opaque token resolves both this and `P7`.

---

**`R17` — `stars` PUT/DELETE are called "idempotent," but only if implemented with `arrayUnion`/`arrayRemove` · `minor`**
- **Where:** `API-SPEC §4`
- **Finding:** A naïve read-array-modify-write loses concurrent toggles across tabs/devices, and there is no `If-Match` on the stars list, so the idempotency/safety claim is unverified as specified.
- **Suggested fix:** Specify `arrayUnion`/`arrayRemove` (atomic, genuinely idempotent, concurrency-safe) as the implementation, or add concurrency control to the stars write.
- **Raised by:** A-4 #18 (`minor`).
- **Synthesis:** Reviewer A; pins an implementation detail behind a claimed property.
- **Editor's context note:** API-SPEC §4 asserts the stars endpoints are "Idempotent" but does not specify the mechanism — accurate.

---

**`R18` — CDN signed-cookie expiry mid-session breaks images until re-auth · `minor`**
- **Where:** `ENGINEERING-DESIGN §2.5`; `DATABASE-SCHEMA §7`
- **Finding:** The signed cookie's TTL equals the 4-hour session; when it lapses while the app is open, image requests 403 (broken thumbnails/headshots) until the next silent re-auth reissues it. The SPA's behavior on image-403 is unspecified, so the user may just see broken images.
- **Suggested fix:** Specify SPA handling — on an image 403, trigger silent re-auth and retry the load; consider reissuing the CDN cookie slightly ahead of expiry while the session is active.
- **Raised by:** A-4 #19 (`minor`).
- **Synthesis:** Reviewer A; a UX gap in the media-auth design (D23).
- **Editor's context note:** §2.5 confirms the CDN cookie TTL = the 4-hour session and is "reissued whenever the session is," but the in-session expiry behavior on image reads is unspecified — accurate.

---

**`R19` — Time-dependent `classYear` validation runs on two clocks · `minor`**
- **Where:** `DATABASE-SCHEMA §4`, `§8`; `DECISIONS D50`
- **Finding:** `classYear ≤ currentYear + 6` is enforced by the shared validation module on both client (browser clock) and server (server clock). Around the year boundary / across timezones the two `currentYear`s can disagree, so a value can pass the fast client check and fail the authoritative server check (or vice-versa).
- **Suggested fix:** Compute the boundary from a single authoritative (server) clock and pass it to the client, or widen the client tolerance by one year so the server is the only hard gate.
- **Raised by:** A-4 #20 (`minor`).
- **Synthesis:** Reviewer A; a subtle consequence of the shared-validation-module design (D50).
- **Editor's context note:** §8/D50 confirm `classYear ≤ currentYear + 6` runs in the shared client+server validation module — the two-clock edge is real, if rare.

---

**`R20` — First-ever sign-in does a check-then-create of the `users` doc (race) · `minor`**
- **Where:** `API-SPEC §2`; `ENGINEERING-DESIGN §2.1`
- **Finding:** A first successful match creates the `users` doc; two concurrent requests for a brand-new member can double-create or one can error. Low frequency (first login only), but unspecified.
- **Suggested fix:** Use create-if-absent semantics (a transaction or `create()` treating "already exists" as success) so concurrent first logins converge.
- **Raised by:** A-4 #21 (`minor`).
- **Synthesis:** Reviewer A; standard create-if-absent hardening.
- **Editor's context note:** §2.1/API-SPEC §2 confirm "a first successful match creates the `users` document … if none exists" — a check-then-create as written.

---

**`R21` — Disaster-recovery / continuity posture is unstated (RPO/RTO, single-region, backup-integrity verification) · `minor`**
- **Where:** `ENGINEERING-DESIGN §6.3`; `CODING-PROJECT-PLAN §4`
- **Finding:** Single-region is assumed (Cloud Run is regional); the automated backup is daily, implying a ~24-hour RPO that's never stated; region-failure RTO and ongoing backup-integrity verification (checksums / periodic test-restore beyond the one staging round-trip) are unaddressed — a silently-corrupt daily backup would only be discovered at restore time, under duress.
- **Suggested fix:** State RPO/RTO targets explicitly; add periodic automated restore-verification of a recent backup to staging plus backup checksums; decide whether single-region is acceptable for the targets.
- **Raised by:** A-4 #22 (`minor`).
- **Synthesis:** Reviewer A; the continuity complement to the backup design (D63) and `R5` (restore).
- **Editor's context note:** §6.3 specifies daily backups but no RPO/RTO or backup-integrity verification cadence; the stack is regional. Accurate.

---

## 7. Cross-cutting consistency & documentation findings (`C`)

> These are almost entirely Reviewer A's structural lens. The dominant theme: the **Session-5/6 additions** (`allowCommentReplyEmail`, the staff-internal/system visibility classes, the Ghost coupling) were not fully back-propagated into earlier decisions and PRD/schema sections, and several **MVP mechanics remain "TBD/Session 6" inside docs that declare themselves "delivered."** Reviewer A also recorded, in its restatement, several places where the docs resist confident reconstruction (how an admin produces a MITAA export, how regenerate-all/backup/restore execute) — those map to `C7`, `R4`, and `R5` respectively.

---

**`C1` — Schema §6.1 says preferences live in "cookies," contradicting D30/localStorage, and cites a non-existent section · `should-fix`**
- **Where:** `DATABASE-SCHEMA §6.1` vs `PRD §5.3` + `DECISIONS D30`
- **Finding:** Schema §6.1 says UI preferences "live only in client-side **cookies** (PRD §Cookies)," but D30 (and PRD §5.3) moved them to **localStorage** and "supersedes the original cookie assumption." Direct contradiction, and the cited "PRD §Cookies" section does not exist. (If built as cookies, prefs transmit to the server on every request and into access logs — needless exposure D30 intends to avoid.)
- **Suggested fix:** Update schema §6.1 to localStorage per D30; remove/repoint the dangling "PRD §Cookies" reference.
- **Raised by:** A-1 #3 (`should-fix`), A-3 #15 (`minor`, privacy angle).
- **Synthesis:** Both lenses of Reviewer A. A clean confirmed stale-reference fix.
- **Editor's context note:** Confirmed against the text: D30/PRD §5.3 establish `localStorage`; DATABASE-SCHEMA §6.1 still reads "live only in client-side cookies (PRD §Cookies)," and no "PRD §Cookies" section exists.

---

**`C2` — D45 enumerates "six/two" booleans, but the schema defines seven/three after D56 · `should-fix`**
- **Where:** `DECISIONS D45` vs `PRD §5.7.3` + `DATABASE-SCHEMA §3.1`/`§9`
- **Finding:** D45 enumerates "six boolean fields … the two consent flags (`allowNewsletterEmail`/`allowShareWithMITAA`)," but the PRD/schema define **seven** booleans / **three** consent flags after D56 added `allowCommentReplyEmail`. D45 was never reconciled; a builder trusting it ships the wrong switch set.
- **Suggested fix:** Amend D45 to seven/three, or add an explicit superseded-by-D56 note.
- **Raised by:** A-1 #5 (`should-fix`).
- **Synthesis:** Reviewer A; the canonical example of the Session-5/6 back-propagation drift.
- **Editor's context note:** Confirmed: D45 (Session 4c) lists six booleans / two consent flags; D56 (Session 5) added `allowCommentReplyEmail` as a third consent flag; §3.1/§9 carry seven booleans. D45 was not retro-amended.

---

**`C3` — `allowCommentReplyEmail` is inconsistently in/out of the manager projection across documents · `should-fix`**
- **Where:** `PRD §4.2` vs `§5.6.1`/`§5.7.2`/`§5.6.4` vs `DATABASE-SCHEMA §9`/`§10`
- **Finding:** `allowCommentReplyEmail` is in/out of the manager projection depending on the doc: §4.2 and schema §9 include it (and §10 exports it), but §5.6.1/§5.7.2 reportedly omit it from the manager-visible restricted columns and §5.6.4 omits it from the boolean filters — violating the "filterable ⟺ visible-as-column" rule (D38).
- **Suggested fix:** Decide whether the field is a manager column/filter and make all sections agree.
- **Raised by:** A-1 #4 (`should-fix`).
- **Synthesis:** Reviewer A; another back-propagation-drift instance from the same D56 addition as `C2`.
- **Editor's context note:** DATABASE-SCHEMA §9 and PRD §4.2 *do* include `allowCommentReplyEmail` in the manager-visible restricted set and §10 exports it; the finding reports the Directory/Profile sub-sections (§5.6.1/§5.6.4/§5.7.2) omit it. Triage should confirm against those specific sub-sections, which were not separately re-read during compilation.

---

**`C4` — Multiple MVP mechanics remain "TBD / Session 6" inside docs marked "delivered" · `should-fix`**
- **Where:** `PRD §5.8.1`/`§5.8.3`; `DATABASE-SCHEMA §10`; `ENGINEERING-DESIGN §5.3`; `API-SPEC §7`
- **Finding:** The backup file format, the Ghost-sync discrepancy-report JSON shape, the MITAA column format, CSV escaping/edge-cases, and thumbnail-prefetch tuning are all still "to be finalized later" inside documents that declare themselves delivered/authoritative. MVP features with undefined contracts can't be built or tested to a fixed spec.
- **Suggested fix:** Close these to concrete specs before "delivered" status, or explicitly mark them provisional within scope.
- **Raised by:** A-1 #16 (`should-fix`).
- **Synthesis:** Reviewer A; the umbrella for several specifics — the CSV-escaping facet is also the home of `S9` (formula injection).
- **Editor's context note:** Partially overtaken by later sessions: D63 (Session 6a) **does** specify the backup format (JSON of three collections + image-version manifest) and D68 resolved the import/verification rule — so if PRD §5.8.1 still reads "Session 6 TBD," that is a *stale forward-reference*, not an open mechanic. But the **CSV escaping/edge-cases** (DATABASE-SCHEMA §10 still defers them) and the **sync-report JSON shape** (API-SPEC §7 "finalized with the admin tooling") remain genuinely open. Triage should separate the stale references from the real gaps.

---

**`C5` — Manager-set-deceased forces consent flags off and pushes Ghost unsubscribes — a consent change + outward write by a role barred from both · `should-fix`**
- **Where:** `PRD §4.1` vs `DATABASE-SCHEMA §9` / `ENGINEERING-DESIGN §5.1`
- **Finding:** Managers are barred from changing consent, yet marking deceased (manager-allowed) **forces** `allowNewsletterEmail`/`allowCommentReplyEmail` to false and **pushes unsubscribes to Ghost** — a consent change and an outward write by a role the matrix says can do neither. (Security framing: a rogue/compromised manager can thereby silently cut a living brother's newsletter/comment email and visibility.)
- **Suggested fix:** Acknowledge the exception explicitly in §4, or route the deceased-marking consent side-effect through an admin/automated path; consider whether mark-deceased should be admin-only or require a second factor given its Ghost side-effects.
- **Raised by:** A-1 #13 (`should-fix`, consistency), A-2 #22 (`question`, security — comms-cutoff capability).
- **Synthesis:** Both lenses of Reviewer A. The side-effect is *deliberate* (the deceased lifecycle, D55) but contradicts the stated §4 boundary — a documentation/consistency fix, with a live security question (should managers hold this?) attached.
- **Editor's context note:** PRD §4.1 grants managers "set deceased status" while reserving "change another brother's privacy/consent settings" to admins; D55/§5.1 make the deceased forcing-off + Ghost-push a deterministic consequence. So the contradiction is real and the behavior is intentional — the finding asks that the exception be named (and triage decides whether to gate the capability).

---

**`C6` — Headshot add/change/remove authority is in the API but absent from the capability matrix · `should-fix`**
- **Where:** `API-SPEC §6` vs `PRD §4.1`
- **Finding:** The API lets owner/manager/admin replace/remove **any** brother's photo, but the capability matrix has no headshot row, so the authority is untraceable and reviewers can't confirm intent (should a manager change another brother's photo?).
- **Suggested fix:** Add headshot add/change/remove to the capability matrix with explicit roles.
- **Raised by:** A-1 #14 (`should-fix`).
- **Synthesis:** Reviewer A; a traceability gap (the matrix should be the single source for who-can-do-what).
- **Editor's context note:** Confirmed: PRD §4.1's matrix has no headshot row; API-SPEC §6 lists `PUT/DELETE …/headshot` as owner/manager/admin.

---

**`C7` — The MITAA-export mechanism is genuinely undefined for its consent-aware field rules · `should-fix`**
- **Where:** `PRD §4.1`/`§5.8` ("Export data for MITAA"); `ENGINEERING-DESIGN §5.3`
- **Finding:** The MITAA-export capability is listed but Book exposes no dedicated MITAA control/endpoint; it's conflated with the general admin CSV export + an "external script." Yet the requirement — name/class/deceased for **all** brothers, contact only for **consenting** ones, emergency **never** — cannot be produced by a single consent-filtered CSV export, so the mechanism is genuinely undefined.
- **Suggested fix:** Build a dedicated consent-aware MITAA export, or specify exactly how the admin assembles a compliant file from existing tools.
- **Raised by:** A-1 #11 (`should-fix`).
- **Synthesis:** Reviewer A. The mechanism facet of the MITAA cluster (`P4`/`P5` are its consent facets). One of the reviewer's named reconstruction gaps.
- **Editor's context note:** D59/§5.3 deliberately make MITAA export a *manual admin operation* reusing the role-projected CSV (admin see-through projection) plus an external mapping script — not a Book feature (consistent with the deferred "automated MITAA exchange," PRD §3.2). Whether that manual path can actually produce the mixed per-field consent selection the finding describes (identity for all, contact for consenting) is unspecified — a real mechanism question, distinct from the consent-default questions in `P4`/`P5`.

---

**`C8` — `verifiedBy` is manager-visible on screen but excluded from the CSV export · `should-fix`**
- **Where:** `PRD §5.6.1`/`§5.7.6` vs `DATABASE-SCHEMA §10`
- **Finding:** Managers can add a "verified by" column on screen, but it is excluded from the CSV export — an inconsistent screen-vs-export projection (the export shows the verification *date* but not *who* verified).
- **Suggested fix:** Include `verifiedBy` as a read-only column in manager/admin export, or justify the asymmetry.
- **Raised by:** A-1 #23 (`should-fix`).
- **Synthesis:** Reviewer A; a small projection-consistency gap.
- **Editor's context note:** Confirmed: §9/D19 make `verifiedBy` manager-visible (restricted), but §10's "Not exported" list includes `verifiedBy` while `lastVerifiedDate` is export-only — so the date is exported and the verifier is not.

---

**`C9` — No API versioning / compatibility story (the cross-language Linter and stale background SPAs break silently) · `should-fix`**
- **Where:** `API-SPEC` (no version namespace); `ENGINEERING-DESIGN §5.2`/`§6.5`
- **Finding:** There is no API versioning or deprecation policy. The SPA+API deploy together (mitigating one case), but the **Linter** is an independently-deployed, different-language consumer of `/api/roster`; any shape change breaks it silently. And a user with a stale SPA open in a background tab can send malformed data or crash after a migration, with no mechanism to force a refresh. The docs address bundle/API skew and DB migration but not API-*contract* evolution.
- **Suggested fix:** Add a version prefix or contract-version header and a deprecation policy, at least for `/api/roster`; add a client-version check that prompts a stale SPA to refresh (or fails gracefully with a "new version available" overlay).
- **Raised by:** A-1 #9 (`should-fix`), B-1 #4 (`should-fix`).
- **Synthesis:** Both reviewers; A on the Linter contract, B on the stale-SPA tab. Same missing capability (contract versioning).
- **Editor's context note:** No version namespace appears in API-SPEC; D73's content-hashed-immutable-assets + no-cache HTML make a *fresh* load always current, but do not force an *already-open* stale tab to update — so B's case stands. D58 deliberately makes the Linter runtime-independent but assumes a stable roster contract with no stated deprecation policy.

---

**`C10` — PRD §3.1 names singular `/profile` and `/headshot`; the real surface is broader · `minor`**
- **Where:** `PRD §3.1` vs `API-SPEC`
- **Finding:** The scope statement names singular `/profile`/`/headshot`; the real surface is `/api/profiles` (plural) plus `/me`, `/me/stars`, `/users/{id}/role`, `/auth/session`, `/roster`, `/admin/*`. The PRD line is both inaccurate and materially incomplete.
- **Suggested fix:** Align PRD §3.1 wording with API-SPEC.
- **Raised by:** A-1 #21 (`minor`).
- **Synthesis:** Reviewer A; a scope-statement accuracy nit.
- **Editor's context note:** API-SPEC §1.1/§3–§8 confirm the real surface; the PRD §3.1 phrasing is a high-level scope line, plausibly written before the API was specified.

---

**`C11` — The roster example sets optional name fields to `null`, contradicting the optional-vs-nullable convention · `minor`**
- **Where:** `API-SPEC §8` example vs `DATABASE-SCHEMA §2` convention
- **Finding:** The roster example sets `middleName`/`fullLegalName`/`mugName` to `null`, but those are `?`-optional (= absent), not nullable, contradicting the doc's optional-vs-nullable convention and risking mis-parsing by the cross-language Linter.
- **Suggested fix:** Omit absent optionals (or type them nullable deliberately) and fix the example.
- **Raised by:** A-1 #22 (`minor`).
- **Synthesis:** Reviewer A; a contract-accuracy nit with a real downstream consumer (the Linter, `C9`).
- **Editor's context note:** Confirmed: DATABASE-SCHEMA §2 states `?` = may be absent vs `| null` = present-but-unknown; API-SPEC §8's roster example uses `"middleName": null`, etc.

---

**`C12` — Add-Brother is its own admin-only page/route but isn't counted among the "four pages" or documented · `minor`**
- **Where:** `PRD §5` ("four pages") vs `§5.4`/`DECISIONS D31` (`/brother/new`) + `USER-MANUAL`
- **Finding:** Add Brother is its own admin-only route with a required, uniqueness-checked Constitution-ID entry, but it is neither counted among the "four pages" nor documented anywhere in the manual.
- **Suggested fix:** Treat Add-Brother as a page/mode explicitly and document its flow.
- **Raised by:** A-1 #19 (`minor`).
- **Synthesis:** Reviewer A; a completeness nit.
- **Editor's context note:** Confirmed: PRD §5 says "four pages — Directory, Profile, Admin, and the deferred Report page," while D31 defines `/brother/new` (admin-only) as a distinct route.

---

**`C13` — "Toggle Privileges" labels a 3-way role selector, implying on/off · `minor`**
- **Where:** `PRD §5.7.10`/`§4.1` + `DECISIONS D51`
- **Finding:** D51 replaced a role-cycling toggle with an explicit 3-way role **selector** but kept the label "Toggle Privileges"; "toggle" implies on/off and misleads for a 3-state control.
- **Suggested fix:** Rename the control (e.g., "Change role").
- **Raised by:** A-1 #20 (`minor`).
- **Synthesis:** Reviewer A; a naming nit.
- **Editor's context note:** Confirmed: D51/§5.7.10 describe an explicit Brother/Manager/Administrator selector still labeled "Toggle Privileges."

---

**`C14` — Un-marking deceased doesn't restore prior consent/verification (silent consent-data loss on reverse) · `minor`**
- **Where:** `PRD §5.7.7` (deceased "reversible") + `DATABASE-SCHEMA §8` + `DECISIONS D28`/`D48`
- **Finding:** Marking deceased overwrites both email-consent flags to false and freezes verification, but nothing restores the prior consent values or verification state if the (reversible) deceased flag is turned off again — silent consent-data loss on reverse.
- **Suggested fix:** Define un-decease behavior (restore prior prefs / re-enable verification) or warn that those fields are one-way.
- **Raised by:** A-1 #18 (`minor`).
- **Synthesis:** Reviewer A; an edge of the deceased lifecycle (D48/D49).
- **Editor's context note:** Confirmed: D49 makes deceased reversible; D48/D28 force consent off and freeze verification on marking deceased; no decision specifies the reverse transition.

---

**`C15` — No-email brothers cannot self-serve and are staff-maintained only — never stated as a known limitation · `question`**
- **Where:** `ENGINEERING-DESIGN §2.1` (deny unknown email) + `PRD §1` (audience back to the 90s; stale/AOL addresses; ~70 unidentified)
- **Finding:** The design assumes every Book user has a working email for magic-link sign-in; the oldest cohort and unidentified addresses can never self-serve (records are manager-maintained only). A reasonable implication, but never stated as a known limitation.
- **Suggested fix:** State explicitly that no-email brothers are staff-maintained and cannot access Book themselves.
- **Raised by:** A-1 #28 (`question`).
- **Synthesis:** Reviewer A; an implicit-assumption-made-explicit ask.
- **Editor's context note:** D20's deny-and-contact-admin handles the ~70 historical unidentified Ghost addresses by funneling them to an admin; the corollary — those brothers can't self-serve — is correct and currently unstated.

---

## 8. UI & accessibility findings (`U`)

> Mostly Reviewer B's structural lens, plus two from Reviewer A. Accessibility is a stated first-class policy for this project (D32/D67), so these warrant weight beyond their reviewer-assigned severities.

---

**`U1` — Accessibility targets WCAG 2.1 AA, not the current 2.2 AA · `should-fix`**
- **Where:** `PRD §5.5` + `DECISIONS D32`/`D67` + `ENGINEERING-DESIGN §6.6`
- **Finding:** Accessibility targets **WCAG 2.1 AA**, but **2.2 AA** (Oct 2023) is current and adds directly-relevant criteria: 3.3.8 Accessible Authentication (the magic-link flow), 2.4.11 Focus Not Obscured, 2.5.8 Target Size, 3.3.7 Redundant Entry. To its credit it is a concrete, testable standard (axe-core + contrast gate + manual checklist), not a bare assertion — but it's the superseded version for a 2026 accessibility-first launch.
- **Suggested fix:** Target WCAG 2.2 AA; fold the new success criteria into the D67 three-layer checklist.
- **Raised by:** A-1 #8 (`should-fix`).
- **Synthesis:** Reviewer A. Low-cost given the verification machinery (D67) already exists; the new SCs are squarely relevant to this audience.
- **Editor's context note:** D32/D67 deliberately adopt 2.1 AA as policy; 2.2 AA was published Oct 2023 and is a superset. The choice predates no obstacle — it appears simply to not have been revisited against 2.2.

---

**`U2` — In-page help is wired in Phase 6, but a11y-gated pages ship in Phases 3–5 (hidden inter-phase dependency) · `should-fix`**
- **Where:** `CODING-PROJECT-PLAN §7`/`§10` + `PRD §5.9` + `DECISIONS D67`
- **Finding:** In-page help (`aria-describedby` helper text + announced toggle-tips) is an AA-baseline feature, load-bearing for the Directory/Profile/Admin pages, yet all help wiring is reportedly **Phase 6** while those pages ship in Phases 3–5 under a per-phase a11y gate. Either those gates can't fully pass or help is really built earlier — a hidden inter-phase dependency.
- **Suggested fix:** Build each page's help content with the page, or explicitly scope the early a11y gates to exclude help until Phase 6.
- **Raised by:** A-1 #10 (`should-fix`).
- **Synthesis:** Reviewer A; a buildability/sequencing flag.
- **Editor's context note:** D53 makes in-context help a cross-cutting AA-baseline standard whose source is shared with the user manual; the phase assignment is in CODING-PROJECT-PLAN (not separately re-read during compilation), so triage should confirm the Phase-6-vs-3–5 sequencing the finding asserts.

---

**`U3` — A 401 during an in-progress save (after the 4-hour cap) would discard unsaved form data; the recovery path is unspecified · `should-fix`**
- **Where:** `ENGINEERING-DESIGN §2.3` (re-bounce on lapse) + `§2.6` (412 reconcile) + `API-SPEC §1.2`
- **Finding:** The docs don't explain how the SPA recovers from a 401 during an async state-changing action (clicking Save just after the 4-hour cookie expires). Lapsed sessions "re-bounce through the bridge," but a hard `window.location` redirect during an XHR would destroy the user's unsaved form data — a critical gap for an app emphasizing long, abandonable edit sessions.
- **Suggested fix:** Specify the 401-mid-edit path: detect the 401, preserve the in-progress form, silently re-auth through the bridge, and resume/re-submit the save (or surface a non-destructive "your session expired — sign in to save" state).
- **Raised by:** B-1 (restatement / documentation-gap section — unnumbered, flagged "critical").
- **Synthesis:** Reviewer B's headline reconstruction gap. Distinct from the **412** reconcile (which *does* preserve edits, D25) — this is the **401** (expired-session) path, which is unspecified. Related to `U4` (no logout) and `P11` (shared-machine residue).
- **Editor's context note:** D25/§2.6 carefully preserve unsaved edits on a *412* (concurrency conflict); D22/§2.3 handle session lapse by "re-bounce through the bridge" (a redirect). The finding correctly observes that the *401-during-save* case sits between these two and is unspecified — a redirect mid-save would lose the form.

---

**`U4` — There is no logout control · `should-fix`**
- **Where:** `API-SPEC §2` ("no logout endpoint") + `DECISIONS D22` + `USER-MANUAL §2`
- **Finding:** The manual justifies the 4-hour cap as protecting shared/public computers, but a brother who walks away without closing the browser leaves the account open up to 4 hours with no way to sign out — for an audience that explicitly includes older users on shared/family machines.
- **Suggested fix:** Add a logout control (clear cookies + invalidate the server-side session); it is cheap and expected.
- **Raised by:** A-1 #15 (`should-fix`).
- **Synthesis:** Reviewer A. Directly reconsiders a deliberate decision (D22/D24); pairs with `P11` (shared-machine cache residue — logout could also clear it).
- **Editor's context note:** D22/D24 deliberately omit logout ("unnecessary given browser-close + the 4-hour cap"). The finding reopens that for the shared-machine walk-away case the manual itself anticipates — a decision to re-weigh, not an oversight.

---

**`U5` — Phonetic + Fuse index computed synchronously on the main thread at load will jank the UI on older hardware · `should-fix`**
- **Where:** `PRD §5.6.3` + `CODING-PROJECT-PLAN`; `DECISIONS D35`
- **Finding:** Computing Double Metaphone (or Beider-Morse) codes for ~2,000 profiles × multiple name fields, plus building the Fuse.js index, synchronously on the browser's main thread during SPA init will cause severe UI jank — especially for the stated target demographic on older hardware/slow connections.
- **Suggested fix:** Move the Fuse.js indexing and talisman phonetic-code generation into a **Web Worker**, so the UI stays responsive and the grid renders while the index builds in the background.
- **Raised by:** B-1 #3 (`should-fix`).
- **Synthesis:** Reviewer B; a sharp catch that pairs directly with the slow-connection/older-hardware constraint (D73–D76) the design otherwise optimizes for.
- **Editor's context note:** D35 computes phonetic codes at load (not stored), with an IndexedDB memo as the only noted escape hatch; D74 code-splits the talisman libraries (deferring their *download*) but neither addresses moving the *computation* off the main thread — so the jank concern is consistent with the design as written.

---

**`U6` — The virtualized list breaks native row indexing for screen readers (missing ARIA) · `minor`**
- **Where:** `ENGINEERING-DESIGN §6.6` + `DECISIONS D29`
- **Finding:** Virtualized lists (TanStack Virtual) remove DOM nodes, breaking native screen-reader indexing (announcing "row 1 of 50" instead of of the true ~2,000). The manual a11y checklist doesn't explicitly verify virtualized ARIA attributes.
- **Suggested fix:** Add explicit requirements to implement and test `aria-rowcount`, `aria-rowindex`, and `aria-setsize` on the TanStack Virtual grid so assistive tech reports the full dataset size.
- **Raised by:** B-1 #8 (`minor`).
- **Synthesis:** Reviewer B; concretizes a known virtualization-a11y pitfall against the project's AA policy.
- **Editor's context note:** D29 confirms TanStack Virtual for the grid; §6.6's manual checklist covers the virtualized list's *keyboard* access but does not enumerate these row-index ARIA attributes — the finding adds the missing specificity.

---

**`U7` — Seven verbose two-consequence toggles at rest create clutter/scrolling fatigue on mobile · `should-fix`**
- **Where:** `PRD §5.7.3` + `DECISIONS D45`/`D53`
- **Finding:** The privacy switches state *both* consequences of a toggle in plain text (e.g. "Brothers can reach you by email" ↔ "… cannot …"). Rendering seven distinct verbose toggles on a mobile viewport works against the design's stated "calm resting interface" goal, creating scrolling fatigue and cognitive overload for elderly users.
- **Suggested fix:** Simplify the resting state with concise standard labels (e.g. "Share email") and move the verbose "both consequences" explanation into the already-designed toggle-tip `?` popover.
- **Raised by:** B-1 #7 (`should-fix`).
- **Synthesis:** Reviewer B. **A direct tension with a deliberate decision:** D45 chose to state both consequences in plain text as an ethical-nudge / anti-dark-pattern measure — so this is a presentation trade-off (clarity-of-consequence vs. calm-resting-UI), not a defect. Triage weighs the two stated goals.
- **Editor's context note:** D45 deliberately states both sides "in plain language" so an opt-out is "an informed, considered act rather than an inattentive click," and D53 provides exactly the toggle-tip popover pattern the finding proposes to house the verbose copy. So the fix is *compatible* with the design's components; what triage must decide is whether moving the consequence-copy into a popover weakens D45's informed-consent intent.

---

## 9. Strengths both reviewers credited — preserve, don't "fix"

A clean-context adversarial review can find a deliberate, sound decision "wrong" because it lacks the constraint that justified it. Both reviewers volunteered these as genuinely good, and several findings explicitly build *on top of* them. Triage should weight them so a fix doesn't dismantle a strength:

- **Server-side field projection as the single enforcement point** (D5/D16/D19) — treated by both reviewers as the correct security/privacy floor; `S1`/`S3`/`S6` are about gaps *around* it, not the model.
- **The read-only Ghost reconciliation audit that never writes Book** (D55) — both noted this correctly removes the failed-push-undo hazard; any `R1`/`R5` fix must preserve this invariant.
- **Names-not-values audit-logging discipline** (D61) — praised by both; `P10` asks to *extend* it, not replace it.
- **Auth token carried in the URL fragment** (D20) — keeps it out of logs/history/Referer; `P9` asks to apply the same instinct to ongoing view-state.
- **Dedicated server-set `verify` action + server-enforced big-brother cycle check** (D28, §8).
- **Optimistic concurrency on server-authoritative `updateTime` with a non-destructive reconcile** (D25) — no silent clobber.
- **Secrets in Secret Manager off the client; keyless service-account path for the Linter** (D27/§2.7, D58).
- **`localStorage` (not cookies) for client-only prefs** (D30); **`private, no-cache` on the bulk payload** so shared/edge caches never hold a per-role copy (D76).
- **Three-collection split** keeping private `role`/`stars` out of the bulk download (D12); **well-minimized Book→Ghost push** (email/name/two prefs only); **`adminNote` barred from MITAA files** by an explicit allowlist (§10).
- **Write-through Firestore so memory is never authoritative** (D7); **GCS object versioning** as a recovery floor (D8).
- **A concrete, testable accessibility standard** — axe-core + CI contrast gate + manual checklist (D67) — rather than a bare assertion (even as `U1` asks to move 2.1 → 2.2).
- **A deterministic, committed fake-data generator with an exhaustive per-role projection test mandate** (D65/§6.6).

---

## 10. Notable reviewer divergences & decision-tensions for triage

**Where the reviewers disagreed:**

- **Factual (must be resolved):** the Linter roster's Cloud Run IAM "front door" (`S17`). Reviewer B argues it is architecturally impossible (per-service IAM can't coexist with the public SPA/auth endpoints on one service); Reviewer A treats both the front-door and in-code options as viable and focuses on subject-pinning. One of them is wrong about the platform; triage should settle it (B's per-service-IAM claim is the load-bearing one), then apply A's subject-pinning to whatever survives.
- **Severity philosophy:** the two models drew the blocker line differently. **Reviewer B** escalated concrete infrastructure/security mechanics to blocker — brotli-11 (`R3`), the snapshot listener (`R2`), email-uniqueness/takeover (`S2`), mass-assignment (`S3`), `adminNote` DSAR (`P8`). **Reviewer A** reserved blockers for consent and auth-integrity (the MITAA default `P4`, the email-change lockout `R1`, the memoized-payload leak `S1`, the privacy-machinery cluster `P1`/`P2`/`P3`) and rated the same infra items should-fix/question. This composite takes the **max** severity; triage should set the real priority, not inherit either model's instinct wholesale.
- **Coverage (each caught what the other missed):** Reviewer A *alone* caught the memoized-payload projection leak (`S1`) — arguably the most serious security finding in the review — plus the whole back-propagation-drift cluster (`C1`–`C3`) and most concurrency minors. Reviewer B *alone* caught the main-thread phonetic jank (`U5`), virtualized-list ARIA (`U6`), toggle-verbosity clutter (`U7`), and the 401-mid-edit data-loss path (`U3`). Neither review alone would have been sufficient — the two-model design paid off.

**Findings that challenge a *deliberate* decision** (likely triage outcomes: (b) as-designed with a documented reason, or (a) fix that records a new `D##`). Flagged here so triage doesn't mistake an intentional choice for an oversight — each finding's Editor's context note has the specifics:

- `S5` — Ghost as a single point of total compromise vs. the accepted hard-dependency (D54).
- `S12` — adding a server touchpoint for export auditing vs. the deliberately client-side export (D41).
- `P5` — honoring MITAA opt-out for identity vs. the deliberate always-flow of identity/death (D59).
- `P8`/`P17` — `adminNote` hidden from its subject (D56) and the coarse no-opt-out photo grant (D23).
- `P11`/`U4` — the HTTP-cache residue and the absent logout, both flowing from deliberate choices (D76/D73; D22).
- `U7` — simplifying the privacy-toggle copy vs. D45's deliberate state-both-consequences nudge.
- `R3`/`S1` interaction — per-caller buffer keying would invalidate D75's whole brotli-11 economic rationale; these must be triaged together.

---

## 11. Traceability matrix (all 125 raw findings → composite IDs)

Every raw finding maps to exactly one composite finding (a few map to two where they were split or where the same raw item carries two distinct facets). This is the completeness guarantee — nothing was dropped in consolidation. Read it as `raw# → composite`.

**DR-A-1 — Structural (29):** 1→P4 · 2→R1 · 3→C1 · 4→C3 · 5→C2 · 6→R4 · 7→R4 · 8→U1 · 9→C9 · 10→U2 · 11→C7 · 12→R12 · 13→C5 · 14→C6 · 15→U4 · 16→C4 · 17→R5 · 18→C14 · 19→C12 · 20→C13 · 21→C10 · 22→C11 · 23→C8 · 24→P15 · 25→R14 · 26→R15 · 27→R3 · 28→C15 · 29→R5

**DR-A-2 — Security (23):** 1→S1 · 2→S6 · 3→S7 · 4→S5 · 5→S8 · 6→S2 · 7→S3 · 8→S18 · 9→S9 · 10→S10 · 11→S11 · 12→S12 · 13→P1 · 14→S14 · 15→S13 · 16→S15 · 17→S16 · 18→S17 · 19→S5 · 20→P7 · 21→S19 · 22→C5 · 23→S4

**DR-A-3 — Privacy (20):** 1→P1 · 2→P2 · 3→P3 · 4→P13 · 5→P14 · 6→P4 · 7→P5 · 8→P7 · 9→P10 · 10→P11 · 11→P8 · 12→P9 · 13→P12 · 14→P6 · 15→C1 · 16→P15 · 17→P16 · 18→P17 · 19→P18 · 20→P19

**DR-A-4 — Operations (24):** 1→R1 · 2→S1 (+S6) · 3→R2 · 4→R1 · 5→R6 · 6→R7 · 7→R5 · 8→R4 · 9→R8 · 10→R9 · 11→R10 · 12→S2 · 13→R11 · 14→R12 · 15→R13 · 16→R14 · 17→R16 · 18→R17 · 19→R18 · 20→R19 · 21→R20 · 22→R21 · 23→S10 · 24→R1

**DR-B-1 — Structural (8 + restatement):** restatement gap→U3 · 1→R2 · 2→R3 · 3→U5 · 4→C9 · 5→R1 · 6→R4 · 7→U7 · 8→U6

**DR-B-2 — Security (8):** 1→S2 · 2→S5 · 3→S3 · 4→S4 · 5→S17 · 6→R3 · 7→S9 · 8→P10

**DR-B-3 — Privacy (7):** 1→P1 · 2→P5 (+P4) · 3→P8 · 4→P3 · 5→P9 · 6→P7 · 7→P2

**DR-B-4 — Operations (6):** 1→R1 · 2→R11 · 3→R5 · 4→R2 · 5→R6 · 6→R15

**Consolidation hotspots (one composite ← many raw):** `R1` ← 6 raw (A-1 #2, A-4 #1/#4/#24, B-1 #5, B-4 #1) · `P7` ← 3 (A-3 #8, A-2 #20, B-3 #6) · `R2` ← 3 (A-4 #3, B-1 #1, B-4 #4) · `R3` ← 3 (B-1 #2, B-2 #6, A-1 #27) · `R4` ← 4 (A-1 #6/#7, A-4 #8, B-1 #6) · `R5` ← 4 (A-1 #17/#29, A-4 #7, B-4 #3) · `S5` ← 3 (A-2 #4/#19, B-2 #2) · `P4` ← 3 (A-1 #1, A-3 #6, B-3 #2) · `P1` ← 3 (A-3 #1, A-2 #13, B-3 #1).

---

## 12. Triage worksheet

The recording surface for the triage session: one row per composite finding. Fill **Disposition** (a/b/c/d, §1) and **Action / new `D##`** as each is triaged; the finding detail lives in §4–§8 under the same ID.

**Severity tally (composite):** **13 blocker** · **49 should-fix** · **16 minor** · **3 question** = **81 total.**

| Domain | blocker | should-fix | minor | question | total |
|---|:--:|:--:|:--:|:--:|:--:|
| Security (`S`) | 5 | 13 | 1 | 0 | 19 |
| Privacy (`P`) | 5 | 9 | 3 | 2 | 19 |
| Operations (`R`) | 3 | 12 | 6 | 0 | 21 |
| Cross-cutting (`C`) | 0 | 9 | 5 | 1 | 15 |
| UI / a11y (`U`) | 0 | 6 | 1 | 0 | 7 |
| **Total** | **13** | **49** | **16** | **3** | **81** |

### Security
| ID | Sev | Finding | Disposition | Action / new `D##` |
|---|---|---|---|---|
| S1 | blocker | Memoized payload defeats per-caller projection | (a) | Split the read: a uniform per-role projection of all records **+** the caller's own full record via a separate self-fetch (`/api/me`); cache only the brother buffer, managers/admins fresh per request; add a cross-caller isolation test. **D82.** |
| S2 | blocker | Email join key has no uniqueness/normalization | (a) | Uniqueness + normalization enforced in the single instance's **in-memory email index** (derived from profiles; synchronous check-and-claim — atomic on one writer per D83); **no reservation collection**. Emails stored normalized-only (lowercase/trim/NFC); primary + `alternateEmail` share one namespace; **fail-closed** on ambiguity (backstop for genesis/migration dups). **D97.** |
| S3 | blocker | No positive write-field allowlist (mass assignment) | (a) | Positive **per-role writable-field allowlist** — reject (422/403), never silently ignore, any out-of-scope field; **all** system/verification/Ghost fields unwritable via PATCH/POST (set only by the server-set `verify` (D28), the role toggle (D51), and the D96 `ghostMemberId` capture); consent/privacy fields owner-only (managers can't write them). The write matrix is enumerated **alongside the read-projection matrix** (C6's home) — it is its write-side dual, not a new enforcement point. **D106.** |
| S4 | blocker | Object-level authz unstated (IDOR / verify / stars≠role) | (a) | Mandate the server-side predicate `profileId == session.profileId OR role ∈ {manager,admin}` before any PATCH/PUT; owner-vs-other on `verify` (a plain brother stamps no one else); stars writes scoped to the `stars` field only (not coercible into a `role` write). The object-level axis of S3's endpoint, decided together. Folded into **D106.** |
| S5 | blocker | Ghost token not Book-scoped; total-compromise SPOF; no step-up | (a)+(b) | **Close** the replay/forced-login vectors (S7 alg-pin + S8 nonce/redirect-allowlist + the D22 4h cap), with `pbe400.org` origin-hardening named as an explicit threat-model dependency; **accept** the Ghost blast-radius dependency (D54 — Ghost *is* the auth, irreducible) with a documented threat model that also absorbs D101's offline-restore residual. **No step-up authentication:** after Session 4 the only online destructive surface is role grants + single delete (both typed-ack-confirmed and audited via S18/D101); at 1–2 admins, and because every Book factor traces back to the same Ghost identity (so an in-Book step-up authenticates nothing — only out-of-band would), the cost isn't justified. **D105.** |
| S6 | should-fix | Bulk ETag ignores role → stale authz on demotion | (a) | Key the bulk ETag by role + a role-version / `users` updateTime so a demotion invalidates the cached payload immediately; falls out of D82. Amends **D76** (no new #). |
| S7 | should-fix | JWT algorithm not pinned | (a) | Pin Ghost's asymmetric `alg`/`kid` from JWKS; reject `alg:none` and any symmetric alg (forecloses the HS256-with-RSA-public-key forge); unit-test forged-`alg` cases (§6.6). **D104.** |
| S8 | should-fix | No state/nonce on callback (login CSRF); redirect integrity | (a) | Single-use Book-generated `state`/nonce verified server-side at the callback (forecloses forced-login), layered *with* D20's fragment-carried token, not replacing it; hardcode/allowlist every redirect target (Portal `return`, callback) so neither is attacker-parameterizable. Folded into **D104.** |
| S9 | should-fix | CSV / formula injection in exports (incl. MITAA) | (a) | Neutralize leading `= + - @` on every text cell in both the Directory export and the MITAA mapping (prefix `'` / OWASP); add a malicious-leading-char test. Closes the C4 CSV-escaping facet. |
| S10 | should-fix | No rate-limiting / abuse controls | (a) | Rate limits / concurrency caps on auth, writes, bulk read; single-flight unknown-`kid` JWKS (w/ D87); debounce compression (w/ D84). Brotli-amplifier facet already neutralized by D84, JWKS facet by D87. **D86.** |
| S11 | should-fix | Image-pipeline decode-bomb / transcoder RCE | (a) | Cap **decoded** W×H + total pixels before/at decode — **reject > ~40 MP** (far above any real headshot, so a legitimate large upload is never forced through an external editor — good UX); decoder memory/time limits; magic-byte check (not just `Content-Type`); pinned, patched, least-privileged imaging lib. **D107.** |
| S12 | should-fix | Bulk PII export unauditable | (a) | Client still generates the CSV (D41 preserved) but notifies a thin backend endpoint that writes one audit entry (actor, scope, row-count, timestamp); add "export" to the §6.1 audit list. **D92.** |
| S13 | should-fix | Restore sets roles outside audit; backup unguarded | (a) | **Roles restored verbatim — no gating** (in-Book gating is theater vs. an actor who already holds/can-mint admin, and breaks "be exactly this snapshot"; residual tampered-backup→escalation → backup-bucket security + the S5 threat model). **Forensic privileged-roster log** on restore (resulting roster always; delta when prior state readable). **Signed manifest skipped.** Backup bucket **ACL-restricted + encrypted-at-rest**, retention 3mo (D94/P16). Folded into **D101.** |
| S14 | should-fix | No CSP / security headers beyond HSTS | (a) | Strict CSP (`script`/`style`/`connect`/`img`/`frame-ancestors`), no `unsafe-inline`, **explicitly allowlisting D62's Mixpanel script/connect origin** + the Ghost/CDN image origins (so a strict policy doesn't silently kill analytics); `X-Content-Type-Options: nosniff`; a framing policy. Lands **P9's `Referrer-Policy`** (`strict-origin-when-cross-origin`). Documented with HSTS in §6.4; amends D64. Folded into **D107.** |
| S15 | should-fix | Stored XSS via URL scheme if not allowlisted | (a) | Strict `http`/`https` scheme allowlist on write for `links[].url`/`obituaryUrl`/`inMemoriamUrl` (reject `javascript:`/`data:`/all others); `rel="noopener noreferrer"` on render; S14's CSP is the defense-in-depth backstop. Folded into **D107.** |
| S16 | should-fix | DevIdentityProvider single-gate bypass | (a) | **All four layers:** compile the `DevIdentityProvider` out of the production bundle entirely (load-bearing — "can't be loaded" beats "is disabled") + retain D72's runtime env gate + a CI assertion the prod artifact can't instantiate it + a startup alert if ever loaded under prod config. Total blast radius, near-free layers; aligns with D102's ephemeral staging (the provider's only legitimate home). **D108.** |
| S17 | should-fix | Linter roster auth: pin SA subject; front-door feasibility | (a) | B correct: IAM front door infeasible (per-service IAM vs public `/auth/session`). Drop it; in-code Google-JWKS check pinning issuer+audience+subject. **D78.** |
| S18 | should-fix | Last-admin safeguard not enforced server-side | (a) | Enforce the last-admin invariant **server-side** in `PUT /api/users/{id}/role` (reject demoting the only admin), independent of the UI (D51 described it UI-only); before/after audit on every role change (feeds D101's forensic privileged-roster log). Folded into **D106.** |
| S19 | minor | CORS deny-by-default + host-only session cookie | (a) | Deny-by-default CORS on `/api/*` (no credentialed origin reflection, esp. for `pbe400.org`); session cookie **host-only** on `book.pbe400.org` (no `Domain=.pbe400.org`, or a sibling subdomain could read it), extending D23's CDN-cookie discipline to the session cookie. Folded into **D107.** |

### Privacy
| ID | Sev | Finding | Disposition | Action / new `D##` |
|---|---|---|---|---|
| P1 | blocker | Mixpanel undisclosed PII + `ignore_dnt` | (a) | Disclosure already closed by D77. Drop `name`; keep email `distinct_id`, Constitution ID + role as properties, and `ignore_dnt: true` (DNT is a global signal, a poor proxy for site-specific intent — cf. the MITAA "do not email" misreading). **D88.** |
| P2 | blocker | No CCPA / data-subject machinery or notice-at-collection | (b)/(d) | Closed by D77: PBE not a business → no DSAR/deletion/retention machinery. Notice-at-collection satisfied by the public notice (`pbe400.org/privacy/`); the Book→notice login-link stays on the build checklist so notice precedes first-sign-in provisioning. |
| P3 | blocker | Cannot fully delete; Restore resurrects (no tombstone) | (b) | Per D77: Book has no privacy-driven deletion → no tombstone (deletion is admin error-correction only, so no "deleted person" to resurrect); restore→Ghost divergence handled by the read-only reconciliation audit (R5, Session 4). No Mixpanel-delete call (error-records generate no events). |
| P4 | blocker | MITAA external-sharing defaults opt-in; not seeded | (a) | Default `allowShareWithMITAA` **false** (affirmative opt-in for external sharing), decoupled from the peer share-toggles. **D89.** |
| P5 | blocker | MITAA forces identity/death on opt-out; misleading copy; no use-agreement | (b)+(a) | Always-flow of identity/public-death **ratified** (CCPA moot under D77). Toggle copy corrected (on/off speak only to "contact information," which is accurate); always-flow disclosed in the notice + `USER-MANUAL §8`, not on the switch. Use-limitation with MITAA stays informal. **D89.** |
| P6 | should-fix | Mixpanel event properties may carry PII / leak stars graph | (a) | Spec rule: event properties must not carry the search term, viewed/starred IDs, or record values — enforced by **code discipline, no automated test** (editor: harm low vs. detection cost). Enforces D62; `ENGINEERING-DESIGN §6.2`. |
| P7 | should-fix | Removed/prior headshots remain retrievable | (a) | Purge prior GCS object versions on replace/remove/delete after a 3-month lifecycle window; confirm the CDN serves no superseded objects. (Enumeration facet already closed by R16's opaque tokens.) **D94.** |
| P8 | should-fix | `adminNote` vs right-to-access | (b) | Per D77: no DSAR mandate; `adminNote` stays staff-internal (D56). It is for administrative coordination (e.g. an email-change request), not special-category data; no user-facing note added (editor). |
| P9 | should-fix | URL view-state Referer/history leak; no `Referrer-Policy` | (a) | Set a strict `Referrer-Policy` (`same-origin` / `strict-origin-when-cross-origin`); keep search terms off loggable surfaces; confirm Firebase/LB logs don't retain query strings with PII. Header lands with S14 (Session 5). |
| P10 | should-fix | Values-discipline only on audit stream; diagnostic logs | (a) | Extend names-not-values to **all** log streams; forbid logging request/response bodies or Ghost payloads; scrub + test PII in diagnostic/error logs; document the stars/big-brother edge (target ID is the value). Amends D61. |
| P11 | should-fix | Browser disk-cache residue on shared machines | (a) | Serve `/api/profiles` **`no-store`** (cached payload is real PII — names + shared emails/phones — and no hook reliably purges the HTTP cache on tab-close); supersedes D76's read-side 304 (write OCC of D25 untouched). Add a Sign-out control (amends D24, resolves U4). **D95.** |
| P12 | should-fix | Log-reader agent egress (LLM/cloud) undisclosed | (a) | Constrain the planned log-reader agent to first-party/local processing on a local model (purpose: compromise-anomaly + optimization triage); no external-LLM audit egress without a separate disclosed decision. Build deferred; constraint decided now. **D91.** |
| P13 | should-fix | Emergency contacts (3rd-party) default-on, broadcast | (a) | Default `shareEmergency` **false** (opt-in) — third-party data the open-default nudge (D45) doesn't justify. **D93.** |
| P14 | should-fix | Spouse / employer / jobTitle / links public, no toggle | (a)/(b) | Add a `shareSpousePartner` toggle (schema + Profile UI), default **false** (third-party data). `employerName`/`jobTitle`/`links` stay public, no toggle — the brother's own optional data (leave blank to not share). **D93.** |
| P15 | minor | `ghostMemberUuid` collected with no current purpose | (a) | Defer capturing `ghostMemberUuid` until a concrete consumer exists; drop from MVP schema/projection/backup. **D81** (supersedes D70). |
| P16 | minor | No data-retention schedule per category | (b) | Per D77 no compliance schedule required; pin concrete operational numbers — **audit log 3 months, backups 3 months** (folds into `ENGINEERING-DESIGN §6.1`/`§6.3`, amends D63's "N dailies + a few monthlies"). Headshot-version window 3 months (D94). |
| P17 | minor | Headshots have no per-brother visibility control | (b) | As-designed: the coarse photo grant is deliberate and load-bearing (D23's whole-prefix signed cookie; a per-photo toggle would break the lazy grid). Disclose the asymmetry in the notice/manual. |
| P18 | question | CCPA applicability to a nonprofit unsettled | (d) | Editor determined PBE is **not** a CCPA "business" (no threshold met); no compliance machinery and **no tombstone**. Retained: publish the (Mixpanel-inclusive) notice + link from Book. **D77.** |
| P19 | question | Possible minors → special consent | (b) | Population is adults (18+); no minor-consent machinery. Clarify "18+" in USER-MANUAL §1/§11, DATABASE-SCHEMA §4. |

### Operations & reliability
| ID | Sev | Finding | Disposition | Action / new `D##` |
|---|---|---|---|---|
| R1 | blocker | Non-atomic Ghost dual-write; no outbox/alert (lockout) | (a) | **Synchronous** Book→Ghost push (reverses the S0 async-outbox direction): commit Firestore then push in-line; create is Ghost-first (capture `ghostMemberId`, then write Book); an email change commits only if Ghost accepts; failures surfaced for human retry, D55 audit as backstop. Sign-in resolves by primary email (JWT `sub` carries only email) with a **prior-email alias** on disagreement (`pendingPriorEmail`, via the D97 index). Bulk ops stay async jobs (4b). Amends D55. **D96.** |
| R2 | blocker | Snapshot-listener staleness on scale-to-zero Cloud Run | (a) | Cap `max-instances = 1` (keep scale-to-zero): the single instance's self-updated cache is authoritative; listener demoted to a deploy-window safety net; immediate-cutover deploys; watchdog + cache-age alert. Supersedes D26's "any instance count" claim. **D83.** |
| R3 | blocker | Synchronous brotli-11 on request path (DoS/latency) | (a) | Compression off the event loop (async/threadpool); brotli-11 precomputed on write into the GCS snapshot so cold starts load it; debounce + explicit batch-regenerate hook; managers/admins ~brotli-5 fresh per request. Amends D75. **D84.** |
| R4 | should-fix | Whole-DB ops as sync requests (timeouts, no resume) | (a) | **No online bulk-write path** — re-examined the premise: Book has no regular post-launch bulk-write need, so the async-job machinery is not built. Restore → offline event (D101); regenerate-all-thumbnails + migration → operator/offline scripts; Directory bulk-delete dropped (single-record delete kept, D51); MITAA import deferred (R11). Dissolves the out-of-band-writer coherence + uniqueness carry-forwards. **D100.** |
| R5 | should-fix | Restore non-atomic; listener storm; Ghost divergence | (a) | Restore is an **offline** maintenance event (Book hard-down → replace → cold-hydrate, D85) — dissolves listener-storm + in-flight coherence. Pre-write **structural validation** (cycle / ID-uniqueness / email-uniqueness / refs; field-edit rules stay bypassed, D63). **Verbatim incl. roles** (no gating). **Immediate** post-restore reconciliation audit + admin-reviewed Book→Ghost re-push. **D101.** |
| R6 | should-fix | JWKS cold-start auth outage; no fallback | (a) | Persist/seed the (Ghost) JWKS across cold starts with a last-known-good grace window; single-flight + cap unknown-`kid` refetch. Load-bearing under the scale-to-zero choice (D83). **D87.** |
| R7 | should-fix | Multi-store mutations non-atomic; orphans | (a) | Headshot: write GCS objects first, advance the `headshotVersion` pointer **last** (pointer never names missing objects). Delete: **Ghost member first** (sync, D96 — abort clean if it fails), then idempotent re-runnable Book-side steps. Create: Ghost-first (D96). **No dedicated orphan-sweep** — GCS orphans → D94 lifecycle, Ghost orphans → D55 audit (scope **widened** to also report Book-internal orphans), dangling refs → scrub-on-delete (R12). **D98.** |
| R8 | should-fix | Cold-start re-reads ~2,000 docs + cold brotli | (a) | Pull the denormalized all-profiles snapshot into MVP as a backend-internal **GCS object** (raw dataset + precomputed brother buffer + version), regenerated by the backend on write, read once on cold start — clients never read it directly; data is served through `/api/profiles`. Promotes PRD §3.2. **D85.** *(Direction set S0; final call joint with the R2/D83 scale-to-zero decision.)* |
| R9 | should-fix | No request/trace correlation | (a) | Propagate the Cloud Run trace id (`X-Cloud-Trace-Context`) through the save's log lines, the Ghost call, and the audit entry; simplified by D96's sync (the save is one request). **D99.** |
| R10 | should-fix | No alert on Ghost-push failure; manual audit; no canary | (a) | Sync (D96) surfaces push failures immediately. Move the D55 reconciliation audit to a **scheduled** run (auto-detect drift incl. deceased-still-subscribed + D98 Book-internal orphans), alert on findings + failed runs; keep the sign-in-denial-burst alert + the D83 watchdog. **No** standalone push-rate alert. **D99.** |
| R11 | should-fix | Bulk import: atomicity + Ghost-push rate limits + async | (a) | MITAA bulk-CSV import **deferred to post-MVP backlog** (added to `PRD §3.2`): actuarial cadence (~2 deaths/mo, >50% unreported to MITAA) ⇒ realistic reconciliation is a few manual single edits/yr; no bulk import to make atomic. Folded into **D100.** |
| R12 | should-fix | Dangling `bigBrotherId`/`stars` on delete | (a) | **Scrub-and-proceed**: on delete, scan the in-memory dataset for inbound `bigBrotherId`/`stars` and clear/remove them in the same op (free in-memory filter on the single instance); graceful rendering of any straggler as backstop; the D55 audit also reports danglers. Folded into **D98.** |
| R13 | should-fix | No idempotency keys on mutating endpoints | (a) | Under sync, reduces to the lost-response edge: idempotent re-push by `ghostMemberId` + read-back on an uncertain outcome; PATCH treats a self-caused `updateTime` conflict as success. Folded into **D96.** |
| R14 | should-fix | Ghost contract brittleness; account-redirect silent revert | (a) | Document/pin the depended-on Ghost surfaces; run the IdentityProvider contract test + a **login canary** on schedule (dominant risk = Book-unusable, not drift). Portal pages can't be disabled server-side (verified) → theme-link removal only; the rogue-URL two-master path is low/non-zero, caught by the scheduled audit + the self-surfacing lockout. Audit + canary + contract-test run as one periodic **sysadmin job**. **D99.** |
| R15 | should-fix | Eager migration: public net, 500-op limit, mid-deploy race | (a) | Migrations were always external operator scripts (D71), not a Book feature → R15 becomes a **hardening note on D71**: run in-network (Cloud Run Job/Task) with cursor-resume, never from a laptop; backward-compatible-read-then-migrate or drain the old revision before migrating (closes the mid-deploy race). Folded into **D100.** |
| R16 | minor | `headshotVersion` sequential counter → race | (a) | Opaque collision-free token (UUID/timestamp) for `headshotVersion`; fix the `API-SPEC §6` example to match the schema's string type. Also defeats P7's URL-enumeration facet. |
| R17 | minor | `stars` idempotency depends on `arrayUnion` (unspecified) | (a) | Specify `arrayUnion`/`arrayRemove` for the stars PUT/DELETE (`API-SPEC §4`). |
| R18 | minor | CDN signed-cookie mid-session expiry breaks images | (a) | Same event as U3: the 4-hour cap lapse surfaces on image reads as `403`. On image `403`, trigger the same silent re-auth and **retry the load** (the reissued CDN cookie rides the new session) rather than show broken images — not a separate mechanism. Folded into **D109.** |
| R19 | minor | `classYear` validation on two clocks | (a) | Widen client tolerance to `currentYear + 7`; server hard gate stays `+6` as sole authority — no server→client boundary passing. |
| R20 | minor | First-login check-then-create race | (a) | Create-if-absent semantics for the first-login `users` doc (transaction, or `create()` treating "already exists" as success). |
| R21 | minor | DR/continuity posture unstated (RPO/RTO, backup verify) | (a) | **RPO ≈ 24h** (daily backup), **single-region** explicit, RTO ~hours. **Continuous backup-integrity verification** via ephemeral, script-provisioned staging (spin up → restore → validate + checksum → tear down) — the same setup/teardown scripts double as the single-region DR runbook. Amends D72 (staging is on-demand/ephemeral). **D102.** |

### Cross-cutting consistency & documentation
| ID | Sev | Finding | Disposition | Action / new `D##` |
|---|---|---|---|---|
| C1 | should-fix | Schema §6.1 "cookies" vs D30 localStorage + dead ref | (a) | Update `DATABASE-SCHEMA §6.1` to localStorage per D30; remove the dead `PRD §Cookies` ref. |
| C2 | should-fix | D45 "six/two" vs seven/three (D56 drift) | (a) | Amend D45 to seven booleans / three consent flags (superseded in part by D56's `allowCommentReplyEmail`). |
| C3 | should-fix | `allowCommentReplyEmail` manager-projection inconsistency | (a) | Make `allowCommentReplyEmail` a manager column **and** filter consistently per D38; fix `PRD §5.6.1`/`§5.6.4`/`§5.7.2` (verify those sub-sections in resolution). |
| C4 | should-fix | MVP mechanics "TBD/Session 6" in delivered docs | | |
| C5 | should-fix | Manager-deceased consent side-effect vs §4 boundary | (a) | Name the deliberate exception in `PRD §4` (mark-deceased is the one manager action with a consent + Ghost-push side-effect, by design — D55/D28/D48/D80). Kept manager-allowed: D80 makes it reversible (consent restored on un-mark) and it is audited (D61). |
| C6 | should-fix | Headshot authority absent from capability matrix | (a) | Add a headshot add/change/remove row to the `PRD §4.1` matrix — owner/manager/admin (editing *others'* photos confirmed intended). |
| C7 | should-fix | MITAA-export mechanism undefined (consent-aware fields) | (a) | A dedicated, consent-aware MITAA admin export (identity/public-death for all; contact only where `allowShareWithMITAA`; emergency never), separate from the general CSV export. **D90.** |
| C8 | should-fix | `verifiedBy` on screen but excluded from export | (a) | Include `verifiedBy` as a read-only manager/admin export column (`DATABASE-SCHEMA §10`); restores symmetry with `lastVerifiedDate`. |
| C9 | should-fix | No API versioning / stale-SPA / Linter contract | (a) | Lightweight, MVP-scoped: a **contract version** on `/api/roster` (field/header) + a minimal deprecation note so the runtime-independent Linter (D58) can't break silently; a **server-advertised client version** that prompts a stale background tab to refresh (non-blocking overlay) and fails knowingly-stale writes gracefully. No full versioning regime. **D112.** |
| C10 | minor | PRD §3.1 endpoint names inaccurate/incomplete | (a) | Align `PRD §3.1` endpoint wording to the real API surface. |
| C11 | minor | Roster example `null` vs optional-absent convention | (a) | Omit absent optionals in the `API-SPEC §8` roster example (`?` = absent, not `null`); matters for the Linter. |
| C12 | minor | "Four pages" vs Add-Brother route uncounted/undocumented | (a) | Name `/brother/new` (D31) as an explicit admin page; reconcile the `PRD §5` "four pages" count; document in `USER-MANUAL`. |
| C13 | minor | "Toggle Privileges" label vs 3-way selector | (a) | Rename "Toggle Privileges" → "Change role" (`PRD §5.7.10`/`§4.1`). |
| C14 | minor | Un-decease doesn't restore consent/verification | (a) | Snapshot consent + verification at mark-deceased; restore on un-mark. **D80.** |
| C15 | question | No-email brothers can't self-serve; unstated | (a) | Documentation only: state that no-email / unidentified brothers are **staff-maintained and cannot self-serve** (the corollary of D20's deny-and-contact-admin). Lands in `PRD §1`/limitations + `USER-MANUAL`. No `D##`. |

### UI & accessibility
| ID | Sev | Finding | Disposition | Action / new `D##` |
|---|---|---|---|---|
| U1 | should-fix | Targets WCAG 2.1 AA, not current 2.2 AA | (a) | Adopt WCAG 2.2 AA; fold new SCs into D67 checklist (2.5.8/3.3.8 already met; drop obsolete 4.1.1 Parsing). **D79.** |
| U2 | should-fix | In-page help Phase 6 vs a11y-gated pages Phases 3–5 | (a) | Split help along the WCAG line: **AA-baseline labels/instructions (3.3.2) ship *with* each page** in Phases 3–5 so the per-phase a11y gates are honest; the enriched `?` toggle-tips (≈3.3.5/AAA) + manual assembly stay Phase 6. D53's single help source unchanged — only the wiring schedule + gate wording. **D111.** |
| U3 | should-fix | 401-mid-edit discards unsaved form data; path unspecified | (a) | Non-destructive recovery: detect the `401`, **preserve the in-progress form**, re-auth via a **child window** (the editor tab never navigates → form stays in memory, zero PII on disk; `sessionStorage` draft only as a popup-blocked fallback), then **resume the Save** carrying its original `If-Match` (a real 412 still reconciles via D25). Extends D25's preserve-edits instinct to the `401` path; respects D95 (no disk PII) and D107 (`frame-ancestors` ⇒ child window, not iframe). **D109.** |
| U4 | should-fix | No logout control | (a) | **Resolved early in Session 3 (D95):** Book adds a Sign-out control (Ghost-style avatar menu, top-right), reversing D24's "no logout." **Confirmed Session 6** — no further change. |
| U5 | should-fix | Phonetic/Fuse index on main thread → jank | (a) | Build the Fuse index + talisman phonetic codes in a **Web Worker**; render the grid immediately with exact/substring search, switch on fuzzy/phonetic when the worker signals ready. **Drop D35's IndexedDB memo** (name-derived PII on disk, contra D95) → recompute-in-worker each load. Amends D35. **D110.** |
| U6 | minor | Virtualized list missing ARIA row indexing | (a) | Require + test `aria-rowcount`/`-rowindex`/`-setsize` on the virtualized grid; add to the D67/`§6.6` checklist (reinforces D79). |
| U7 | should-fix | Verbose toggles clutter mobile vs "calm" goal | (a) | **Middle path** (amends D45, presentation only): show the **currently-true** consequence inline in plain language; move the opposite-state consequence into the D53 `?` toggle-tip — ~halves at-rest text and cuts the mobile scroll while each control is still *named in plain language*, so an opt-out stays informed (D45's MITAA-failure cure preserved). Stored booleans + open defaults unchanged; light grouping of the seven. **D113.** |

---

## 13. Triage summary

*Triage is complete (Sessions 0–6, 2026-06-08 → 2026-06-11); the resolution / propagation pass followed. The per-session paragraphs below record each sitting's dispositions and new decisions, and the closing roll-up gives the counts across all 81 findings. Corrections that change a design decision are recorded as new decisions in [`../DECISIONS.md`](../DECISIONS.md), not silently edited into the delivered docs.*

**Session 0 — Gating decisions (2026-06-08).** Brief: [`TRIAGE-BRIEF-0.md`](TRIAGE-BRIEF-0.md). Disposed: **P18** (d) → **D77** (PBE is not a CCPA business; no compliance machinery, **no tombstone**; publish + link the notice); **P19** (b) (population 18+); **S17** (a) → **D78** (IAM front door dropped as infeasible; in-code Google-JWKS with subject pin); **U1** (a) → **D79** (WCAG 2.2 AA). Directions set for later sessions: **R1** async durable outbox (→ S4); **R8** provisional snapshot pull-forward (→ S2). Knock-on: D77 removes the tombstone cross-session dependency — **P3**/**P8** pre-framed toward (b) in S3.

**Session 1 — Fast-track ratification (2026-06-08).** Brief: [`TRIAGE-BRIEF-1.md`](TRIAGE-BRIEF-1.md). All seventeen disposed **(a) fix**: **C1, C2, C3, C6, C8, C10, C11, C12, C13, C14, P6, P15, R16, R17, R19, R20, U6**. Two new decisions: **D80** (un-marking deceased restores the consent/verification state snapshotted at mark-time — the consent flag drives Ghost's live subscription state) and **D81** (`ghostMemberUuid` capture deferred until a concrete consumer exists, superseding D70, per D77 minimization). Two editor modifications to the brief's proposals: **P6** scoped to a spec rule enforced by code discipline, the proposed automated lint/test dropped (harm low vs. detection cost); **R19** resolved by widening the client tolerance to `currentYear + 7` (server `+6` stays the sole hard gate) rather than passing a server-authoritative boundary. Two confirmed intents: **C6** (managers/admins editing others' headshots is intended) and **C3** (direction settled; the which-sub-sections check deferred to resolution). No new cross-session dependencies.

**Session 2 — Read / cache / compute (2026-06-09).** Brief: [`TRIAGE-BRIEF-2.md`](TRIAGE-BRIEF-2.md). All seven (S1, S6, R2, R3, R6, R8, S10) disposed **(a) fix**, anchored on the linchpin **D83** (cap Cloud Run `max-instances = 1`, keep scale-to-zero, so the single instance's cache is authoritative). New decisions **D82** (split the read; cache only the brother buffer), **D83**, **D84** (brotli-11 off the event loop, precomputed into the snapshot), **D85** (denormalized GCS snapshot pulled into MVP), **D86** (rate limits), **D87** (JWKS persisted); **S6** amends D76 (no new #).

**Session 3 — Privacy / consent / egress (2026-06-09).** Brief: [`TRIAGE-BRIEF-3.md`](TRIAGE-BRIEF-3.md). **D77 reshaped the session** — with CCPA inapplicable, the four "compliance blockers" became *values/honesty/hygiene* calls. Dispositions: **(a) fix** — P1, P4, P7, P9, P10, P11, P12, P13, P14, S9, S12, C5, C7 (and P5's copy facet); **(b)/(d)** — P2 (closed by D77; notice public+linked), P3 (no tombstone, per D77), P5 (always-flow ratified), P8 (`adminNote` staff-internal), P16 (no schedule; audit+backup pinned at 3 months), P17 (coarse photo grant, D23). Eight new decisions: **D88** (Mixpanel drops `name`; keeps email/Constitution-ID/role/`ignore_dnt` — DNT is a global signal, a poor proxy for site-specific intent), **D89** (MITAA defaults to opt-in + clarified copy + always-flow disclosed via the notice), **D90** (dedicated consent-aware MITAA export), **D91** (log-reader agent first-party/local), **D92** (client-side export gains a thin audit ping), **D93** (third-party-data consent: `shareEmergency` off, new `shareSpousePartner` toggle off, professional fields stay public), **D94** (superseded headshots purged after 3 months), **D95** (`/api/profiles` → `no-store`, superseding D76's read-side 304; Book gains a Sign-out control, reversing D24 and **resolving U4** ahead of Session 6). P9's `Referrer-Policy` header lands with S14 (Session 5); S9 closes the C4 CSV-escaping facet.

**Session 4a — Write-integrity / Ghost seam (2026-06-10).** Brief: [`TRIAGE-BRIEF-4.md`](TRIAGE-BRIEF-4.md). The non-atomic multi-store write spine — **R1, R13, R7, R12, R9, R10, R14, S2** — all **(a) fix**. The through-line: D83's single authoritative instance plus a decision to go **synchronous** dissolved most of the brief's proposed machinery (Forrest's simplicity-over-mechanism mandate). Four decisions: **D96** (Book→Ghost pushes are **synchronous in-line**, *reversing* the Session-0 async-outbox direction — create Ghost-first, email-commit-gated-on-Ghost, **diff-based** push so an unrelated edit never re-subscribes a Ghost-side unsubscriber, email-only sign-in with a `pendingPriorEmail` alias closing the email-change lockout; folds R1, R13); **D97** (email uniqueness + destructive normalization via the single instance's **in-memory index**, *no* Firestore reservation collection, primary + `alternateEmail` in one namespace, fail-closed; S2); **D98** (multi-store ordering — pointer-last headshot, Ghost-first-abort-clean delete, scrub-on-delete for dangling refs, **no** orphan-sweep; R7, R12); **D99** (trace IDs + one consolidated periodic **sysadmin job** = scheduled reconciliation audit + login canary + contract test, no standalone push-rate alert; R9, R10, R14).

**Session 4b — Async ops, restore, DR & read-architecture revisit (2026-06-11).** Brief: [`TRIAGE-BRIEF-4.md`](TRIAGE-BRIEF-4.md) §5–§6. **R4, R11, R15, R5, S13, R21** — all **(a)**. Forrest cut the knot by re-examining the premise: an actuarial estimate (≈2 deaths/month, >50% never reported to MITAA) shows Book has **no regular post-launch bulk-write workload**, so the online async-job apparatus the pre-4a brief proposed is unnecessary. Four decisions: **D100** (Book has **no online bulk-write path** — MITAA import deferred to backlog, restore becomes an **offline** event, regen-thumbnails/migration → operator scripts, Directory bulk-delete dropped (single-delete kept); dissolves both 4a out-of-band carry-forwards; R4, R11, R15); **D101** (restore hardening — offline replace + cold-hydrate, pre-write **structural validation**, roles restored **verbatim/no gating**, a forensic privileged-roster log, immediate **admin-reviewed** post-restore Ghost reconcile, bucket ACL + encryption + 3-month retention, signed manifest skipped; R5, S13); **D102** (DR — ≈24h RPO, **single-region** explicit, continuous backup-integrity verification via **ephemeral script-provisioned staging** that doubles as the DR runbook; R21); **D103** (the newsletter flag reconciles **bidirectionally by most-recent-change-wins** via timestamps — a scoped, safe exception to D55's read-only-into-Book invariant; the 4a carry-forward).

**Session 5 — Auth & input hardening (2026-06-11).** Brief: [`TRIAGE-BRIEF-5.md`](TRIAGE-BRIEF-5.md). **S3, S4, S5, S7, S8, S11, S14, S15, S16, S18, S19** — all **(a) fix** (S5 mixed **(a)+(b)**) — plus **P9**'s `Referrer-Policy` header lands with S14. The high ratify ratio the plan predicted: both reviewers *credited* the security architecture, and these eleven are gaps where the spec stated an intent without pinning the *enforcement mechanism*. The one genuine fork — **S5** step-up — was narrowed by Session 4 (D99 closed S2's takeover path; D100/D101 took restore **offline** and **dropped** Directory bulk-delete) down to role grants + single delete, and **step-up was rejected**: an in-Book step-up authenticates nothing when every factor is Ghost-derived, and out-of-band is unjustified at 1–2 admins for actions already confirmed, audited, and reversible. Five decisions: **D104** (JWT **alg-pinning** + callback **nonce** + redirect allowlist; S7, S8); **D105** (Ghost single-point-of-compromise — close the replay/forced-login vectors, **accept** the blast-radius dependency (D54) with a documented threat model, **no step-up**; S5); **D106** (server-side **authorization model** — a positive per-role **write-field allowlist** (the read-projection's write-side dual) + an explicit **object-level predicate** + a server-enforced **last-admin invariant**; S3, S4, S18); **D107** (input & HTTP-boundary hardening — **40 MP** decoded-image cap + strict **URL-scheme allowlist** + a **strict CSP** that explicitly allowlists D62's Mixpanel + `nosniff`/framing + P9's `Referrer-Policy` + deny-by-default **CORS** + **host-only** session cookie; S11, S15, S14, S19); **D108** (`DevIdentityProvider` **compiled out of the prod bundle** + retained env gate + CI assertion + startup alert; S16). Amends D64 (headers); lands P9.

**Session 6 — UI / a11y + leftovers (2026-06-11).** Brief: [`TRIAGE-BRIEF-6.md`](TRIAGE-BRIEF-6.md). The final sitting — **U2, U3, U4, U5, U7, C9, C15, R18** — a clean sweep, every finding **(a)**. One already-resolved item confirmed (**U4**, closed in Session 3 by **D95** — no further change), one documentation-only with no `D##` (**C15** — no-email / unidentified brothers are staff-maintained and cannot self-serve, the corollary of D20), and the rest carrying four new decisions: **D109** (session-expiry recovery — a mid-edit `401` and a mid-session image `403` are handled **non-destructively**: preserve the in-progress form, re-auth via a **child window** so the editor tab never navigates and no PII hits disk, then resume the Save with its original `If-Match`; folds R18, extends D25, respects D95/D107); **D110** (the Fuse + phonetic index builds in a **Web Worker** — grid renders immediately, fuzzy/phonetic switches on when ready — and **D35's IndexedDB memo is dropped** as name-derived PII on disk, recomputed each load; amends D35); **D111** (in-page help split along the WCAG line — **AA-baseline labels/instructions ship *with* each page** in Phases 3–5 so the per-phase a11y gates are honest, the enriched `?` toggle-tips and the manual assembly stay Phase 6; clarifies D53/D67); **D112** (lightweight API-contract evolution — a `contractVersion` on `/api/roster` for the Linter + a server-advertised client version that prompts a stale background tab to refresh; no full versioning regime). **U7** took the inline-active-side middle path → **D113** (privacy-toggle copy: the currently-true consequence inline, the counterfactual in the `?` tip; presentation-only amendment of D45). **This closed triage** — all 81 findings dispositioned.

**Triage roll-up (all 81 findings).** Across the eight sittings (Sessions 0–6), the 81 composite findings resolved as **73 (a) fix**, **7 (b)/(d)** consciously closed as as-designed or as-external-context (all in the privacy cluster), and **1** the **C4** documentation-umbrella, whose "TBD / Session 6" mechanics were closed by the resolution pass itself (CSV formula-injection rules + the two-tier MITAA layout in `DATABASE-SCHEMA §10`; the discrepancy-report JSON in `ENGINEERING-DESIGN §5.1` / `API-SPEC §7`; the stale forward-refs retired). The seven non-fixes — settled deliberately, not by omission — are **P18 (d)** (PBE is not a CCPA "business"), **P2 (b)/(d)** (no DSAR/deletion machinery; the public notice satisfies notice-at-collection), **P3 (b)** (no tombstone — deletion is admin error-correction, so nothing to resurrect), **P8 (b)** (`adminNote` stays staff-internal), **P16 (b)** (no compliance retention *schedule*; concrete operational 3-month windows pinned for audit logs and backups), **P17 (b)** (the coarse any-brother photo grant is deliberate and load-bearing for the lazy grid), and **P19 (b)** (population is adults 18+, no minor-consent machinery). Three findings are mixed **(a)+(b)** — **S5** (replay/forced-login closed; in-Book step-up rejected), **P5** (always-flow ratified; misleading copy fixed), and **P14** (`shareSpousePartner` toggle added; the brother's own professional fields stay public). Triage produced **37 new decisions, D77–D113**; the resolution / propagation pass added one more, **D114** (the thumbnail-regenerate feature dropped entirely, amending D100). All corrections that alter a design choice live as numbered decisions in [`../DECISIONS.md`](../DECISIONS.md); the eight delivered docs were updated once, in the resolution pass, never silently.

*— End of composite. 8 raw reports · 125 raw findings · 81 composite findings · compiled 2026-06-07; triage + resolution summary completed 2026-06-11.*






