import type { FastifyRequest } from "fastify";

/**
 * Extract the Cloud Run request-correlation id from `X-Cloud-Trace-Context`
 * (D99/R9), so the audit lines a single request emits share one `trace` id. The
 * header is `TRACE_ID/SPAN_ID;o=…`; only the trace id before the slash is kept.
 * Returns undefined when the header is absent (local dev, tests).
 */
export function traceId(request: FastifyRequest): string | undefined {
  const header = request.headers["x-cloud-trace-context"];
  if (typeof header !== "string") {
    return undefined;
  }
  const id = header.split("/")[0] ?? "";
  return id.length > 0 ? id : undefined;
}
