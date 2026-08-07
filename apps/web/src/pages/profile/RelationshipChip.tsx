import { Link } from "react-router-dom";

/**
 * One brother in the Relationships section, rendered identically wherever a
 * relationship appears — Big Brother and Little Brothers, in both view and edit
 * (§5.7.4). A calm pill with a name link to that brother's profile; in edit mode
 * the Big-Brother chip adds a Remove control. Keeping a single component is what
 * keeps the four presentations visually consistent (the earlier split — a large
 * coloured link for Big Brother vs. small muted chips for Little Brothers — was the
 * inconsistency this resolves).
 */
export function RelationshipChip({
  id,
  name,
  onRemove,
  removeLabel,
}: {
  /**
   * The brother's id, or **null** when he is withheld from this viewer (D168) —
   * in which case the chip is inert text rather than a link, matching the view
   * page's "Info is private" placeholder. Before D168 a withheld Big Brother fell
   * through the caller's `names.get(id) ?? \`#${id}\`` fallback and rendered as a
   * clickable raw Constitution id, which is both uglier and a dead link.
   */
  id: number | null;
  name: string;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-[length:var(--text-body)]">
      {id == null ? (
        <span className="text-muted-foreground italic">{name}</span>
      ) : (
        <Link
          to={`/brother/${id}`}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {name}
        </Link>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  );
}
