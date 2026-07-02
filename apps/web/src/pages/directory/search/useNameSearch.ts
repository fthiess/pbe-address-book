import {
  DEFAULT_SEARCH_CONFIG,
  type HighlightRange,
  type NameRecord,
  type SearchConfig,
  buildSubstringIndex,
  highlightRanges,
  substringMatchIndexed,
} from "@pbe/name-search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchResponse } from "./protocol.js";

const EMPTY_TOKENS: ReadonlyMap<number, Set<string>> = new Map();

export interface NameSearchResult {
  /**
   * The matching Constitution IDs, or `null` for an empty query (meaning "no
   * name filter" — show the whole set). The caller intersects this with its rows.
   */
  matchedIds: Set<number> | null;
  /**
   * Compute the highlight ranges to mark in a brother's `display` string (any
   * name column) — character-level for substring hits, whole-word for the
   * nickname/typo/phonetic matches the worker reported for that brother (D35).
   */
  highlight: (display: string, profileId: number) => HighlightRange[];
  /**
   * Whether the worker's fuzzy/phonetic/nickname index is live. Before it is,
   * matching is exact/substring on the main thread; after, the worker answers.
   * Surfaced so the UI can announce the progressive-enhancement transition (D110).
   */
  ready: boolean;
  /**
   * Whether `matchedIds` reflects the **final** answer for the query on screen —
   * true for an empty query, or once the worker has answered *this* query. While
   * false, `matchedIds` is the interim substring set that will still grow into the
   * richer worker match, so anything that depends on the row set being stable
   * (scroll restoration) must wait for this rather than for `ready` alone.
   */
  settled: boolean;
}

/**
 * Name Search wired to the Web Worker (D35/D110/D123). The grid filters
 * immediately via main-thread {@link substringMatch}; when the worker finishes
 * building its index it posts `ready`, after which the richer fuzzy + phonetic +
 * nickname matching takes over. Results lag the query by a worker round-trip, so
 * the synchronous substring match is the fallback both before `ready` and for the
 * brief moment after a keystroke before the worker answers — the result set only
 * ever *grows* into the richer match, so the transition reads as calm.
 *
 * The worker also reports, per matched brother, which of his name tokens matched,
 * which drives highlighting across every name column (including phonetic matches
 * the main thread can't recompute and matches on non-displayed fields).
 */
export function useNameSearch(
  records: NameRecord[],
  query: string,
  /**
   * Whether to build the Web Worker's fuzzy + Beider-Morse phonetic + nickname
   * index. Default `true` for the Directory (search is the page's purpose). The
   * Big-Brother picker passes `false` until the field is engaged, so opening a
   * profile that never touches it doesn't pay for the index build (OFC-119); the
   * main-thread substring fallback covers matching until the worker comes online.
   */
  enabled = true,
  config: SearchConfig = DEFAULT_SEARCH_CONFIG,
): NameSearchResult {
  const [ready, setReady] = useState(false);
  const [workerResult, setWorkerResult] = useState<{
    query: string;
    ids: Set<number> | null;
    tokens: ReadonlyMap<number, Set<string>>;
  }>({ query: "", ids: null, tokens: EMPTY_TOKENS });
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);

  // Create the worker once enabled (immediately for the Directory; on first
  // engagement for the picker — OFC-119). While disabled, `workerRef.current`
  // stays null and the build/query effects below no-op, so matching falls back to
  // the main-thread substring index.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const worker = new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      const message = event.data;
      if (message.type === "ready") {
        setReady(true);
      } else if (message.type === "result" && message.seq === seqRef.current) {
        setWorkerResult({
          query: message.query,
          ids: message.ids === null ? null : new Set(message.ids),
          tokens: message.tokens ?? EMPTY_TOKENS,
        });
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [enabled]);

  // (Re)build the index whenever the dataset or config changes — and when the
  // worker is first created (`enabled` flips true for a lazily-gated picker), so
  // the just-created worker actually receives its build and posts `ready`; without
  // `enabled` in the deps a gated worker would never build (OFC-119). The richer
  // matching is offline until the worker posts `ready` again.
  useEffect(() => {
    const worker = workerRef.current;
    if (!enabled || !worker) {
      return;
    }
    setReady(false);
    worker.postMessage({ type: "build", records, config });
  }, [records, config, enabled]);

  // Once ready, send each query to the worker; stale answers are dropped by seq.
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !ready) {
      return;
    }
    seqRef.current += 1;
    worker.postMessage({ type: "query", seq: seqRef.current, query });
  }, [ready, query]);

  // Per-record folded name tokens, precomputed once per dataset so the keystroke
  // fallback below never re-tokenizes all ~1166 records on every keypress (OFC-105).
  const substringIndex = useMemo(() => buildSubstringIndex(records), [records]);

  // The immediate main-thread match — the value shown until the worker's richer
  // answer for *this exact query* arrives. Scans the cached token index, so each
  // keystroke is a cheap substring pass, not a full re-tokenization.
  const substring = useMemo(
    () => substringMatchIndexed(substringIndex, query),
    [substringIndex, query],
  );

  // Whether the worker's answer is for the query currently on screen.
  const workerCurrent = ready && workerResult.query === query;
  const matchedIds = workerCurrent ? workerResult.ids : substring;
  // Matched tokens only exist once the worker has answered this query; before
  // that, the substring fallback highlights itself (substring layer only).
  const matchedTokens = workerCurrent ? workerResult.tokens : EMPTY_TOKENS;

  const highlight = useCallback(
    (display: string, profileId: number): HighlightRange[] =>
      query.trim().length === 0
        ? []
        : highlightRanges(display, query, matchedTokens.get(profileId)),
    [query, matchedTokens],
  );

  // The row set is final when there is no query, or when the worker's answer is
  // for the query currently on screen. (Index-`ready` alone is not enough: after
  // the index builds there is still a query round-trip during which `matchedIds`
  // is the interim substring set.)
  const settled = query.trim().length === 0 || workerCurrent;

  return { matchedIds, highlight, ready, settled };
}
