/**
 * The de-brothered mark: a translucent red ✕ across a brother's circular image,
 * shown to managers/admins (the only roles that can see a de-brothered record) on
 * both the Directory thumbnail and the Profile headshot — the same "status on the
 * photo too" treatment the {@link MourningBand} gives a deceased record (D115).
 *
 * Corner-to-corner strokes in a `0 0 40` viewBox, so the round, `overflow-hidden`
 * container clips them to a full-diameter cross at any size. Decorative
 * (`aria-hidden`): the status is carried in words by the row/section
 * "DE-BROTHERED" badge and the struck-through name, never by this mark alone (D32).
 */
export function DebrotheredMark() {
  return (
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
  );
}
