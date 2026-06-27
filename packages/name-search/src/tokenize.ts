/**
 * Name tokenization (D35). Name fields are split into word tokens **on spaces
 * and hyphens** so a hyphenated `Smith-Jones` is found by "Smith" or "Jones", a
 * brother who goes by his middle or a multi-word mug name is found by any of
 * those words, and a multi-word query can AND its words together. Tokens are
 * case- and diacritic-folded so "José" and "Jose" are the same token, and tokens
 * with no letter (a bare class year or Constitution ID that rides along in the
 * Canonical Name) are dropped — Name Search matches names, not numbers.
 */

/** Split points between tokens: any run of whitespace or dash punctuation (\p{Pd} covers en/em dashes). */
const SEPARATORS = /[\s\p{Pd}]+/u;

/** Any letter, used to reject number-only tokens (years, IDs). */
const HAS_LETTER = /\p{L}/u;

/**
 * Fold one raw word to its comparison form: lower-cased, diacritics stripped,
 * and surrounding punctuation (apostrophes, periods, parens) removed. Internal
 * letters are preserved. Returns "" for a word that folds away to nothing.
 */
export function normalizeToken(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // strip combining marks (the diacritics NFKD split off)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ""); // drop punctuation, keep letters/digits
}

/**
 * Tokenize a name-field value into its folded word tokens. Empty/undefined in
 * yields an empty list; number-only tokens (no letter) are excluded.
 */
export function tokenize(value: string | undefined | null): string[] {
  if (!value) {
    return [];
  }
  const tokens: string[] = [];
  for (const part of value.split(SEPARATORS)) {
    const token = normalizeToken(part);
    if (token.length > 0 && HAS_LETTER.test(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}
