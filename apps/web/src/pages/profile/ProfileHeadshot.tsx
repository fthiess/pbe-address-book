import { headshotObjectKey, imageUrl } from "@pbe/shared";
import { useState } from "react";
import { Avatar } from "../../components/Avatar.js";
import type { ProfileRecord } from "../../lib/types.js";
import { cn } from "../../lib/utils.js";

/**
 * The Profile page headshot — the full 512² WEBP from the private bucket (D126),
 * falling back to the initials/silhouette avatar when there is no headshot or it
 * fails to load (the same degrade-don't-break contract as the Directory
 * thumbnail). A deceased brother's avatar fallback desaturates; the diagonal
 * mourning band over a real headshot is part of the In Memoriam pass (4c).
 *
 * The crop-and-upload editor is the 4c headshot pipeline; here the image is
 * display-only.
 */
/**
 * The **responsive** headshot size used on the Profile page (N35): larger on
 * desktop, smaller on mobile. It sets a `--headshot-size` CSS variable at the
 * `sm` breakpoint, which both the `<img>` and the `Avatar` fallback read, so the
 * two size identically. The stored image is always the full 512² WEBP; only the
 * rendered box changes.
 */
export const PROFILE_HEADSHOT_RESPONSIVE = "[--headshot-size:96px] sm:[--headshot-size:132px]";

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
  const url =
    record.hasHeadshot && record.headshotVersion
      ? imageUrl(headshotObjectKey(record.id, record.headshotVersion))
      : null;
  const alt = deceased ? `${name} — In Memoriam` : name;
  const dim = responsive ? "var(--headshot-size)" : `${size}px`;

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={alt}
        width={size}
        height={size}
        decoding="async"
        onError={() => setFailed(true)}
        className={cn(
          "shrink-0 rounded-full object-cover",
          responsive && PROFILE_HEADSHOT_RESPONSIVE,
        )}
        style={{ width: dim, height: dim, boxShadow: "var(--shadow-avatar)" }}
      />
    );
  }
  return (
    <Avatar
      name={name}
      seed={record.id}
      size={size}
      sizeVar={responsive ? "var(--headshot-size)" : undefined}
      deceased={deceased}
      className={cn("shrink-0", responsive && PROFILE_HEADSHOT_RESPONSIVE)}
    />
  );
}
