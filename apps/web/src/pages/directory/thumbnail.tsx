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
        // Translucent red ✕ across the whole circle (D115) — corner-to-corner
        // strokes, clipped by the circle so they span its full diameter.
        <svg
          viewBox="0 0 40 40"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
          stroke="rgba(150,30,24,0.6)"
          strokeWidth="3.5"
          strokeLinecap="round"
        >
          <line x1="3" y1="3" x2="37" y2="37" />
          <line x1="37" y1="3" x2="3" y2="37" />
        </svg>
      )}
    </span>
  );
}

/**
 * The diagonal mourning band — an ink stripe across the upper-right of the circle
 * along the "╲" diagonal (`rotate(45deg)`), spanning **edge to edge** of the
 * circle in its path (a full chord — the band is wider than the circle and the
 * round container clips it to the rim). Hairline white edges let it read on a
 * dark-mode avatar (D32). Purely decorative — the status is carried in words by
 * the badge and the alt text.
 */
function MourningBand() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        top: "23%",
        right: "-19%",
        width: "100%",
        height: "13%",
        transform: "rotate(45deg)",
        transformOrigin: "center",
        background: "#14181b",
        boxShadow: "0 0.5px 0 rgba(255,255,255,0.85), 0 -0.5px 0 rgba(255,255,255,0.85)",
      }}
    />
  );
}
