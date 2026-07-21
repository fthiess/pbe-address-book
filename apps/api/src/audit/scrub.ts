/**
 * PII scrubbing for the diagnostic/error stream (DECISIONS P10, amending D61;
 * ENGINEERING-DESIGN §6.1). The diagnostic logger carries free-text strings —
 * a developer-authored `message`, an upstream `error.message`, a stack — that,
 * unlike the structurally value-free {@link AuditEntry}, *can* pick up a value
 * by interpolation. The realistic vector is an upstream **Ghost** error echoing
 * the member email it was queried with ("member already exists with email …").
 * P10 says PII is **scrubbed** from that output, and this is the safety net that
 * makes "we never interpolate a value" true even under a mistake.
 *
 * SCOPE AND ITS LIMIT. This redacts the two machine-recognizable PII shapes that
 * actually appear in these messages — **email addresses and phone numbers**.
 * Identifiers ride the logger's structured label slots (`actorId`, `targetId`,
 * a `fields` name list), never the free text, so a Constitution ID or a count is
 * out of scope by construction. The acknowledged residual — a *name* embedded in
 * an upstream error string — is not machine-recognizable and stays the documented
 * limit (the same shape of acknowledged edge the audit stream carries for a
 * target identifier that is itself the value); the primary defence remains the
 * discipline that `message` is a constant and dynamic detail is bounded.
 *
 * ReDoS SAFETY (N88). Every pattern here is **linear** — no nested quantifier and
 * no quantifier over a class that overlaps the delimiter that follows it — so
 * none is superlinear on adversarial input. The email pattern separates its two
 * runs with a mandatory `@` the runs exclude; the phone patterns use fixed
 * repetition counts. CodeQL's polynomial-ReDoS query stays quiet, deliberately.
 */

// local@domain.tld. The character classes are restricted to what actually appears
// in an email — the local part to RFC-common local characters, the domain to
// letters/digits/dot/hyphen — and a real dotted TLD is **required**. That last
// restriction is load-bearing: the free-text this scrubs includes ERROR **stack
// traces**, whose frames name scoped npm packages (`@grpc/grpc-js`,
// `@google-cloud/firestore`, `@fastify/cookie` — exactly the libraries under
// `firebase-admin`, the modal 500). A permissive `@`-with-non-space-runs pattern
// would swallow those frames wholesale and gut the stack; requiring a dotted TLD
// after a domain that excludes `/` and `:` means a package path (`@grpc/grpc-js`)
// never matches while a genuine address (`james@example.com`) still does. All
// quantifiers are bounded → linear, no ReDoS (N88).
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g;

// NANP-shaped: an optional country code, then a 3-3-4 grouping whose area code
// may be paren-wrapped, with common separators. Fixed repetition counts → linear.
// The 3-3-4 shape needs ten digits, so it does not match an ISO date
// (`2026-07-21`, eight digits) — a timestamp is never mistaken for a phone number.
const NANP_PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

// E.164: a leading `+` then 7–15 digits, no separators. Fixed bound → linear.
const E164_PHONE_RE = /\+\d{7,15}/g;

/**
 * Redact email addresses and phone numbers from a free-text log string. Returns
 * the string unchanged when it carries neither (the common case for the constant
 * developer-authored messages). Idempotent and allocation-cheap.
 */
export function scrub(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(E164_PHONE_RE, "[phone]")
    .replace(NANP_PHONE_RE, "[phone]");
}
