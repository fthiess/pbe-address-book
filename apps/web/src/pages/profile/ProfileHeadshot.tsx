import { headshotObjectKey, imageUrl } from "@pbe/shared";
import { useState } from "react";
import { Avatar } from "../../components/Avatar.js";
import type { ProfileRecord } from "../../lib/types.js";

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
export function ProfileHeadshot({
  record,
  name,
  size = 120,
}: {
  record: ProfileRecord;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const deceased = record.deceased?.isDeceased === true;
  const url =
    record.hasHeadshot && record.headshotVersion
      ? imageUrl(headshotObjectKey(record.id, record.headshotVersion))
      : null;
  const alt = deceased ? `${name} — In Memoriam` : name;

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={alt}
        width={size}
        height={size}
        decoding="async"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, boxShadow: "var(--shadow-avatar)" }}
      />
    );
  }
  return (
    <Avatar name={name} seed={record.id} size={size} deceased={deceased} className="shrink-0" />
  );
}
