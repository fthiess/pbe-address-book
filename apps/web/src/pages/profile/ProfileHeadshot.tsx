import { HEADSHOT_SIZE, headshotObjectKey, imageUrl } from "@pbe/shared";
import { useCallback, useEffect, useId, useState } from "react";
import { Avatar } from "../../components/Avatar.js";
import { DebrotheredMark } from "../../components/DebrotheredMark.js";
import { ModalDialog } from "../../components/ModalDialog.js";
import { MourningBand } from "../../components/MourningBand.js";
import { useReauthSignal } from "../../lib/reauthSignal.js";
import type { ProfileRecord } from "../../lib/types.js";
import { cn } from "../../lib/utils.js";

/**
 * The Profile page headshot — the full 512² WEBP from the private bucket (D126),
 * falling back to the initials/silhouette avatar when there is no headshot or it
 * fails to load (the same degrade-don't-break contract as the Directory
 * thumbnail). A deceased brother's image (real photo or avatar fallback) carries
 * the diagonal **mourning band** and a memorial accessible name — the In Memoriam
 * treatment over a real headshot lands in 4c-1 alongside the upload pipeline.
 *
 * Display-only. The crop-and-upload editor is {@link HeadshotEditor}, which uses
 * this for its "current photo" preview.
 */

/**
 * The **responsive** headshot size used on the Profile page (N35): larger on
 * desktop, smaller on mobile. It sets a `--headshot-size` CSS variable at the
 * `sm` breakpoint, which both the `<img>` and the `Avatar` fallback read, so the
 * two size identically. The stored image is always the full 512² WEBP; only the
 * rendered box changes.
 */
export const PROFILE_HEADSHOT_RESPONSIVE = "[--headshot-size:96px] sm:[--headshot-size:132px]";

/** The `/img/*` headshot URL for a record, or null when there is nothing to show. */
export function headshotUrl(record: ProfileRecord): string | null {
  return record.hasHeadshot && record.headshotVersion
    ? imageUrl(headshotObjectKey(record.id, record.headshotVersion))
    : null;
}

export function ProfileHeadshot({
  record,
  name,
  size = 120,
  responsive = false,
  enlargeable = false,
}: {
  record: ProfileRecord;
  name: string;
  size?: number;
  /** Size responsively (96² mobile → 132² desktop) instead of the fixed `size`. */
  responsive?: boolean;
  /**
   * Make the photo click/keyboard-openable into the full 512² view (OFC-353).
   * Off by default — the editor's "current photo" preview is not a viewer, and a
   * brother with no headshot has nothing to enlarge, so the affordance appears
   * only where there is a real photo to show.
   */
  enlargeable?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const deceased = record.deceased?.isDeceased === true;
  const debrothered = record.debrothered?.isDebrothered === true;
  const url = headshotUrl(record);
  const reauthNonce = useReauthSignal();
  // Re-arm the image load when the URL changes (OFC-128): a new `headshotVersion` (or
  // a fresh record) must retry, not stick on the avatar after a transient error — and
  // on a completed re-auth (OFC-236/D109), so a headshot that 401'd during a session
  // lapse reloads under the restored cookie.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on `url`/re-auth change is the intent; the body reads no deps.
  useEffect(() => setFailed(false), [url, reauthNonce]);
  const alt = deceased ? `${name} — In Memoriam` : name;
  const dim = responsive ? "var(--headshot-size)" : `${size}px`;
  const responsiveClass = responsive ? PROFILE_HEADSHOT_RESPONSIVE : undefined;
  // Only a real, loaded photo can be enlarged: the avatar fallback is generated at
  // the size it is drawn, so there is no larger version of it to show.
  const canEnlarge = enlargeable && url !== null && !failed;

  // Closing simply unmounts the dialog; ModalDialog restores focus to this button
  // itself, after the dialog is gone (see its note on focus return).
  const close = useCallback(() => setEnlarged(false), []);

  // A round, clipping container so the mourning band (a full chord, wider than the
  // circle) is clipped to the rim over both the real photo and the avatar fallback.
  const figure = (
    <span
      className={cn("relative inline-block shrink-0 overflow-hidden rounded-full", responsiveClass)}
      style={{ width: dim, height: dim }}
    >
      {url && !failed ? (
        <img
          src={url}
          // Inside the enlarge button the button carries the accessible name, so
          // the image must not repeat it.
          alt={canEnlarge ? "" : alt}
          width={size}
          height={size}
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full rounded-full object-cover"
          style={{ boxShadow: "var(--shadow-avatar)" }}
        />
      ) : (
        <Avatar
          name={name}
          seed={record.id}
          size={size}
          sizeVar={responsive ? "var(--headshot-size)" : undefined}
          deceased={deceased}
        />
      )}
      {deceased && <MourningBand />}
      {debrothered && <DebrotheredMark />}
    </span>
  );

  if (!canEnlarge) {
    return figure;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        // The button is exactly the photo — no padding, no ring offset that would
        // clip against the header's edge — so the visible focus ring traces the
        // circle the reader is about to open (WCAG 2.4.11/2.4.13).
        className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
        aria-label={`Larger photo of ${alt}`}
      >
        {figure}
      </button>
      {enlarged && (
        <HeadshotDialog url={url} alt={alt} name={name} deceased={deceased} onClose={close} />
      )}
    </>
  );
}

/**
 * The full-size headshot, shown over the page (OFC-353). It is the **square** 512²
 * stored image rather than the circular crop the page shows — the circle is a
 * density device for the Directory and the header, and the corners are the only
 * thing enlarging actually reveals *(Forrest's call, Stage 1.4)*.
 *
 * ⚠ **It costs no bytes.** The Profile page already downloads this exact URL for
 * the 96–132px header photo (the stored artifact is 512² and always has been), so
 * the dialog re-displays an image the browser has cached under the `immutable`
 * headshot policy — nothing is fetched when it opens. That is what makes this
 * feature defensible for a slow-link reader, and it is why the dialog must keep
 * using {@link headshotUrl} rather than growing a size parameter of its own.
 *
 * The shell is the shared {@link ModalDialog}, so focus trap, Escape and page
 * inerting are the platform's. A deceased brother keeps his memorial status in
 * both the caption and the image's accessible name — text, never colour alone —
 * but not the mourning band, which is drawn as a chord of the circle and has no
 * meaning over a square.
 */
function HeadshotDialog({
  url,
  alt,
  name,
  deceased,
  onClose,
}: {
  url: string;
  alt: string;
  name: string;
  deceased: boolean;
  onClose: () => void;
}) {
  const captionId = useId();
  return (
    <ModalDialog labelledBy={captionId} onClose={onClose} className="w-fit max-w-[95vw] p-4">
      <figure className="m-0">
        <img
          src={url}
          alt={alt}
          width={HEADSHOT_SIZE}
          height={HEADSHOT_SIZE}
          decoding="async"
          // Square, at its stored size, shrinking on a narrow screen rather than
          // overflowing it. `h-auto` keeps it square while the width gives way.
          className="block h-auto w-[min(512px,calc(95vw-2rem))] rounded-[var(--radius-lg)]"
        />
        <figcaption
          id={captionId}
          className="mt-3 text-center text-[length:var(--text-body)] font-medium"
        >
          {name}
          {deceased && (
            <span className="block text-[length:var(--text-body-sm)] text-muted-foreground">
              In Memoriam
            </span>
          )}
        </figcaption>
      </figure>
      <div className="mt-3 flex justify-center">
        <button
          // biome-ignore lint/a11y/noAutofocus: the platform modal focuses its primary action on open; Close is the only action here (WCAG 2.2 AA).
          autoFocus
          type="button"
          onClick={onClose}
          className="rounded-[var(--radius-md)] border border-input bg-card px-4 py-2.5 text-[length:var(--text-label)] font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          Close
        </button>
      </div>
    </ModalDialog>
  );
}
