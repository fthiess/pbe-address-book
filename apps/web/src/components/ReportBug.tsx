import { MAX_BUG_REPORT_DESCRIPTION } from "@pbe/shared";
import { Bug } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { fileBugReport } from "../lib/api.js";
import { collectClientContext } from "../lib/clientContext.js";
import { APP_VERSION } from "../lib/version.js";
import { ModalDialog } from "./ModalDialog.js";

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "done" }
  | { phase: "error"; message: string };

/**
 * The masthead **"Report a bug"** control (D121; visual-design Shell). Book is a
 * members-only app with no email, so a brother reports a problem here: the report
 * is stored for an admin to review, copy, and clear — there is no outbound mail
 * and no bug-tracker integration.
 *
 * The dialog is the shared {@link ModalDialog} (native `<dialog>`), so focus-trap,
 * Escape, and page-inerting come from the platform. The route, absolute URL, and
 * non-PII client context (user agent, viewport, build) are captured automatically
 * so the reporter only writes a description.
 */
export function ReportBug() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to the trigger, the element that had it before the dialog opened.
    triggerRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* `sr-only` (not `hidden`) keeps the label in the accessibility tree on a
            phone, where the button is icon-only, so it always has a discernible name
            (WCAG 4.1.2). It becomes a visible inline label from `sm` up. The bug glyph
            trails the label — mirroring the neighbouring "PBE News ↗" link's trailing
            external-link icon, so the two masthead links read consistently. */}
        <span className="sr-only sm:not-sr-only">Report a bug</span>
        <Bug size={15} aria-hidden="true" />
      </button>
      {open && <ReportBugDialog onClose={close} />}
    </>
  );
}

function ReportBugDialog({ onClose }: { onClose: () => void }) {
  const location = useLocation();
  const [description, setDescription] = useState("");
  const [state, setState] = useState<SubmitState>({ phase: "idle" });
  // A synchronous in-flight latch: `canSubmit` is read from the render closure, so
  // a rapid double-activation of Send could fire twice before the button re-renders
  // disabled — this ref blocks the second call and files exactly one report.
  const submittingRef = useRef(false);
  const titleId = useId();
  const descId = useId();

  const trimmed = description.trim();
  const tooLong = description.length > MAX_BUG_REPORT_DESCRIPTION;
  const canSubmit = trimmed !== "" && !tooLong && state.phase !== "submitting";

  async function submit() {
    if (!canSubmit || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setState({ phase: "submitting" });
    try {
      const result = await fileBugReport({
        // The route (path + query + hash) and the absolute URL, so an admin sees
        // exactly where the report was filed from.
        page: `${location.pathname}${location.search}${location.hash}`,
        url: window.location.href,
        description: trimmed,
        // Best-effort device / OS / browser / network / web-version capture.
        clientContext: await collectClientContext(APP_VERSION),
      });
      if (result.status === "rate_limited") {
        setState({
          phase: "error",
          message: "You've sent several reports just now — please wait a moment and try again.",
        });
        return;
      }
      setState({ phase: "done" });
    } catch {
      // A 401 here no longer reaches this branch — the app-wide interceptor flips to
      // the sign-in screen and unmounts this dialog first (OFC-193/D109). What's left
      // is the genuine "send failed" case.
      setState({
        phase: "error",
        message: "Something went wrong sending your report. Please try again.",
      });
    } finally {
      // Released so the user can retry after an error; on success the form unmounts.
      submittingRef.current = false;
    }
  }

  return (
    <ModalDialog
      labelledBy={titleId}
      describedBy={descId}
      onClose={onClose}
      className="max-w-md p-6"
    >
      {state.phase === "done" ? (
        // `<output>` is a live region (role="status"), so assistive tech announces
        // the confirmation; the Close button auto-focuses so keyboard focus lands
        // somewhere sensible after the form (which held focus) unmounts.
        <output className="block">
          <h2 id={titleId} className="text-lg font-bold tracking-tight">
            Thanks — report sent
          </h2>
          <p id={descId} className="mt-2 text-sm text-muted-foreground">
            An administrator will see your report. There's nothing more you need to do.
          </p>
          <div className="mt-5 flex justify-end">
            <button
              // biome-ignore lint/a11y/noAutofocus: focus must move off the now-unmounted form to the dialog's remaining control (WCAG 2.2 AA focus management).
              autoFocus
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Close
            </button>
          </div>
        </output>
      ) : (
        <div>
          <h2 id={titleId} className="text-lg font-bold tracking-tight">
            Report a bug
          </h2>
          <p id={descId} className="mt-2 text-sm text-muted-foreground">
            This goes straight to the site administrators. The more you can tell us, the easier it
            is to fix.
          </p>

          <label htmlFor={`${titleId}-text`} className="mt-4 block text-sm font-medium">
            What happened? If you can, tell us how to make it happen again.
          </label>
          <textarea
            // biome-ignore lint/a11y/noAutofocus: the platform focuses this field when the modal opens (expected for a single-purpose dialog); WCAG 2.2 AA is satisfied.
            autoFocus
            id={`${titleId}-text`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            aria-describedby={`${titleId}-count`}
            className="mt-1 w-full resize-y rounded-lg border border-input bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="e.g. On my iPhone I tapped the star next to a brother's name and expected it to fill in, but nothing changed until I reloaded the page."
          />
          <p
            id={`${titleId}-count`}
            className={`mt-1 text-xs ${tooLong ? "text-destructive" : "text-muted-foreground"}`}
          >
            {description.length} / {MAX_BUG_REPORT_DESCRIPTION}
          </p>

          {state.phase === "error" && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {state.phase === "submitting" ? "Sending…" : "Send report"}
            </button>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
