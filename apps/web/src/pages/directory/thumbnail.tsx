import { imageUrl, thumbnailObjectKey } from "@pbe/shared";
import { useState } from "react";
import { Avatar } from "../../components/Avatar.js";
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

/** Rendered box size in the row (the stored thumbnail is 96²; displayed smaller). */
const BOX = 40;

/** The thumbnail `/img/*` URL, or null when there is nothing to load. */
export function thumbnailUrl(profile: DirectoryProfile): string | null {
  if (!profile.hasHeadshot || !profile.headshotVersion) {
    return null;
  }
  return imageUrl(thumbnailObjectKey(profile.id, profile.headshotVersion));
}

export function Thumbnail({ profile, name }: { profile: DirectoryProfile; name: string }) {
  const [failed, setFailed] = useState(false);
  const url = thumbnailUrl(profile);
  const deceased = profile.deceased?.isDeceased === true;
  const debrothered = profile.debrothered?.isDebrothered === true;
  // The accessible name folds in the memorial status, matching §5.5's alt-text rule.
  const alt = deceased ? `${name} — In Memoriam` : name;

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
      {debrothered && (
        // Translucent red ✕ over an expelled brother's avatar (D115).
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 grid place-items-center text-lg font-bold"
          style={{ color: "rgba(150,30,24,0.55)" }}
        >
          ✕
        </span>
      )}
    </span>
  );
}

/**
 * The diagonal mourning band — an ink stripe that **cuts across the upper-right
 * corner**, connecting a point on the top edge to a point on the right edge (the
 * genealogy convention). It runs along the "╲" diagonal (`rotate(45deg)`) and is
 * inset so the circle's rim stays visible all the way around; hairline white
 * edges let it read on a dark-mode avatar (D32). Purely decorative — the status
 * is carried in words by the badge and the alt text.
 */
function MourningBand() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        top: "23%",
        right: "7%",
        width: "47%",
        height: "13%",
        transform: "rotate(45deg)",
        transformOrigin: "center",
        borderRadius: "1px",
        background: "#14181b",
        boxShadow: "0 0.5px 0 rgba(255,255,255,0.85), 0 -0.5px 0 rgba(255,255,255,0.85)",
      }}
    />
  );
}
