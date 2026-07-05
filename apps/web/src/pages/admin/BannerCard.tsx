import { getHelpEntry } from "@pbe/help-content";
import { useEffect, useState } from "react";
import { useBanner } from "../../auth/BannerContext.js";
import { SystemBanner } from "../../components/SystemBanner.js";
import { saveBanner } from "../../lib/api.js";
import { cn } from "../../lib/utils.js";
import { ADMIN_BTN_PRIMARY, ADMIN_BTN_SECONDARY, AdminCard, MegaphoneIcon } from "./AdminCard.js";

/** The banner message cap — mirrors the server's MAX_BANNER_MESSAGE (routes/banner.ts). */
const MAX_MESSAGE = 500;

type Severity = "info" | "warning";
const SEVERITIES: { value: Severity; label: string }[] = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
];

/**
 * The system-message banner control (PRD §5.8; D117): compose a message, pick a
 * severity, preview it, and Set or Clear it site-wide. Reads/writes the shared
 * {@link useBanner} context so the masthead banner updates the moment an admin
 * sets or clears it — no reload. The banner persists until cleared (not per-user
 * dismissible).
 */
export function BannerCard() {
  const { banner, refresh } = useBanner();
  const msgHelp = getHelpEntry("admin.banner.message");
  const sevHelp = getHelpEntry("admin.banner.severity");

  const [message, setMessage] = useState(banner?.message ?? "");
  const [severity, setSeverity] = useState<Severity>(banner?.severity ?? "info");
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<"none" | "saved" | "cleared" | "error">("none");

  // Seed the form from a live banner once it loads — but never over an admin's own
  // in-progress edit (guarded by `touched`), so re-fetches can't clobber typing.
  useEffect(() => {
    if (!touched && banner) {
      setMessage(banner.message);
      setSeverity(banner.severity);
    }
  }, [banner, touched]);

  const edit = (fn: () => void) => {
    setTouched(true);
    setFeedback("none");
    fn();
  };

  const onSet = async () => {
    const trimmed = message.trim();
    if (trimmed === "") {
      return;
    }
    setPending(true);
    try {
      await saveBanner({ active: true, message: trimmed, severity });
      await refresh();
      setFeedback("saved");
    } catch {
      setFeedback("error");
    } finally {
      setPending(false);
    }
  };

  const onClear = async () => {
    setPending(true);
    try {
      await saveBanner({ active: false });
      await refresh();
      setMessage("");
      setSeverity("info");
      setTouched(false);
      setFeedback("cleared");
    } catch {
      setFeedback("error");
    } finally {
      setPending(false);
    }
  };

  const previewMessage = message.trim() || "Your message will appear here.";

  return (
    <AdminCard
      icon={<MegaphoneIcon />}
      title="System message banner"
      description="A full-width message shown above the masthead to everyone, until you clear it. Use for maintenance notices and announcements."
    >
      <div className="mt-5">
        <label
          htmlFor="banner-message"
          className="block text-[length:var(--text-label)] font-semibold"
        >
          {msgHelp?.label ?? "Message"}
        </label>
        <textarea
          id="banner-message"
          aria-describedby="banner-message-help"
          value={message}
          onChange={(event) => edit(() => setMessage(event.target.value))}
          rows={2}
          maxLength={MAX_MESSAGE}
          placeholder={msgHelp?.placeholder}
          className="mt-2 w-full rounded-[var(--radius-md)] border border-input bg-background px-3 py-2 text-[length:var(--text-body)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {msgHelp?.helperText && (
          <p
            id="banner-message-help"
            className="mt-1 text-[length:var(--text-body-sm)] text-muted-foreground"
          >
            {msgHelp.helperText}
          </p>
        )}
      </div>

      <fieldset className="m-0 mt-4 border-0 p-0">
        <legend className="text-[length:var(--text-label)] font-semibold">
          {sevHelp?.label ?? "Severity"}
        </legend>
        <div className="mt-2 inline-flex gap-2">
          {SEVERITIES.map((option) => {
            const active = severity === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => edit(() => setSeverity(option.value))}
                className={cn(
                  "rounded-[var(--radius-md)] border px-4 py-2 text-[length:var(--text-label)] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary text-primary ring-2 ring-ring"
                    : "border-input text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {sevHelp?.helperText && (
          <p className="mt-1 text-[length:var(--text-body-sm)] text-muted-foreground">
            {sevHelp.helperText}
          </p>
        )}
      </fieldset>

      <div className="mt-5">
        <p className="text-[length:var(--text-label-up)] font-semibold uppercase tracking-wide text-muted-foreground">
          Preview
        </p>
        <div className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-border">
          <SystemBanner banner={{ message: previewMessage, severity }} />
          <div className="bg-muted px-4 py-2 text-[length:var(--text-caption)] text-muted-foreground">
            — the rest of the app, below the banner —
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSet}
          disabled={pending || message.trim() === ""}
          className={ADMIN_BTN_PRIMARY}
        >
          Set banner
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={pending || !banner}
          className={ADMIN_BTN_SECONDARY}
        >
          Clear current banner
        </button>
        <div className="flex-1" />
        {banner && (
          <span className="flex items-center gap-2 text-[length:var(--text-body-sm)] text-primary">
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />A banner is
            currently live
          </span>
        )}
      </div>

      <output className="mt-3 block min-h-5 text-[length:var(--text-body-sm)]">
        {feedback === "saved" && (
          <span className="text-primary">Banner set. It's now live for everyone.</span>
        )}
        {feedback === "cleared" && <span className="text-muted-foreground">Banner cleared.</span>}
        {feedback === "error" && (
          <span className="text-destructive">Something went wrong. Please try again.</span>
        )}
      </output>
    </AdminCard>
  );
}
