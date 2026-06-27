import Fuse from "fuse.js";
import { expandNickname } from "./nicknames.js";
import { phoneticCodes } from "./phonetic.js";
import { tokenize } from "./tokenize.js";
import type { NameRecord, SearchConfig } from "./types.js";

/**
 * The name fields the matcher indexes (D35) — the structured parts, the
 * full/legal name, the mug name, and the resolved Canonical Name.
 */
const NAME_FIELDS: readonly (keyof NameRecord)[] = [
  "firstName",
  "middleName",
  "lastName",
  "fullLegalName",
  "mugName",
  "canonicalName",
];

/** Every distinct folded name token a record contributes, across all name fields. */
export function recordTokens(record: NameRecord): string[] {
  const tokens = new Set<string>();
  for (const field of NAME_FIELDS) {
    const value = record[field];
    if (typeof value === "string") {
      for (const token of tokenize(value)) {
        tokens.add(token);
      }
    }
  }
  return [...tokens];
}

/**
 * A search result with, per matched brother, the brother's own name tokens that
 * matched the query (folded form). Used to drive highlighting across every
 * displayed name column — including matches the main thread could not recompute
 * (Beider-Morse phonetics) or could not see (a match on a non-name-column field).
 */
export interface SearchResult {
  ids: Set<number>;
  /** Constitution ID → the record's folded tokens that matched the query. */
  tokens: Map<number, Set<string>>;
}

/** The compiled, queryable name index built in the Web Worker (D110). */
export interface NameIndex {
  /**
   * The Constitution IDs matching `query`, or `null` for an empty query (meaning
   * "no name filter" — the caller shows the whole set). Query words are ANDed:
   * every query token must match some name token, each token matched by typo
   * tolerance, nickname expansion, and phonetics together.
   */
  search(query: string): Set<number> | null;
  /**
   * Like {@link search}, but also returns which of each matched brother's tokens
   * matched — so the caller can highlight exactly the words the matcher hit,
   * across all name fields and all match kinds. `null` for an empty query.
   */
  searchDetailed(query: string): SearchResult | null;
}

function addTo(map: Map<string, Set<number>>, key: string, id: number): void {
  let set = map.get(key);
  if (!set) {
    set = new Set<number>();
    map.set(key, set);
  }
  set.add(id);
}

function intersect(a: Set<number>, b: Set<number>): Set<number> {
  // Iterate the smaller set for a cheaper intersection.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set<number>();
  for (const id of small) {
    if (large.has(id)) {
      out.add(id);
    }
  }
  return out;
}

/**
 * Build the full fuzzy + phonetic + nickname index over the records (D35/D110).
 * Three inverted maps (exact token → ids, phonetic code → ids) plus a Fuse index
 * over the token *vocabulary* give typo tolerance; query tokens are expanded
 * through the nickname dictionary (D123) and the phonetic algorithm, then ANDed.
 *
 * There is no relevance ranking by design (D35): search never reorders results —
 * the user's chosen sort is always honored — so this returns an unordered id set
 * and field weighting is unnecessary.
 */
export function buildIndex(records: readonly NameRecord[], config: SearchConfig): NameIndex {
  const exact = new Map<string, Set<number>>();
  const phonetic = new Map<string, Set<number>>();
  const vocabulary = new Set<string>();
  // Per-record token lists and per-token phonetic codes, so a matched record's
  // own matched tokens can be resolved cheaply for highlighting.
  const tokensByRecord = new Map<number, string[]>();
  const codesByToken = new Map<string, string[]>();

  for (const record of records) {
    const tokens = recordTokens(record);
    tokensByRecord.set(record.id, tokens);
    for (const token of tokens) {
      vocabulary.add(token);
      addTo(exact, token, record.id);
      if (config.phonetic !== "none") {
        let codes = codesByToken.get(token);
        if (!codes) {
          codes = phoneticCodes(token, config.phonetic);
          codesByToken.set(token, codes);
        }
        for (const code of codes) {
          addTo(phonetic, code, record.id);
        }
      }
    }
  }

  // Fuse over the distinct token strings: typo tolerance (and substring matching,
  // since Fuse with ignoreLocation matches a query anywhere in a token) (D35).
  const tokenList = [...vocabulary];
  const fuse = new Fuse(tokenList, {
    threshold: 0.3,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  /**
   * The vocabulary tokens and phonetic codes a single query token matches, across
   * every mechanism — computed once per query token, then reused both to gather
   * ids and to resolve each matched record's matched tokens.
   */
  interface QueryTokenMatch {
    /** Vocabulary tokens hit by exact + Fuse typo/substring + nickname expansion. */
    literal: Set<string>;
    /** The query token's own phonetic codes (empty when phonetics are off). */
    codes: string[];
  }

  function matchFor(queryToken: string): QueryTokenMatch {
    const literal = new Set<string>();
    if (exact.has(queryToken)) {
      literal.add(queryToken);
    }
    for (const { item } of fuse.search(queryToken)) {
      literal.add(item);
    }
    if (config.nicknames) {
      for (const nick of expandNickname(queryToken)) {
        if (nick !== queryToken && exact.has(nick)) {
          literal.add(nick);
        }
      }
    }
    const codes = config.phonetic === "none" ? [] : phoneticCodes(queryToken, config.phonetic);
    return { literal, codes };
  }

  function idsFor(match: QueryTokenMatch): Set<number> {
    const ids = new Set<number>();
    for (const token of match.literal) {
      for (const id of exact.get(token) ?? []) {
        ids.add(id);
      }
    }
    for (const code of match.codes) {
      for (const id of phonetic.get(code) ?? []) {
        ids.add(id);
      }
    }
    return ids;
  }

  /** Whether a record's token matched a query token (literal hit or shared code). */
  function tokenMatches(token: string, match: QueryTokenMatch): boolean {
    if (match.literal.has(token)) {
      return true;
    }
    if (match.codes.length > 0) {
      const codes = codesByToken.get(token);
      if (codes) {
        for (const code of codes) {
          if (match.codes.includes(code)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function searchDetailed(query: string): SearchResult | null {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return null;
    }
    const matches = queryTokens.map(matchFor);

    // Membership: AND across query tokens.
    let ids: Set<number> | null = null;
    for (const match of matches) {
      const next = idsFor(match);
      ids = ids === null ? next : intersect(ids, next);
      if (ids.size === 0) {
        break;
      }
    }
    ids ??= new Set<number>();

    // For each matched record, the subset of its own tokens that matched — the
    // words to highlight, wherever they appear in a displayed name column.
    const tokens = new Map<number, Set<string>>();
    for (const id of ids) {
      const matched = new Set<string>();
      for (const token of tokensByRecord.get(id) ?? []) {
        if (matches.some((match) => tokenMatches(token, match))) {
          matched.add(token);
        }
      }
      tokens.set(id, matched);
    }
    return { ids, tokens };
  }

  return {
    search(query: string): Set<number> | null {
      return searchDetailed(query)?.ids ?? null;
    },
    searchDetailed,
  };
}

/**
 * The **immediate, main-thread** matcher used before the Web-Worker index is
 * ready (D110): plain exact/substring over the name tokens, ANDed across query
 * words. No Fuse, no phonetics — so the grid filters instantly on first paint and
 * the richer matching switches on when the worker signals ready.
 */
export function substringMatch(records: readonly NameRecord[], query: string): Set<number> | null {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return null;
  }
  const ids = new Set<number>();
  for (const record of records) {
    const tokens = recordTokens(record);
    const everyMatches = queryTokens.every((queryToken) =>
      tokens.some((token) => token.includes(queryToken)),
    );
    if (everyMatches) {
      ids.add(record.id);
    }
  }
  return ids;
}
