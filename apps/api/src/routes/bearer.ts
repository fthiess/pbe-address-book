/**
 * `Authorization: Bearer …` parsing, shared by Book's service-authenticated routes
 * (the Linter roster, D58/D78; the automated backup job, D63/7b-2). A tiny helper
 * module in the shape of {@link ./trace.js}, so the two routes cannot drift on it —
 * and, more to the point, so the two hardening lessons baked into it below are not
 * re-learned by the next route that parses this header.
 */

/**
 * Extract the bearer token from an `Authorization` header. The scheme match is
 * **case-insensitive** per RFC 6750 / RFC 7235 (`Bearer`/`bearer`/`BEARER` are all
 * valid; OFC-224). Parsed by splitting on the first space rather than a regex, so a
 * crafted header (`bearer` + many spaces) can't trigger regex backtracking
 * (polynomial ReDoS on unauthenticated input; OFC-218 follow-up).
 */
export function bearerToken(header: string | undefined): string | null {
  if (typeof header !== "string") {
    return null;
  }
  const trimmed = header.trim();
  const space = trimmed.indexOf(" ");
  if (space < 0 || trimmed.slice(0, space).toLowerCase() !== "bearer") {
    return null;
  }
  const token = trimmed.slice(space + 1).trim();
  return token.length > 0 ? token : null;
}
