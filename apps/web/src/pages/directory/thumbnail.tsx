import { imageUrl, thumbnailObjectKey } from "@pbe/shared";
import { useState } from "react";
import { Avatar } from "../../components/Avatar.js";
import type { DirectoryProfile } from "../../lib/types.js";

/**
 * The Directory thumbnail cell (§5.6.1/§5.6.9). The 96×96 thumbnail is served by
 * the backend from the private image bucket (D126) at a versioned, immutable URL;
 * a brother without a headshot — or whose image fails to load — shows the generic
 * initials avatar instead. The box is a **fixed size whether or not the image has
 * loaded**, so streaming thumbnails in never shifts the layout (§5.6.9).
 *
 * Deceased brothers carry the genealogy convention — a **dark diagonal bar across
 * one corner** — paired with the textual "In Memoriam" marker the row renders and
 * the image's accessible name, so the status is never colour/shape alone (D32).
 */

/** Rendered box size in the row (the stored thumbnail is 96²; displayed smaller). */
const BOX = 40;

/**
 * The thumbnail `/img/*` URL, or null when there is nothing to load. The object
 * key comes from the shared image-key contract (`@pbe/shared`), the one
 * definition the SPA, the staging seeder, and the Phase-4 headshot pipeline all
 * share — so a placeholder fixture and a real generated thumbnail occupy the
 * exact same path.
 */
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
  // The accessible name folds in the memorial status, matching §5.5's alt-text rule.
  const alt = deceased ? `${name} — In Memoriam` : name;

  return (
    <span
      className="relative inline-block overflow-hidden rounded-full bg-secondary"
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
        <Avatar name={name} size={BOX} />
      )}
      {deceased && (
        // The corner mourning bar — a CSS triangle in the memorial tone. Decorative
        // (aria-hidden): the status is carried in words by the alt text and the row.
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 size-0 border-solid"
          style={{
            borderWidth: `0 ${BOX * 0.42}px ${BOX * 0.42}px 0`,
            borderColor: "transparent var(--memorial-fg) transparent transparent",
          }}
        />
      )}
    </span>
  );
}
