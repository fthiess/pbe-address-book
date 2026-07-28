import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "../lib/utils.js";

/**
 * The shared accessible modal shell, built on the native `<dialog>` element via
 * `showModal()` — so the focus trap, Escape-to-close, and page inerting are the
 * platform's, not hand-rolled (WCAG 2.2 AA, D79). Backdrop click closes too.
 * Initial focus follows the platform: mark the element that should receive it with
 * `autoFocus`.
 *
 * ⚠ **Focus return is this component's job, not the platform's.** The browser
 * restores focus to the opener when a dialog is closed via `close()` — but every
 * caller here closes by *unmounting* the shell, which fires no `close()`, so the
 * platform's restoration never runs. Worse, a caller cannot paper over it from
 * outside: while the modal is up the rest of the page is inert, so an opener
 * `focus()` in the same tick as the close is silently dropped (measured — it is
 * what OFC-353 hit, and the "Report a bug" dialog had been losing focus to `body`
 * on every close since 5a-2 for exactly this reason). So the shell captures the
 * focused element on open and restores it on unmount, after the dialog is gone.
 *
 * The one shell every Book modal builds on ({@link ConfirmDialog}, the bug-report
 * filing dialog), so the a11y-critical wiring lives in exactly one place and can't
 * drift between copies. Callers supply the aria ids, an `onClose` (fired by Escape
 * and backdrop click), sizing/padding via `className`, and the body as children.
 *
 * jsdom has no `showModal`, so we fall back to the `open` attribute there — the
 * same markup renders under a bare test runner.
 */
export function ModalDialog({
  labelledBy,
  describedBy,
  onClose,
  className,
  children,
}: {
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    // Capture the opener only when we are the ones opening the dialog — hence the
    // `!dialog.open` guard around the capture, not merely around `showModal()`.
    // ⚠ StrictMode re-runs this effect in development (mount → cleanup → mount)
    // *without* unmounting the <dialog>, and by the second run focus has already
    // moved to the dialog's own autofocused control; re-capturing there would
    // record that control as the "opener" and lose the real one, so focus return
    // would work in production and silently not in dev — the worst split, since dev
    // is where anyone would check it by hand.
    if (dialog && !dialog.open) {
      // Read before `showModal()` moves focus: this is the element the reader left.
      openerRef.current = document.activeElement;
      try {
        dialog.showModal();
      } catch {
        dialog.open = true;
      }
    }
    // Registered on every run, including StrictMode's second: the cleanup from the
    // first run has already been spent by then, so returning early instead would
    // leave the real unmount with nothing to restore focus with.
    return () => {
      const opener = openerRef.current;
      // `isConnected`: an action that removes its own opener (a delete that
      // navigates away) restores nothing rather than chasing a detached node.
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only implements backdrop-click dismissal (a pointer convenience); the keyboard path is the native <dialog> Escape → onClose, so all functionality stays keyboard-reachable.
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
      className={cn(
        "m-auto w-full rounded-[var(--radius-xl)] border border-border bg-card text-card-foreground shadow-[var(--shadow-modal)] backdrop:bg-black/40",
        className,
      )}
    >
      {children}
    </dialog>
  );
}
