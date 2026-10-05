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
   * true for an empty query, once the worker has answered *this* query, or when
   * the worker has failed (substring is then the whole answer). While false,
   * `matchedIds` is the interim substring set that will still grow into the
   * richer worker match, so anything that depends on the row set being stable
   * (scroll restoration) must wait for this rather than for `ready` alone — and
   * an empty interim set is not yet "no match" (OFC-459).
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
  // The worker could not be created or died (no module-worker support, a failed
  // script load, an exception while indexing). Substring matching is then the
  // whole answer (D110's progressive enhancement), so the search counts as
  // settled on it rather than waiting for a reply that will never come (OFC-459).
  const [failed, setFailed] = useState(false);
  const [workerResult, setWorkerResult] = useState<{
    query: string;
    ids: Set<number> | null;
    tokens: ReadonlyMap<number, Set<string>>;
    /** The dataset the answering index was built from (see `workerCurrent`). */
    records: readonly unknown[] | null;
  }>({ query: "", ids: null, tokens: EMPTY_TOKENS, records: null });
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  // The dataset the worker's index was last built from, stamped onto each answer.
  const indexRecordsRef = useRef<readonly unknown[] | null>(null);

  // Create the worker once enabled (immediately for the Directory; on first
  // engagement for the picker — OFC-119). While disabled, `workerRef.current`
  // stays null and the build/query effects below no-op, so matching falls back to
  // the main-thread substring index.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" });
    } catch {
      setFailed(true);
      return;
    }
    setFailed(false);
    workerRef.current = worker;
    worker.onerror = () => {
      setReady(false);
      setFailed(true);
    };
    worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      const message = event.data;
      if (message.type === "ready") {
        setReady(true);
      } else if (message.type === "result" && message.seq === seqRef.current) {
        setWorkerResult({
          query: message.query,
          ids: message.ids === null ? null : new Set(message.ids),
          tokens: message.tokens ?? EMPTY_TOKENS,
          records: indexRecordsRef.current,
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
    // Bump the sequence so an answer already in flight from the previous index is
    // discarded on arrival; answers accepted from here on are stamped with these
    // records (`workerCurrent` checks the stamp).
    seqRef.current += 1;
    indexRecordsRef.current = records;
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

  // Whether the worker's answer is for the query AND the dataset currently on
  // screen. The dataset half matters on every reload: the worker indexes the
  // still-empty roster first and answers the query "nothing". In the render where
  // the roster lands, `ready` and that answer are both still the old ones — an
  // effect cannot clear them before that frame paints — so matching on the query
  // text alone made the Directory flash "No brothers match" before the real
  // answer (OFC-459, found in Forrest's live test). Comparing the dataset during
  // render closes it: an answer computed from other records is never current.
  const workerCurrent = ready && workerResult.query === query && workerResult.records === records;
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

  // The row set is final when there is no query, when the worker's answer is
  // for the query currently on screen, or when there is no worker to wait for. (Index-`ready` alone is not enough: after
  // the index builds there is still a query round-trip during which `matchedIds`
  // is the interim substring set.)
  const settled = query.trim().length === 0 || workerCurrent || failed;

  return { matchedIds, highlight, ready, settled };
}
