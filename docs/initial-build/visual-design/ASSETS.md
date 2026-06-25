# Motif & Asset Guidance — PBE Address Book

## The mark (triangle / crest)
The brand mark is a simple **equilateral triangle** (a Greek pediment / the "Δ"-like crest), gold with a thin inner triangle outline. It is the only piece of iconographic identity — keep it restrained and architectural.

- `assets/crest.svg` — the masthead crest. Gold `#AD8736` fill with a white inner outline (`stroke #FFFFFF`, 1.5). Sits to the left of the "Phi Beta Epsilon Address Book" wordmark in the top bar (~38×21). In **dark** UI the crest fill brightens to `#CDA86A` with a warm-white inner line.
- **Favicon — use the ivy leaf, not a triangle.** PBE's triangle is a wide *isosceles* pediment; it doesn't fill a square favicon well, and an equilateral triangle is not a PBE form. So the favicon is the **ivy leaf** (with stem) lifted from the official crest (`uploads/PBE Triangle-Date-Gold.png`), in gold `#9B7A2E` on parchment `#F3ECDD`. The finished, ready-to-ship set is in `assets/favicon/`:
  - `favicon.ico` (16/32/48), `icon-16/32/48/192/512.png`, `apple-touch-icon.png` (180, square)
  - `HOWTO.txt` — the `<head>` link tags + web-manifest icon entries
  The leaf art is raster (traced from the crest); for a crisp vector favicon, have a designer redraw the leaf as an SVG path from these references.
- The masthead `crest.svg` (the wide isosceles triangle) is unchanged and correct for the top-bar wordmark — only the favicon moved to the leaf.

### Triangle as a small accent
Tiny solid triangles (`clip-path: polygon(50% 0,100% 100%,0 100%)`, `--brand-gold-soft` #B8995E) are used as inline markers — the soft "mark deceased" icon, the "Sharing beyond the brotherhood" eyebrow bullet, section eyebrows. Use sparingly; never decoratively.

### Ivy
"Ivy" is referenced as heritage flavor (est. 1890) but is **not** rendered as illustration anywhere in the UI — don't add ivy graphics. If a heritage texture is ever wanted, keep it to the gold/parchment memorial palette, never a literal vine.

## Avatars
No illustration library. Each avatar is a CSS radial-gradient ground tinted to the person's color family, a translucent white silhouette (a simple `<circle>` head + body `<path>`), and initials on top. When a real headshot exists it replaces the ground. Keep the silhouette generic; do not generate faces.

## Imagery
There is no marketing/photographic imagery in this product. Don't introduce stock photos or AI imagery. The only "image" content is user-uploaded headshots (1:1, cropped via the headshot crop modal).

## Type / fonts
- **Display / masthead**: **Manufacturing Consent** (Google Fonts) — used ONLY for the "Phi Beta Epsilon Address Book" wordmark and the "In Memoriam" memorial display. Do not use it for body or headings.
  `https://fonts.googleapis.com/css2?family=Manufacturing+Consent&display=swap`
- **UI sans**: **Inter** (400/500/600/700/800), `system-ui` fallback.
  `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap`
- **Mono**: system `ui-monospace` stack (Constitution IDs, match counts, year inputs). No webfont needed.

Self-host both Google fonts in production (don't hot-link) and keep `display=swap`.

## Color discipline
Cool neutral greys + a single teal primary `#007194` + a gold heritage accent `#AD8736`. Greens = success/verified, red = destructive only. The course-area chip palette (teal/gold/green/purple/red/slate) is the one place multiple hues appear, and they are always backed by the course-code text. Avoid introducing new hues.

## External link
"PBE News" (`https://pbe400.org`) is the sibling property — linked once from the top bar only (we removed the duplicate footer link). Not an asset, but keep the single top-bar entry point.
