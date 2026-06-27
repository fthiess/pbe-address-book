import type { HighlightRange } from "@pbe/name-search";
import type { ReactNode } from "react";

/**
 * Render a display name with the matched character ranges wrapped in `<mark>`, so
 * the eye finds the hit even within a name-sorted list (D35). The mark uses the
 * brand gold tint (AA-contrast in both themes, D79) rather than the browser
 * default. With no ranges it renders the plain text, so it's safe to use
 * unconditionally.
 */
export function HighlightedName({
  text,
  ranges,
}: {
  text: string;
  ranges: HighlightRange[];
}) {
  if (ranges.length === 0) {
    return <>{text}</>;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [i, range] of ranges.entries()) {
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start));
    }
    parts.push(
      <mark
        key={i}
        className="rounded-[2px] px-px"
        style={{ backgroundColor: "var(--gold-bg)", color: "var(--gold-text)" }}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return <>{parts}</>;
}
