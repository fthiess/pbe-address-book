import { imageUrl, thumbnailObjectKey } from "@pbe/shared";
import { useEffect, useState } from "react";
import { Avatar } from "./Avatar.js";

/**
 * A small round avatar that shows the brother's **headshot thumbnail** when they
 * have one, falling back to the initials/silhouette {@link Avatar} otherwise — the
 * same image the Directory row shows, so a brother's masthead avatar matches his
 * own thumbnail (and updates when he changes his photo). Decorative: the name is
 * always rendered adjacent, so the image is `aria-hidden`.
 */
interface AvatarThumbnailProfile {
  id: number;
  hasHeadshot?: boolean;
  headshotVersion?: string;
  deceased?: { isDeceased: boolean };
}

export function AvatarThumbnail({
  profile,
  name,
  size,
}: {
  profile: AvatarThumbnailProfile | null;
  name: string;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  const url =
    profile?.hasHeadshot && profile.headshotVersion
      ? imageUrl(thumbnailObjectKey(profile.id, profile.headshotVersion))
      : null;
  // Re-arm the load when the URL changes (a new headshotVersion), so a fresh photo
  // shows after a prior transient error (OFC-128).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on `url` change is the intent; the body reads no deps.
  useEffect(() => setFailed(false), [url]);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        decoding="async"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <Avatar
      name={name}
      seed={profile?.id}
      size={size}
      deceased={profile?.deceased?.isDeceased === true}
    />
  );
}
