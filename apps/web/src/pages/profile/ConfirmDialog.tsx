import type { ReactNode } from "react";
import { ModalDialog } from "../../components/ModalDialog.js";
import { cn } from "../../lib/utils.js";

/**
 * A small accessible confirmation modal (COMPONENTS.md "Confirmation dialogs").
 * Built on the shared {@link ModalDialog} native-`<dialog>` shell, so the focus
 * trap, Escape-to-cancel, focus-return-to-opener, and backdrop-click-cancel are
 * the platform's. 4a uses the neutral/destructive tones for the discard prompt;
 * the soft / deliberate tones (mark-deceased, de-brother) build on this in 4c.
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
  const titleId = "confirm-dialog-title";
  const bodyId = "confirm-dialog-body";

  return (
    <ModalDialog
      labelledBy={titleId}
      describedBy={bodyId}
      onClose={onCancel}
      className="max-w-md p-6"
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
          // biome-ignore lint/a11y/noAutofocus: the platform modal focuses its primary action on open; the confirm button is the deliberate initial target (WCAG 2.2 AA).
          autoFocus
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
    </ModalDialog>
  );
}
