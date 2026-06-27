import type { NameRecord, SearchConfig } from "@pbe/name-search";

/**
 * The message protocol between the Directory and its Name-Search Web Worker
 * (D110). The worker builds the fuzzy/phonetic/nickname index off the main thread
 * so SPA init never janks on older hardware; the main thread renders immediately
 * with exact/substring matching and switches to the worker once it posts `ready`.
 */

/** Main thread → worker. */
export type SearchRequest =
  | { type: "build"; records: NameRecord[]; config: SearchConfig }
  | { type: "query"; seq: number; query: string };

/** Worker → main thread. */
export type SearchResponse =
  | { type: "ready" }
  | { type: "result"; seq: number; query: string; ids: number[] | null };
