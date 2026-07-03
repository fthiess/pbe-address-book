/**
 * The diagonal **mourning band** shown over a deceased brother's circular image
 * (the Directory thumbnail and the Profile headshot). An ink stripe across the
 * upper-right of the circle along the "╲" diagonal (`rotate(45deg)`), spanning
 * **edge to edge** in its path — the band is wider than the circle and the round,
 * `overflow-hidden` container clips it to the rim. Hairline white edges let it
 * read on a dark-mode avatar (D32). All positioning is in **percentages**, so the
 * one band scales to any diameter (a 40² thumbnail or a 132² headshot).
 *
 * Purely decorative (`aria-hidden`): the memorial status is carried in words by
 * the row/section "IN MEMORIAM" badge and the image's accessible name, never by
 * colour or this mark alone (D32/§5.5).
 */
export function MourningBand() {
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
