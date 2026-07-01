# Component & State Spec — PBE Address Book

Conventions used throughout:
- **Focus**: every focusable element keeps a visible teal focus ring — `box-shadow: var(--ring-shadow)` (`0 0 0 3px rgba(0,113,148,0.20)`), often with a 2px `--ring` border. Never remove it.
- **Hit targets**: ≥ 42px tall for primary controls (audience skews 60+). Icon buttons ≥ 26px, switches 42×24.
- **Meaning never by color alone**: every state that uses color also carries text, an icon, a fill/outline difference, or knob position.
- **Help**: the `?` control is a click-toggle Radix popover (see below), not hover-only.

---

## Buttons
Height 42px (40px in dialogs), radius `--radius-md` (9px), font 14px/600, `white-space:nowrap`.

| Variant | Background | Text | Border |
|---|---|---|---|
| Primary | `--primary` #007194 | #fff | none |
| Secondary | #fff (`--card`) | `--foreground` | 1px `--input`-light #D6DADD |
| Ghost | transparent | `--muted-foreground` | none |
| Destructive | `--destructive` #B42318 | #fff | none |
| Outline-on-tint (e.g. Verify) | #fff | `--success-strong` | 1px `--success-border` |

Focus ring variant: 2px `--ring` border + `--ring-shadow`.

## Switch (toggle)
Track 42×24, radius 999px; knob 20×20 circle #fff inset 2px.
- **On**: track `--primary` #007194, knob right.
- **Off**: track `--track` #C4CACE, knob left.
- Label sits to the right (flex, gap 13px); on-label `--text-1`, off-label `--muted-foreground`.
- Pair every switch with **inline consequence text** = the currently-true statement (e.g. "Brothers can reach you by email"). The counterfactual goes in the `?` popover.
- A11y: `role="switch"` + `aria-checked`.
- **Resting states are NOT uniform.** On the Profile privacy set (8 switches) three default **off**: emergency-contact share, spouse/partner share, and "Share with the MIT Alumni Association" — they govern sharing beyond the brotherhood. The per-field toggles (emergency, spouse/partner) live inline with their fields; the rest live in the Privacy & consent panel.
- **Every switch reads in the positive direction** (on = the thing the label names is true). The directory-listing switch is therefore presented as **"Listed in the directory"** (on = listed/visible), not "Unlisted — hide me"; the stored field stays `unlisted` and the presentation is inverted at the call site (N35). In the Privacy & consent panel the first three per-field switches carry the same box insets (border + `p-3`, transparent) as the boxed subgroups below, so every switch track and `?` button aligns down the column.

## `?` Help popover
- Trigger: 22–26px circle, border 1.5–2px `--track`; on open it goes teal (`--primary` border + `#E2F0F3` bg + `--ring-shadow`).
- Click-toggle (Radix Popover). Card: `--popover`, 1px `--border`, radius 12px, `--shadow-popover`, padding 14×16, 330px max, with a 12px caret. Body 13.5px/1.55 `--text-2`.
- Content pattern: explains what the OFF (counterfactual) state does, e.g. "When off, your phone number is hidden from other brothers…".

## Inputs / fields
Height 42px, radius 9px, border 1px `--input` #808A92, bg #fff, padding 0 12px, value 15px.
- **Focused**: 2px `--primary` border + `--ring-shadow`.
- **Read-only / locked**: bg `--muted` #F6F7F8, border `--border`, text `--muted-foreground` #5A6470, leading 🔒 and "— read-only" note (e.g. Constitution ID). (Was `--text-4`, but `--text-4` on `--muted` is 2.88:1 — below WCAG AA; the locked text uses `--muted-foreground` so it passes. `--text-4` stays a faint accent for placeholders / text on white, where it's legitimate — this was a bad *pairing*, not a bad token.)
- Helper text below: 12.5px `--muted-foreground`.
- Short inputs (year fields) use `--font-mono`, placeholder "YYYY".

## Chip (course-area / status)
Pill, radius 999px, padding 3×10, 12px/600. Colors from the **course-area chip palette** in `tokens.css` (teal=Course 6, gold=2, green=7, purple=18, red=10, slate=neutral). The major **code text** carries the meaning; color is reinforcement.

### Chip editor (Profile › Courses, edit mode)
Wrapping field, min-height 48px, dashed-free 1px `--input` border. Each chip gains a grab handle (`⠿`) on the left and an `×` remove circle on the right. "Drag to reorder; the course listed first appears in the directory." An "Add a course…" placeholder ends the row. The section is labelled **Courses** (the data field stays `majors`; matches the Directory's N15 rename). Locked relationship chips (Little Brothers) render flat with a 🔒 on the section label and an explanatory note — not editable.

## UNLISTED badge  ← (privacy hide; manager/admin-only)
- Calm, neutral, **present-but-private** — deliberately NOT an alarm and NOT a strike.
- Solid slate fill: text `--chip-slate-fg` #3A4651, bg `--chip-slate-bg` #E9EDF0, border `--chip-slate-border` #D2DADF, radius 4–5px, 10.5px/700, letter-spacing 0.03em.
- Leads with a small "no/hidden" glyph: an inline SVG circle with a diagonal slash (`currentColor`, stroke 1.3–1.4).
- Text "UNLISTED" + `title`/accessible name: "Unlisted — hidden from the directory; visible to managers and administrators only."
- **Shown only to managers/admins** on the Directory row/card and on the Profile.
- Must stay distinguishable from **de-brothering** when both appear on one record (they can co-occur): de-brothered = name struck through + outline "DE-BROTHERED" badge + red ✕ over the avatar; unlisted = no strike, solid slate badge with the eye-off glyph.

## DE-BROTHERED treatment (existing, for contrast)
Name `text-decoration: line-through` (`--text-5` strike color), name + class go `--muted-foreground`; outline badge "DE-BROTHERED" (1px #D6DADD, no fill); avatar gets a translucent red ✕ overlay (`rgba(150,30,24,0.5)`). Grave but reversible.

## IN MEMORIAM treatment
- Directory: gold outline badge "IN MEMORIAM" (`--memorial-fg` text, `#FBF4E6` bg, `--gold-border-2`-ish border); avatar carries a thin diagonal mourning band (gold/ink stripe) and a desaturated slate gradient.
- Profile memorial: banner with `--memorial-bg-from→to` gradient, `--font-display` "In Memoriam" at 48px `--memorial-fg`.
- **Lifespan line** (dignified, NOT a data field): sits just under the name, 18px `--memorial-fg`. Display rules:
  - both years → `1940–2024` (typographic en-dash, kept non-breaking via `white-space:nowrap`)
  - death year only → `d. 2024`
  - birth year only, or neither → render nothing (an open "1940–" misreads as still-living)
  - The full **Date of death** still appears as its own detail field below the banner, independent of the lifespan line, alongside Obituary and In Memoriam article links.

## Profile layout — fuller second column (view & edit; N35)
One layout, four projections, DOM order = reading order (WCAG 1.3.2). The identity band leads with the enlarged responsive headshot beside the name/identity fields; the mug name shows under the name as a quoted nickname (it is editable, so it must not be write-only). Below, **Professional & personal runs full width with an internal two-column grid** so **spouse and courses sit to the right of the employer/job-title (+links) column** — the "fuller use of the second column." Relationships follows full width; Contact / Emergency and the restricted Privacy / Record-status pairs keep the two-up rows. (First cut of the reflow — refined against the rendered staging page.)

## Deceased field group (Profile edit, managers/admins)
Marking deceased = the **soft confirmation** (gentle · reversible). On confirm the group reveals and **focus moves into the first field**. Five fields:
1. **Date of death** (full date) — first field, receives focus.
2. **Year of death** (short, mono) — fallback when the full date isn't known; needs helper text saying exactly that.
3. **Year of birth** (short, mono) — feeds the lifespan line.
4. **Obituary link** (url).
5. **In Memoriam article link** (url).
Group surface: `--gold-bg-4` with `--gold-border`, gold "Memorial details" eyebrow.

## Confirmation dialogs — three deliberately distinct tones
All: centered modal, `--card`, radius 16px, `--shadow-modal`, 18px/700 title, 14px/1.55 body, actions bottom-right.
1. **Soft** (gentle · reversible — Mark deceased): gold triangle icon tile `--gold-bg`, eyebrow `--tone-soft-fg`, primary teal confirm.
2. **Deliberate** (consequential · reversible — De-brother): `--gold-border` card border, ⚠ tile `--gold-bg-2`, eyebrow `--tone-deliberate-fg`, an "I understand the consequences" checkbox, confirm filled `--gold-text-strong` #8A5D00.
3. **Destructive** (cannot be undone — Delete): `#E7B5AF` border, ⌫ tile `--destructive` red, type-to-confirm `DELETE` input, confirm filled `--destructive`.

## Session-expired notice (Auth)
Calm interstitial, NOT an error. Centered card (430px) on a `--secondary` backdrop: teal clock glyph in a `#E2F0F3` circle, "Your session has expired", reassuring body ("…signed out after a few hours. Sign in again to pick up right where you left off — nothing has been lost."), full-width primary "Sign in again", sub-note "You'll return to this page after signing in." Occasional state (4-hour cap or membership removal) — reassure, don't alarm.

## Directory grid
- Sticky top bar → controls row (search, quick toggles "Include deceased"/"Starred only", Filters w/ active count, Columns, Reset, count, Export, Add Brother) → optional open filter panel → grid header → virtualized rows → count/scroll hint → footer.
- Columns: `[select][star][photo][name][class][major][email][city][state]`. First four (select, star, photo, name) are **frozen** — can't hide or reorder.
- Rows: default #fff, zebra `#FAFBFB`, hover `#F4F6F7`, selected `#E9F4F6` + 3px `--primary` left border. Row states: starred (★ gold), deceased (IN MEMORIAM), de-brothered (manager view), unlisted (manager view).
- **Reordering**: drag handle `⠿` on grid headers AND in the Columns dialog. Handles are **keyboard-operable** — `role="button" tabindex="0"`, focus shows the teal ring, ↑/↓ moves the column. (We removed separate move up/down buttons in favor of this single accessible control.)
- Mobile (< md): stacked cards, 48px avatar, name + location + primary major chip + star.
- Dark theme: brother view (no checkboxes/admin chrome).

## Filter value picker (dialog)
Opens over the table when you set a filter. 300px popover: header "Filter by Major" + close ✕, search field, scrollable checkbox list where each row = checkbox + course chip + name + match count (mono). Footer: "Clear" (ghost) + "Apply (n)" (primary). Selected values become chips in the controls row; the Filters button shows the active count.

## Loading overlay
Past a short threshold only. Translucent `--muted` scrim + 2px blur, 38px teal spinner (`@keyframes spin`, disabled under `prefers-reduced-motion`), "Loading…" + reassuring "Waking the server — this can take a few seconds."

## Toast
Quiet success: dark surface `#1B262B`, 1px `--success-border`, ✓ in a small circle, "Saved — verified as of today."

## Avatars
Circle with a radial-gradient ground tinted to the person's color family + white silhouette + initials. Ring: `--shadow-avatar`. Sizes: **96→132 responsive (profile — smaller on mobile, larger on desktop; N35)**, 40 (row), 34/30 (compact), 22–24 (chip). The Profile headshot (real photo or avatar fallback) sizes from a `--headshot-size` CSS variable set at the `sm` breakpoint so photo and fallback scale identically.

## Theme switch
Segmented control (☀ / ☾ / ◐ = light / dark / system) in the top bar — track `--secondary`, active segment #fff with a small shadow.

## Font-size switch
Segmented control sitting immediately left of the theme switch, same track/active treatment — three "A" glyphs growing left to right (A / A / A = Normal / Large / Larger) that scale the document root font-size (100% / 112.5% / 125%), so the whole rem-sized UI grows proportionally (PRD §5.3; restored in Phase 3b-2 after being dropped from the original visual pass — DECISIONS N24). Each segment carries a descriptive accessible name ("Normal text size", …) since the letter alone is ambiguous; ≥24px targets, `aria-pressed` on the active step.
