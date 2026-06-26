import { cn } from "../lib/utils.js";

/** Up to two initials from a display name. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * An initials avatar (the full headshot pipeline lands in Phase 4). Decorative
 * by default — the brother's name is always rendered adjacent — so it is hidden
 * from assistive tech to avoid a redundant announcement.
 */
export function Avatar({
  name,
  size = 40,
  className,
}: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initialsOf(name)}
    </span>
  );
}
