/**
 * The threshold-gated cold-start loading overlay (D119; COMPONENTS "Loading
 * overlay"). Shown only past a short delay — the caller gates it with
 * `useDelayedFlag` — so the warm path never flashes it. The copy reassures
 * rather than alarms: a slow first response is the scale-to-zero instance
 * waking, not a failure. The spinner is disabled under `prefers-reduced-motion`.
 */
export function LoadingOverlay({ label = "Loading…" }: { label?: string }) {
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
        <span className="max-w-[14rem] text-center text-xs text-muted-foreground">
          Waking the server — this can take a few seconds.
        </span>
      </span>
    </output>
  );
}
