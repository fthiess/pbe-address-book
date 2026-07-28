/**
 * The app-level conditional read's `If-None-Match` matcher (Phase 7.5b, N62).
 *
 * Deliberately narrower than RFC 9110 §13.1.2: the only client is Book's own
 * fetch layer, which sends exactly one quoted token — but the parser still
 * tolerates the shapes a well-meaning intermediary could hand us (a list, a
 * `W/` weak prefix, unquoted tokens), because Firebase Hosting sits between the
 * SPA and Cloud Run and its handling of conditional headers on rewrites is
 * observed, not documented (the D146 lesson). `*` is deliberately NOT honored:
 * RFC semantics for `*` ("any current representation") would 304 a client that
 * holds no token at all, and no legitimate Book client ever sends it.
 */
export function ifNoneMatchSatisfied(header: string | undefined, etag: string): boolean {
  if (header === undefined || header === "") {
    return false;
  }
  return header
    .split(",")
    .map((candidate) => normalizeEntityTag(candidate))
    .some((candidate) => candidate !== "" && candidate === etag);
}

/** Strip the `W/` weak prefix and surrounding quotes/whitespace from one entity-tag. */
function normalizeEntityTag(candidate: string): string {
  let tag = candidate.trim();
  if (tag.startsWith("W/")) {
    tag = tag.slice(2);
  }
  if (tag.startsWith('"') && tag.endsWith('"') && tag.length >= 2) {
    tag = tag.slice(1, -1);
  }
  return tag;
}
