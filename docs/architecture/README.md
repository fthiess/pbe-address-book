# Architecture diagrams

Hand-authored SVGs in the Book's visual-design token palette
([`tokens.css`](../initial-build/visual-design/tokens.css)). Two detail levels,
each in a light and a dark theme:

| File | Use |
|---|---|
| `book-arch-readme-{light,dark}.svg` | Embedded in the repo README via `<picture>`; carries the monospace technical annotation layer (routes, cache directives, the `__session` cookie). |
| `book-arch-slide-{light,dark}.svg` | Plain-English version for presentations (16:9, back-of-the-room type sizes). |

Reading conventions: **teal** marks Book data flows, **crest gold** the Ghost
identity lane, and the "front door" wall is Firebase Hosting as the single
origin — flow ② is served *at* the door (the edge-cached app shell), flows
③/④ pass *through* it uncached (member data is `no-store`, D95/D126). The
numbered chips ①–④ order the flows for narration.

Fonts follow the app's own stack (Inter with system fallback — nothing is
embedded, matching the app's own byte-frugality; text metrics were laid out
with margin so common system fonts don't overflow).

To export a high-resolution PNG for a slide deck (from this directory):

```bash
npx playwright screenshot --viewport-size=3200,1800 \
  "file://$PWD/book-arch-slide-light.svg" book-arch-slide-light@2x.png
```

When the architecture changes, edit the SVGs directly (they are plain,
commented XML with a small CSS class block per theme) and keep all four
variants in step; the layout geometry is shared, the annotation layer is the
only difference between the slide and readme pairs. Rationale and history:
decision **N100** in [`DECISIONS.md`](../initial-build/DECISIONS.md).
