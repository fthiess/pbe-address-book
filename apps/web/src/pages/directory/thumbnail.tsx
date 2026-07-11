import { imageUrl, thumbnailObjectKey } from "@pbe/shared";
import { useEffect, useState } from "react";
import { Avatar } from "../../components/Avatar.js";
import { DebrotheredMark } from "../../components/DebrotheredMark.js";
import { MourningBand } from "../../components/MourningBand.js";
import type { DirectoryProfile } from "../../lib/types.js";

/**
 * The Directory thumbnail cell (§5.6.1/§5.6.9). The 96² thumbnail is served by
 * the backend from the private image bucket (D126) at a versioned, immutable URL;
 * a brother without a headshot — or whose image fails to load — shows the
 * initials/silhouette avatar instead. The box is a **fixed size whether or not
 * the image has loaded**, so streaming thumbnails in never shifts layout.
 *
 * Status overlays (visual-design `COMPONENTS.md`):
 *  - **Deceased** — a thin diagonal **mourning band** (ink, with hairline white
 *    edges for dark mode) inset within the circle so the rim stays visible, plus
 *    a desaturated avatar ground; paired with the row's "IN MEMORIAM" badge and
 *    the image's accessible name so status is never colour-only (D32).
 *  - **De-brothered** (manager/admin) — a translucent red ✕ over the avatar,
 *    paired with the row's strike-through and "DE-BROTHERED" badge (D115).
 */

/**
 * Rendered box size in the row (the stored thumbnail is 96²; displayed smaller).
 * Exported so callers that fall back to a bare `Avatar` beside a real thumbnail
 * (the Profile page's relationship links, OFC-203) size both from one source.
 */
export const BOX = 40;

/** The thumbnail `/img/*` URL, or null when there is nothing to load. */
export function thumbnailUrl(profile: DirectoryProfile): string | null {
  if (!profile.hasHeadshot || !profile.headshotVersion) {
    return null;
  }
  return imageUrl(thumbnailObjectKey(profile.id, profile.headshotVersion));
}

export function Thumbnail({
  profile,
  name,
  decorative = false,
}: {
  profile: DirectoryProfile;
  name: string;
  /**
   * Render the image as decorative (empty alt) — for contexts where an adjacent
   * text label already names the brother (the Profile page's relationship links,
   * OFC-203), so the thumbnail is not announced twice. Defaults to false: the
   * Directory cell, where the thumbnail carries the accessible name itself.
   */
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const url = thumbnailUrl(profile);
  // Re-arm on URL change (OFC-128) so a re-uploaded thumbnail loads after a
  // transient error instead of sticking on the avatar fallback.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on `url` change is the intent; the body reads no deps.
  useEffect(() => setFailed(false), [url]);
  const deceased = profile.deceased?.isDeceased === true;
  const debrothered = profile.debrothered?.isDebrothered === true;
  // The accessible name folds in the memorial status, matching §5.5's alt-text rule.
  const alt = decorative ? "" : deceased ? `${name} — In Memoriam` : name;

  return (
    <span
      className="relative inline-block overflow-hidden rounded-full"
      style={{ width: BOX, height: BOX }}
    >
      {url && !failed ? (
        <img
          src={url}
          alt={alt}
          width={BOX}
          height={BOX}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Avatar name={name} seed={profile.id} size={BOX} deceased={deceased} />
      )}

      {deceased && <MourningBand />}
      {debrothered && <DebrotheredMark />}
    </span>
  );
}
