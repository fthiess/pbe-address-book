export type ContentEncoding = "br" | "gzip" | "identity";

/**
 * Choose the response encoding from a request's `Accept-Encoding`, preferring
 * brotli (the best ratio for the slow-connection cohort — D84) over gzip and
 * falling back to identity when neither is offered.
 *
 * Deliberately small: it reads the advertised tokens and ignores q-values. Book
 * always has both a brotli and a gzip buffer ready, so there is no cost model to
 * weigh — only "does the client accept br, else gzip, else send it plain."
 */
export function negotiateEncoding(acceptEncoding: string | undefined): ContentEncoding {
  if (!acceptEncoding) {
    return "identity";
  }
  const tokens = new Set(
    acceptEncoding
      .toLowerCase()
      .split(",")
      .map((part) => part.split(";")[0]?.trim() ?? ""),
  );
  if (tokens.has("br")) {
    return "br";
  }
  if (tokens.has("gzip")) {
    return "gzip";
  }
  return "identity";
}
