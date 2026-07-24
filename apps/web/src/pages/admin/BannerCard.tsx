import { getHelpEntry } from "@pbe/help-content";
import { BANNER_SEVERITIES, type BannerSeverity } from "@pbe/shared";
import { useState } from "react";
import { useBanner } from "../../auth/BannerContext.js";
import { type Banner, SystemBanner } from "../../components/SystemBanner.js";
import { trackSystemBannerChanged } from "../../lib/analytics.js";
import { saveBanner } from "../../lib/api.js";
import { cn } from "../../lib/utils.js";
import { ADMIN_BTN_PRIMARY, ADMIN_BTN_SECONDARY, AdminCard, MegaphoneIcon } from "./AdminCard.js";

/** The banner message cap — mirrors the server's MAX_BANNER_MESSAGE (routes/banner.ts). */
const MAX_MESSAGE = 500;

type Feedback = "none" | "saved" | "cleared" | "error";

/**
 * The system-message banner control (PRD §5.8; D117): compose a message, pick a
 * severity, preview it, and Set or Clear it site-wide. Reads/writes the shared
 * {@link useBanner} context so the masthead banner updates the moment an admin sets
 * or clears it — no reload.
 *
 * The write state (`pending`/`feedback`) lives here so it survives the form's
 * remount; the editable draft lives in {@link BannerForm}, which is keyed on the
 * server banner's identity so it reseeds from truth when the banner changes (after
 * a set/clear, or when a retry newly learns a live banner) — no copy-into-state
 * effect (OFC-187). A **read failure** is surfaced as a retryable error with the
 * Clear affordance still enabled, so a transient blip can't strand a live banner
 * (OFC-183).
 */
export function BannerCard() {
  const { banner, status, refresh } = useBanner();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>("none");

  const runWrite = async (write: () => Promise<unknown>, ok: Feedback) => {
    setPending(true);
    try {
      await write();
      await refresh();
      setFeedback(ok);
    } catch {
      setFeedback("error");
    } finally {
      setPending(false);
    }
  };

  const onSet = (message: string, severity: BannerSeverity) =>
    runWrite(async () => {
      const trimmed = message.trim();
      await saveBanner({ active: true, message: trimmed, severity });
      // Public broadcast copy, not brother PII (D117) — captured on success only.
      trackSystemBannerChanged(true, severity, trimmed);
    }, "saved");
  const onClear = () =>
    runWrite(async () => {
      await saveBanner({ active: false });
      trackSystemBannerChanged(false);
    }, "cleared");

  return (
    <AdminCard
      icon={<MegaphoneIcon />}
      title="System message banner"
      description="A full-width message shown above the masthead to everyone, until you clear it. Use for maintenance notices and announcements."
    >
      {status === "loading" ? (
        <p className="mt-5 text-[length:var(--text-body-sm)] text-muted-foreground">
          Checking the current banner…
        </p>
      ) : (
        <>
          {status === "error" && (
            <div
              role="alert"
              className="mt-5 rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/10 px-4 py-3 text-[length:var(--text-body-sm)]"
            >
              We couldn't check the current banner just now.{" "}
              <button
                type="button"
                onClick={() => void refresh()}
                className="font-semibold underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Try again
              </button>
              . You can still set a new banner or clear the current one below.
            </div>
          )}
          <BannerForm
            key={banner ? `${banner.severity}:${banner.message}` : "none"}
            initial={banner}
            live={banner}
            readFailed={status === "error"}
            pending={pending}
            onSet={onSet}
            onClear={onClear}
            onEdit={() => setFeedback("none")}
          />
          <output className="mt-3 block min-h-5 text-[length:var(--text-body-sm)]">
            {feedback === "saved" && (
              <span className="text-primary">Banner set. It's now live for everyone.</span>
            )}
            {feedback === "cleared" && (
              <span className="text-muted-foreground">Banner cleared.</span>
            )}
            {feedback === "error" && (
              <span className="text-destructive">Something went wrong. Please try again.</span>
            )}
          </output>
        </>
      )}
    </AdminCard>
  );
}

/**
 * The editable banner draft. Seeds `message`/`severity` from `initial` on mount
 * only — the parent remounts it (via `key`) when the server banner changes, so
 * there is no seed effect or `touched` latch (OFC-187). `live` is the current
 * server banner (drives the "currently live" indicator + Clear-enable); `pending`
 * disables the controls during a write.
 */
function BannerForm({
  initial,
  live,
  readFailed,
  pending,
  onSet,
  onClear,
  onEdit,
}: {
  initial: Banner | null;
  live: Banner | null;
  readFailed: boolean;
  pending: boolean;
  onSet: (message: string, severity: BannerSeverity) => void;
  onClear: () => void;
  onEdit: () => void;
}) {
  const msgHelp = getHelpEntry("admin.banner.message");
  const sevHelp = getHelpEntry("admin.banner.severity");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [severity, setSeverity] = useState<BannerSeverity>(initial?.severity ?? "info");

  // Any edit clears the parent's "Banner set/cleared" confirmation.
  const edit = (fn: () => void) => {
    onEdit();
    fn();
  };

  const trimmed = message.trim();
  // Clear is available whenever a banner might be live: confirmed live, OR the read
  // failed so we can't be sure (the server clear is idempotent and safe) — OFC-183.
  const clearDisabled = pending || (!readFailed && !live);

  return (
    <>
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
          {BANNER_SEVERITIES.map((value) => {
            const active = severity === value;
            const label = value.charAt(0).toUpperCase() + value.slice(1);
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => edit(() => setSeverity(value))}
                className={cn(
                  "rounded-[var(--radius-md)] border px-4 py-2 text-[length:var(--text-label)] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary text-primary ring-2 ring-ring"
                    : "border-input text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
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
          {/* Muted until there's real text, so choosing "Warning" before typing does
              not flash a red bar that reads as an imminent live warning (OFC-187). */}
          {trimmed ? (
            <SystemBanner banner={{ message: trimmed, severity }} />
          ) : (
            <div className="bg-muted px-4 py-2 text-center text-[length:var(--text-body-sm)] text-muted-foreground">
              Your message will appear here.
            </div>
          )}
          <div className="bg-card px-4 py-2 text-[length:var(--text-caption)] text-muted-foreground">
            — the rest of the app, below the banner —
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onSet(message, severity)}
          disabled={pending || trimmed === ""}
          className={ADMIN_BTN_PRIMARY}
        >
          Set banner
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={clearDisabled}
          className={ADMIN_BTN_SECONDARY}
        >
          Clear current banner
        </button>
        <div className="flex-1" />
        {live && (
          <span className="flex items-center gap-2 text-[length:var(--text-body-sm)] text-primary">
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />A banner is
            currently live
          </span>
        )}
      </div>
    </>
  );
}
