import { type NameIndex, buildIndex } from "@pbe/name-search";
import type { SearchRequest, SearchResponse } from "./protocol.js";

/**
 * The Name-Search Web Worker (D110). On `build` it constructs the full fuzzy +
 * phonetic + nickname index from a structured-clone of the in-memory name
 * records and posts `ready`; on `query` it answers with the matching Constitution
 * IDs. The phonetic codes are computed here each load and never persisted — no
 * name-keyed PII ever touches disk (D95). Stale-query results are filtered on the
 * main thread by the monotonic `seq`.
 *
 * `self` is typed through a minimal worker-scope shape so this file needs only the
 * DOM lib the rest of the SPA compiles with (no conflicting WebWorker lib).
 */
const worker = self as unknown as {
  postMessage(message: SearchResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<SearchRequest>) => void): void;
};

let index: NameIndex | null = null;

worker.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "build") {
    index = buildIndex(message.records, message.config);
    worker.postMessage({ type: "ready" });
    return;
  }
  // A query that arrives before the index is built is ignored — the main thread
  // is still serving exact/substring matches until it sees `ready`.
  if (message.type === "query" && index) {
    const result = index.searchDetailed(message.query);
    worker.postMessage({
      type: "result",
      seq: message.seq,
      query: message.query,
      ids: result === null ? null : [...result.ids],
      // Map/Set survive structured clone, so the matched-token detail rides along
      // unchanged — no serialization needed.
      tokens: result === null ? null : result.tokens,
    });
  }
});
