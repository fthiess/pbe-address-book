import { MAX_BUG_REPORT_DESCRIPTION } from "@pbe/shared";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, fileBugReport } from "../lib/api.js";

/** The SPA build id (injected by Vite `define`); "dev" when unset or under a bare test runner. */
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

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
 * Opens the native `<dialog>` element in modal mode, which gives the accessibility
 * for free — focus moves inside, Tab is trapped, Escape closes, and the rest of the
 * page is inert (WCAG 2.2 AA) — with no hand-rolled focus machinery. Focus returns
 * to the trigger on close. The route, absolute URL, and non-PII client context
 * (user agent, viewport, build) are captured automatically so the reporter only
 * writes a description.
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
        <BugIcon />
        <span className="hidden sm:inline">Report a bug</span>
      </button>
      {open && <ReportBugDialog onClose={close} />}
    </>
  );
}

function ReportBugDialog({ onClose }: { onClose: () => void }) {
  const location = useLocation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [description, setDescription] = useState("");
  const [state, setState] = useState<SubmitState>({ phase: "idle" });
  const titleId = useId();
  const descId = useId();

  // Open the dialog in modal mode on mount; close on Escape (the native `cancel`
  // event) or a click on the backdrop. jsdom lacks `showModal`, so fall back to the
  // `open` attribute there — the same markup renders for unit tests.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    try {
      dialog.showModal();
    } catch {
      dialog.open = true;
    }
    textareaRef.current?.focus();
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const onClick = (event: MouseEvent) => {
      // A click whose target is the dialog element itself landed on the backdrop
      // (the content is a child), so treat it as a request to dismiss.
      if (event.target === dialog) {
        onClose();
      }
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("click", onClick);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("click", onClick);
    };
  }, [onClose]);

  const trimmed = description.trim();
  const tooLong = description.length > MAX_BUG_REPORT_DESCRIPTION;
  const canSubmit = trimmed !== "" && !tooLong && state.phase !== "submitting";

  async function submit() {
    if (!canSubmit) {
      return;
    }
    setState({ phase: "submitting" });
    try {
      const result = await fileBugReport({
        // The route (path + query + hash) and the absolute URL, so an admin sees
        // exactly where the report was filed from.
        page: `${location.pathname}${location.search}${location.hash}`,
        url: window.location.href,
        description: trimmed,
        clientContext: {
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          appVersion: APP_VERSION,
        },
      });
      if (result.status === "rate_limited") {
        setState({
          phase: "error",
          message: "You've sent several reports just now — please wait a moment and try again.",
        });
        return;
      }
      setState({ phase: "done" });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 401
          ? "Your session has expired. Please sign in again to send this report."
          : "Something went wrong sending your report. Please try again.";
      setState({ phase: "error", message });
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="m-auto w-full max-w-md rounded-xl border border-border bg-card p-5 text-card-foreground shadow-lg backdrop:bg-black/40"
    >
      {state.phase === "done" ? (
        <div>
          <h2 id={titleId} className="text-lg font-bold tracking-tight">
            Thanks — report sent
          </h2>
          <p id={descId} className="mt-2 text-sm text-muted-foreground">
            An administrator will see your report. There's nothing more you need to do.
          </p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <div>
          <h2 id={titleId} className="text-lg font-bold tracking-tight">
            Report a bug
          </h2>
          <p id={descId} className="mt-2 text-sm text-muted-foreground">
            Tell us what went wrong or looked off. This goes to the site administrators — we don't
            send email, so this is the way to reach them.
          </p>

          <label htmlFor={`${titleId}-text`} className="mt-4 block text-sm font-medium">
            What happened?
          </label>
          <textarea
            id={`${titleId}-text`}
            ref={textareaRef}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            aria-describedby={`${titleId}-count`}
            className="mt-1 w-full resize-y rounded-lg border border-input bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="e.g. The star column didn't update when I tapped it on my iPad."
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
    </dialog>
  );
}

function BugIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 6a4 4 0 0 1 8 0M3 12h3M18 12h3M4.5 7.5l2 1.5M19.5 7.5l-2 1.5M4.5 17.5l2-1.5M19.5 17.5l-2-1.5" />
      <rect x="8" y="6" width="8" height="12" rx="4" />
      <path d="M12 10v6" />
    </svg>
  );
}
