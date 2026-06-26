/**
 * Canonical email normalization (DECISIONS D97). One function, shared by both
 * sides, so the form a stored `email` takes and the form the Ghost auth bridge
 * resolves a JWT's `sub` against are guaranteed identical — an email that maps
 * to a profile when stored maps to the same profile at sign-in.
 *
 * Normalization is deliberately conservative: lowercase, trim surrounding
 * whitespace, and Unicode-NFC. It does NOT strip subaddressing (`+tag`) or dots,
 * because two addresses that differ only there can be different real mailboxes
 * at some providers; collapsing them would silently merge distinct members.
 */
export function normalizeEmail(email: string): string {
  return email.normalize("NFC").trim().toLowerCase();
}
