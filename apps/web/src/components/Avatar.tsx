import { cn } from "../lib/utils.js";

/**
 * The initials/silhouette avatar shown when a brother has no headshot (the real
 * headshot replaces the whole ground in the Directory thumbnail and the Profile).
 * Per the visual design (`visual-design/ASSETS.md` §Avatars): a CSS
 * radial-gradient ground tinted to the person's color family, a translucent white
 * silhouette (a simple head + body), and the initials on top. Decorative — the
 * brother's name is always rendered adjacent — so it is hidden from assistive
 * tech to avoid a redundant announcement.
 */

/**
 * Up to two initials from a display name. Only tokens that begin with a *letter*
 * count, so the canonical name's `'YY` year token (e.g. "Daniel Hallman '58")
 * contributes nothing — the initials are "DH", never "D'".
 */
function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w));
  if (words.length === 0) {
    return "?";
  }
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

/** A small palette of ground hues — the brother's stable "color family". */
const FAMILY_HUES = [200, 45, 150, 280, 350, 175, 25, 320];

/** A stable non-negative hash of a string, for seeding the color family. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

interface Ground {
  background: string;
  ink: string;
}

/** The radial-gradient ground + initials ink for a color family (desaturated when deceased). */
function groundFor(seed: number, deceased: boolean): Ground {
  if (deceased) {
    // A desaturated slate ground for In-Memoriam rows (visual-design §IN MEMORIAM).
    return {
      background: "radial-gradient(circle at 50% 32%, hsl(210 10% 84%), hsl(210 12% 73%))",
      ink: "hsl(210 14% 38%)",
    };
  }
  const hue = FAMILY_HUES[seed % FAMILY_HUES.length] ?? 200;
  return {
    background: `radial-gradient(circle at 50% 32%, hsl(${hue} 48% 88%), hsl(${hue} 44% 76%))`,
    ink: `hsl(${hue} 42% 30%)`,
  };
}

export function Avatar({
  name,
  seed,
  size = 40,
  deceased = false,
  className,
}: {
  name: string;
  /** Stable color-family seed (the Constitution id); falls back to a name hash. */
  seed?: number;
  size?: number;
  deceased?: boolean;
  className?: string;
}) {
  const ground = groundFor(seed ?? hashString(name), deceased);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full",
        className,
      )}
      style={{ width: size, height: size, background: ground.background }}
    >
      {/* Translucent white silhouette watermark (generic head + shoulders). */}
      <svg
        viewBox="0 0 40 40"
        className="absolute inset-0 size-full"
        fill="rgba(255,255,255,0.5)"
        aria-hidden="true"
      >
        <circle cx="20" cy="15" r="7" />
        <path d="M7 40 C7 28 33 28 33 40 Z" />
      </svg>
      <span
        className="relative font-semibold leading-none"
        style={{ color: ground.ink, fontSize: Math.round(size * 0.38) }}
      >
        {initialsOf(name)}
      </span>
    </span>
  );
}
