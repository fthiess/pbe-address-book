import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "../../lib/utils.js";

/**
 * A small accessible confirmation modal (COMPONENTS.md "Confirmation dialogs").
 * Built on the native `<dialog>` element via `showModal()`, so the focus trap,
 * Escape-to-cancel, and focus-return-to-opener are the platform's — backdrop
 * click cancels too. 4a uses the neutral/destructive tones for the discard
 * prompt; the soft / deliberate tones (mark-deceased, de-brother) build on this
 * in 4c.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Keep editing",
  tone = "neutral",
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "neutral" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = "confirm-dialog-title";
  const bodyId = "confirm-dialog-body";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      confirmRef.current?.focus();
    }
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only implements backdrop-click dismissal (a pointer convenience); the keyboard path is the native <dialog> Escape → onCancel, so all functionality stays keyboard-reachable.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onCancel();
        }
      }}
      className="m-auto w-full max-w-md rounded-[var(--radius-xl)] border border-border bg-card p-6 text-card-foreground shadow-[var(--shadow-modal)] backdrop:bg-black/40"
    >
      <h2 id={titleId} className="text-[length:var(--text-h4)] font-bold">
        {title}
      </h2>
      <div id={bodyId} className="mt-2 text-[length:var(--text-body)] text-muted-foreground">
        {children}
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius-md)] border border-input bg-card px-4 py-2.5 text-[length:var(--text-label)] font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className={cn(
            "rounded-[var(--radius-md)] px-4 py-2.5 text-[length:var(--text-label)] font-semibold text-white outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring",
            tone === "destructive" ? "bg-destructive" : "bg-primary",
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
