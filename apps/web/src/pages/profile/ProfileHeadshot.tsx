import { headshotObjectKey, imageUrl } from "@pbe/shared";
import { useEffect, useState } from "react";
import { Avatar } from "../../components/Avatar.js";
import { MourningBand } from "../../components/MourningBand.js";
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
}: {
  record: ProfileRecord;
  name: string;
  size?: number;
  /** Size responsively (96² mobile → 132² desktop) instead of the fixed `size`. */
  responsive?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const deceased = record.deceased?.isDeceased === true;
  const url = headshotUrl(record);
  // Re-arm the image load when the URL changes (OFC-128): a new `headshotVersion`
  // (or a fresh record) must retry, not stick on the avatar after a transient error.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on `url` change is the intent; the body reads no deps.
  useEffect(() => setFailed(false), [url]);
  const alt = deceased ? `${name} — In Memoriam` : name;
  const dim = responsive ? "var(--headshot-size)" : `${size}px`;
  const responsiveClass = responsive ? PROFILE_HEADSHOT_RESPONSIVE : undefined;

  // A round, clipping container so the mourning band (a full chord, wider than the
  // circle) is clipped to the rim over both the real photo and the avatar fallback.
  return (
    <span
      className={cn("relative inline-block shrink-0 overflow-hidden rounded-full", responsiveClass)}
      style={{ width: dim, height: dim }}
    >
      {url && !failed ? (
        <img
          src={url}
          alt={alt}
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
    </span>
  );
}
