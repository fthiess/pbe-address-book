/**
 * The system-banner severities (D117). The single source of the severity
 * vocabulary — the server's write-validation set, the admin toggle's options, and
 * every `severity` union across the API and SPA all derive from this tuple, so a
 * new severity (e.g. `critical`) is a one-line change here rather than a five-file
 * edit that risks the server accepting a value the client can't render (OFC-186).
 * Mirrors the roles pattern.
 */
export const BANNER_SEVERITIES = ["info", "warning"] as const;

export type BannerSeverity = (typeof BANNER_SEVERITIES)[number];
