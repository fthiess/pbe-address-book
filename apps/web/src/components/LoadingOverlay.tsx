/** How long a wait must run before the overlay appears at all (D119). */
export const OVERLAY_DELAY_MS = 500;

/**
 * How long a wait must run before the overlay adds its reassurance line (D119's
 * "if the wait runs longer (~3–4 s)"). Both thresholds are measured from the same
 * moment — the start of the wait — not chained one after the other.
 */
export const REASSURANCE_DELAY_MS = 3500;

/**
 * Past this threshold a sleeping backend is the likeliest explanation, so the
 * overlay may say so. Cloud Run scales to zero (D83), and the SPA outlives the
 * instance: a tab left open past the idle window has a loaded app and a shut-down
 * server, so the next read really does wake it. Used wherever the payload is small
 * enough that a multi-second wait cannot plausibly be transfer time.
 */
export const WAKE_REASSURANCE = "Waking the server — this can take a few seconds.";

/**
 * The neutral escalation, for waits whose cause we cannot honestly name — notably
 * the ~1 MB bulk roster, where a long wait may be a cold instance or may simply be
 * a large transfer. It deliberately says nothing about the reader's connection:
 * most brothers are on fast links, and an app that implies otherwise is both wrong
 * and irritating (Forrest's call, Stage 1.3).
 */
export const STILL_LOADING_REASSURANCE = "Still loading…";

/**
 * The threshold-gated loading overlay (D119; COMPONENTS "Loading overlay"). Shown
 * only past a short delay — the caller gates it with `useDelayedFlag` — so the warm
 * path never flashes it. The spinner is disabled under `prefers-reduced-motion`.
 *
 * ## Why the reassurance line is the caller's to supply and to time
 *
 * D119 specifies **two** thresholds: the overlay at ~500 ms, and the reassurance
 * line only "if the wait runs longer (~3–4 s)". The original component rendered the
 * line unconditionally the moment the overlay did, so every wait past half a second
 * announced that the server was asleep — at all three call sites, on a warm
 * instance, on every throttled load. 7b-1 measured exactly that (N134/OFC-324): the
 * cold run was indistinguishable from the warm ones.
 *
 * The line is therefore opt-in and separately gated. Which line is right depends on
 * what is being waited for, which only the caller knows — see the two exported
 * constants.
 *
 * ## Why `invisible` rather than transparent, and why it is rendered early
 *
 * When `reassurance` is supplied the line is **always in the layout**, merely
 * invisible until `showReassurance`. Two reasons, both load-bearing:
 *
 * - Reserving its height means the card cannot resize when the line arrives. Both
 *   main pages already sit above the CLS "good" threshold (OFC-325) and this must
 *   not add to it.
 * - `visibility: hidden` (Tailwind's `invisible`) takes the text out of the
 *   accessibility tree. Mere transparency would not: this overlay is an `<output>`,
 *   an implicit `aria-live="polite"` region, so a transparent line would be
 *   announced to a screen-reader user three seconds before any sighted reader sees
 *   it — the opposite of the escalation the threshold exists to create.
 */
export function LoadingOverlay({
  label = "Loading…",
  reassurance,
  showReassurance = false,
}: {
  label?: string;
  reassurance?: string;
  showReassurance?: boolean;
}) {
  return (
    // <output> carries an implicit ARIA "status" role — a polite live region
    // that announces the wait to assistive tech without stealing focus.
    <output
      aria-live="polite"
      className="fixed inset-0 z-50 grid place-items-center bg-muted/60 backdrop-blur-sm"
    >
      <span className="flex flex-col items-center gap-3 rounded-2xl bg-card px-8 py-7 text-card-foreground shadow-lg">
        <span
          aria-hidden="true"
          className="size-9 animate-spin rounded-full border-[3px] border-secondary border-t-primary motion-reduce:animate-none"
        />
        <span className="text-sm font-medium">{label}</span>
        {reassurance ? (
          <span
            className={`max-w-[14rem] text-center text-xs text-muted-foreground${
              showReassurance ? "" : " invisible"
            }`}
          >
            {reassurance}
          </span>
        ) : null}
      </span>
    </output>
  );
}
