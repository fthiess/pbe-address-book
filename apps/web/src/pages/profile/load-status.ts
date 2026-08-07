/**
 * How a failed record read becomes a Profile-page state (D168, OFC-392).
 *
 * The two dead ends are distinct facts about the world and now arrive as distinct
 * statuses: `404` is "no such record", `403` is "withheld from you" (the
 * single-record consequence of a whole-record hide, D124/D115). They used to
 * share one `404` and one catch-all sentence, which reads as a broken link — that
 * is precisely what a UAT tester reported after clicking through to an unlisted
 * Big Brother.
 *
 * Everything else is a genuine failure (offline, a cold instance that never woke,
 * a 500) and must keep the retryable message: mapping an unknown status onto
 * either dead end would tell the reader a record is missing or private when the
 * truth is that we never found out.
 */
export type LoadStatus = "notfound" | "private" | "error";

export function statusFor(httpStatus: number): LoadStatus {
  switch (httpStatus) {
    case 404:
      return "notfound";
    case 403:
      return "private";
    default:
      return "error";
  }
}
