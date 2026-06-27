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

/** The compiled, queryable name index built in the Web Worker (D110). */
export interface NameIndex {
  /**
   * The Constitution IDs matching `query`, or `null` for an empty query (meaning
   * "no name filter" — the caller shows the whole set). Query words are ANDed:
   * every query token must match some name token, each token matched by typo
   * tolerance, nickname expansion, and phonetics together.
   */
  search(query: string): Set<number> | null;
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

  for (const record of records) {
    for (const token of recordTokens(record)) {
      vocabulary.add(token);
      addTo(exact, token, record.id);
      if (config.phonetic !== "none") {
        for (const code of phoneticCodes(token, config.phonetic)) {
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

  function idsForQueryToken(queryToken: string): Set<number> {
    const ids = new Set<number>();

    // Exact, then Fuse typo/substring matches over the vocabulary.
    for (const id of exact.get(queryToken) ?? []) {
      ids.add(id);
    }
    for (const { item } of fuse.search(queryToken)) {
      for (const id of exact.get(item) ?? []) {
        ids.add(id);
      }
    }

    // Bidirectional nickname expansion (D123): exact matches on each group member.
    if (config.nicknames) {
      for (const nick of expandNickname(queryToken)) {
        if (nick === queryToken) {
          continue;
        }
        for (const id of exact.get(nick) ?? []) {
          ids.add(id);
        }
      }
    }

    // Phonetic (sound-alike) matches.
    if (config.phonetic !== "none") {
      for (const code of phoneticCodes(queryToken, config.phonetic)) {
        for (const id of phonetic.get(code) ?? []) {
          ids.add(id);
        }
      }
    }

    return ids;
  }

  return {
    search(query: string): Set<number> | null {
      const queryTokens = tokenize(query);
      if (queryTokens.length === 0) {
        return null;
      }
      let result: Set<number> | null = null;
      for (const queryToken of queryTokens) {
        const ids = idsForQueryToken(queryToken);
        result = result === null ? ids : intersect(result, ids);
        if (result.size === 0) {
          break; // AND across tokens — once empty it stays empty.
        }
      }
      return result;
    },
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
