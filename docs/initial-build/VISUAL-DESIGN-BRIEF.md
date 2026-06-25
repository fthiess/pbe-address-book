# PBE Address Book ("Book") — Visual Design Brief

**For:** a dedicated visual-design pass with Claude Design.
**From:** the Book design corpus (PRD §5, the brand artwork, and the editor's reference collection), synthesized into a single input.
**Date:** 2026-06-12.
**Amendments:** Amended in the early-feedback pass (2026-06-24) — D122 lifespan line, D124 UNLISTED badge.
**Output (design pass COMPLETE, 2026-06-24):** Claude Design delivered the visual system — light+dark tokens, a component/state spec, motif/asset guidance, HTML prototypes, and rendered mockups — in [`visual-design/`](visual-design/), alongside this brief. `visual-design/tokens.css` is the load-bearing shadcn token layer and `visual-design/README.md` is the entry point; the HTML prototypes are the visual source of truth (recreated in React + Tailwind + shadcn at build time, not shipped).

---

## 1. Purpose and how to use this brief

Book's *structure, behavior, and engineering* are already fully designed and locked (see `PRD.md` §5 for the authoritative page-by-page UI spec, and the other delivered docs for the rest). What is **not** yet decided is Book's **visual design**: its palette, typography, spacing, elevation, and the concrete look of each screen and component. That is your job.

Read this brief as the primary input. It pulls the *visually load-bearing* facts out of a much larger design corpus so you do not have to wade through engineering rationale that would likely only be noise. Where you want the full functional detail of a screen, `PRD.md` §5 is the source of truth and is cross-referenced throughout.

**What to produce** is specified in §11. In short: a light **and** dark theme expressed as design-token values, a type scale, the look of the key screens, and the look of the shared components — all expressible purely through a CSS-variable token layer (§8), because that is what makes the design portable to Ghost (§4).

**What to ignore:** the engineering decisions, the data model, the API, the security model. You need none of it. The few places where a technical fact constrains the visuals (e.g. "thumbnails are 96×96," "meaning may never be carried by color alone") are called out explicitly below.

---

## 2. Product in brief

Book is a **members-only online address book** for Phi Beta Epsilon (PBE), an MIT fraternity founded in **1890**, with ~40 active undergraduates and ~800 living alumni ("brothers"). It replaces the defunct paper address books (last printed 1990) with an accurate, self-maintained directory. At its core it is a CRUD app over a collection of brother **profiles**, with a searchable/filterable/sortable **directory** as its home page.

It has three roles — **Brother**, **Manager**, **Administrator** — and four primary screens: the **Directory**, the **Profile** (view/edit), an admin-only **Add-Brother** form, and an admin **control panel**.

Book is one half of a composite system with **PBE News**, PBE's online alumni publication built on Ghost at **pbe400.org**. That relationship shapes the visual design (§4).

---

## 3. Audience — who this is for, and what it demands

The membership skews **older**: a large share of the heaviest users are alumni **aged 60 and up**, some with **vision or fine-motor limitations**, and a meaningful fraction are **technically capable but on slow internet connections** (an email list still has AOL-era domains; some on DSL). This audience is not incidental — it is the reason behind several hard constraints below, and it should shape your instincts throughout:

- **Legibility over fashion.** Generous type, clear hierarchy, ample contrast, unambiguous controls. Nothing that depends on a hairline-thin font, a faint gray-on-gray, or a tiny tap target.
- **Calm over density-for-its-own-sake.** The interface should have a **calm resting state** — quiet, uncluttered, guidance available on demand rather than crowding every element. This is an explicit product goal, not a vibe.
- **Touch and keyboard as first-class**, not afterthoughts. Many in this cohort use tablets and phones, and hover-dependent patterns (tooltips) actively fail them — Book deliberately uses click-toggle help instead.
- **Frugality with bytes.** The design must not be heavy. Favor system-cacheable assets, restrained imagery, and effects that cost little to render and download. A beautiful design that is slow on DSL has failed this audience.

Yet the bar is genuinely high on *attractiveness*. The editor's stated goal: **"I want users to say 'wow, that UI looks really nice.'"** Clean and accessible must not read as plain or clinical — the negative example the editor flagged in a reference was "it's plain; I'd like more shading and subtle colors." Aim for *refined*, not *bare*.

---

## 4. The composite-system mandate (Book + Ghost)

Book and the Ghost site (pbe400.org) are intended to feel like **one system**. But this is **not** "make Book look like Ghost." The editor's intent — and your working frame — is **co-design**:

> Design Book the way it should be, under a few hard constraints borrowed from Ghost, **with the explicit requirement that the resulting visual language must also be able to be used to re-skin the Ghost theme.** Book is designed first; the design will then back-ported onto the Ghost theme so the two converge.

The Ghost theme is a heavily-logic-modified fork of the **Maali** theme (https://ghost.org/themes/maali/), whose *visual* appearance is largely untouched — a clean, light, editorial look (white surfaces, simple article-card grid, restrained accent). See `../design-references/Ghost-PBE-News-Home-Page.png` for the current state. Maali is already token-driven (a `--ghost-accent-color` set in Ghost admin plus a `--color-*` neutral ramp), which is what makes the back-port realistic.

**The three constraints to borrow from Ghost** (treat these as fixed; everything else in Book is yours to design fresh):

1. **The masthead is the shared signature.** PBE News renders its masthead title ("Phi Beta Epsilon News") in the **Manufacturing Consent** display font (Google Fonts), echoing the old print edition's masthead. Book's top-bar wordmark should use the **same font** as the explicit visual tie between the two systems. (On Ghost it is injected via Code Injection onto `.header__title`.) This is a *display* face — use it for the masthead/wordmark **only**, never for UI or body text.

2. **The upper-right identity menu is the shared interaction pattern.** Ghost places a member avatar in the upper-right that opens an account menu. Book mirrors this: a small person icon (the user's own headshot downscaled, falling back to a generic avatar) in the top-right that links to the user's profile and anchors the global controls. Keep this pattern recognizable across both.

3. **Palette and type kinship.** The two should read as relatives. Deliver Book's palette and type as **token values** (§8 and §11) so they can be ported into Maali's variable layer; a Book accent that cannot become a Ghost accent has missed the point.

Everything else — Book's directory grid, profile layout, forms, chips, dialogs — Book designs on its own terms. When you choose a palette and type system, choose one that you would be comfortable also applying to a clean editorial publication site, because it will be.

---

## 5. Aesthetic direction and mood

**Clean, modern, minimal — with one heritage element.**

- The overall character is a **polished, modern, minimal tool**: calm surfaces, clear hierarchy, generous whitespace, restrained and *meaningful* use of color, subtle shading and depth rather than flat blankness. Think "refined modern data app," not "enterprise spreadsheet" and not "maximalist dashboard."
- The **one heritage element** is the **masthead** in Manufacturing Consent (§4), which gives every page a quiet thread of the fraternity's 1890 print tradition without making the app feel old. Resist the urge to add more period styling — the heritage should be a grace note, not the theme.
- **Typography (decided):** Book uses **sans-serif throughout** for UI and body — the masthead is the sole display exception. The usual "serif aids long-form readability" argument does not apply here because **Book has essentially no long-form text**; the few multi-sentence strings (an obituary blurb, a privacy notice, a consent explanation) default to the same UI sans for consistency, at your discretion. Pick **one clean, highly legible UI sans** (Inter or a close peer) and use it everywhere but the masthead. (The serif-for-long-form principle is instead honored on the Ghost side, whose article body stays serif — so the two systems remain coherent without forcing a serif into a data app.)
- **Emotional register matters in two places.** The **In Memoriam** treatment for deceased brothers must read as a **dignified memorial, not a status flag** (§9, §10). And the **privacy/consent** controls must feel calm and trustworthy, because they carry the app's honesty about data sharing.

The "wow" the editor wants comes from **craft**: confident type, a distinctive-but-restrained palette drawn from PBE's own emblems, real attention to spacing and alignment, circular headshots that bring the people forward, and a few tasteful touches of color and depth — not from ornament or visual noise.

---

## 6. Brand assets and palette

The brand artwork lives in **`../design-references/Old Artwork/`** — sample colors directly from these files rather than trusting the approximate hexes below. The most useful are:

- **`PBE Triangle-Date RGB.png`** — the teal triangle emblem with **ΦΒΕ**, the **ivy leaf**, and **1890** in gold. The cleanest source of the core palette.
- **`PBE Renewed Emblem RGB.jpg`** — a brighter azure triangle with a gold inner border and the ivy leaf.
- **`PBE_Crest_Peacock.jpg`** — the full coat of arms (light-blue shield, ivy leaf, gold elements, Greek motto). Useful for motif vocabulary, not for direct screen use.
- Other triangle/letterform variants (`PBE Triangle.png`, `ØBE Horiz Letters.png`, `PBE Triangle-Date-Gold.png`) for the wordmark/favicon exploration.

**Approximate palette (sample the files for exact values):**

| Role | Color | Approx. | Notes |
|---|---|---|---|
| Primary / brand | Petrol **teal** | `#1A7A8C` | The date-emblem triangle. Strong, distinctive, calmer than a generic blue. |
| Secondary | **Azure** | `#2E97D4` | The renewed-emblem triangle; a brighter relative of the teal. |
| Accent / heritage | **Antique gold** | `#B8995E` | The "1890" lettering and emblem borders. The signature warm accent; use sparingly (the **gold star**, fine rules, selected states). |
| Living symbol | **Ivy green** | `#2E8B6B` | The ivy leaf set within the triangle emblem. A natural choice for positive/affirmative semantics. |
| Neutrals | white → near-black ramp | — | The working surfaces of a calm data app. |

**Motifs** available for tasteful, sparing use: the **triangle**, the **ivy leaf**, **ΦΒΕ**, and **1890**. The **triangle is PBE's true, primary historic symbol** — and the **ivy leaf is integral to it**, set inside the triangle alongside **ΦΒΕ** and **1890** (see `PBE Triangle-Date RGB.png`). This triangle emblem, leaf and all, is the natural anchor for the app icon/favicon and the wordmark. What is *secondary* is the separate **heraldic coat of arms** (`PBE_Crest_Peacock.jpg`) — the shield that makes the ivy leaf its central charge — an "outward-facing" device created in the early twentieth century when outsiders asked for arms PBE did not have (its real symbol being the triangle). The coat of arms has since become a legitimate historic symbol in its own right and is fully open for use, but it should read as the supporting mark, not the lead — better suited to an empty-state illustration or a quiet watermark than the primary icon. Use all of these with restraint.

**Rules for color use:**

- Keep the **working surfaces neutral** so a data-dense directory stays calm; spend brand color on **accents and semantics** (the gold star, a role badge, a selected row, a focus ring, status chips), not on large fields.
- Both **light and dark** themes are required and equally first-class (§8). Derive the dark theme deliberately — do not just invert.
- Every brand color used for text, UI, or state must pass **WCAG 2.2 AA contrast in both themes** (§8). The gold in particular is easy to get wrong on white — verify it.

---

## 7. Reference inspiration (what the editor likes)

The editor assembled an annotated reference set — **five directory examples and two profile examples**, each captioned with what the editor does and doesn't like — in `../design-references/Examples of Visually Attractive CRUD UIs.md` (its screenshots travel with it in `../design-references/_attachments/`). **Read that note in full; it is the authoritative inspiration source**, and the distilled highlights below are only a starting orientation, not a substitute for it. Treat the examples as **principles to hit, not skins to copy.** Several are dark-themed: the clean dark *directory* examples (e.g. Linear) are genuine targets for Book's dark theme, whereas the one *"gamer"-styled profile* is liked only for its layout and identity ideas, not its aesthetic.

**Directory references** — the editor's stated favorite is the Flowbite CRUD table (https://flowbite.com/blocks/application/crud/#crud-layout-for-user-management); the note annotates four more (see it for the rest). Liked in the Flowbite example:
- **Circular headshot photos** in the user column — bring the people forward.
- **Meaningful color in a few columns** (status, rating, role) — color as information, used selectively, not everywhere.
- **Chips** for role/category.

**Profile reference 1.** Liked: the **photo set to one side with fields beside/below it** reads better than a photo simply stacked on top (and can collapse to photo-on-top on a small screen). Disliked: **"it's plain; I'd like more shading and subtle colors"** — a direct steer toward subtle depth and tasteful color over flat blankness.

**Profile reference 2.** Liked: the **photo-to-side, fields-to-the-right** layout again; **subtle use of color**; **chips**; and an **identity button in the upper-right** showing an **avatar thumbnail and the user's role** (which aligns with §4's shared upper-right pattern).

**Distilled targets:** circular avatars in the grid; selective, *meaningful* color in a few columns and states; chips (Book has a real use — the academic majors, §10); a profile with the headshot to one side; subtle shading/depth over flatness; and an upper-right identity affordance with avatar + role.

---

## 8. Hard constraints (non-negotiable)

These are policy and architecture, not preferences. A design that violates any of them cannot be used.

1. **WCAG 2.2 AA — verified, both themes.** AA color contrast must hold in **light and dark**. Contrast is gated in CI, so a palette that fails will literally block the build. This covers text, UI components, focus indicators, and the placeholder/helper text colors.
2. **Meaning is never carried by color alone.** Every status that has a color also has a non-color cue: the **star** differs by *shape and fill* (filled gold vs. hollow outline), the **role badge** carries *text* ("MANAGER"/"ADMINISTRATOR"), **In Memoriam** is rendered as *words*, **deceased** thumbnails get a *diagonal corner bar* plus text, **de-brothered** names get a *strikethrough* plus a text marker, and the **major chips'** meaning is the *code text*, with color only a grouping aid. Honor this everywhere you reach for color to signal state.
3. **One token layer, light + dark.** All color and type live in a **CSS-variable token layer** (Tailwind/shadcn variables), so the whole look can be re-skinned by changing token values without touching component logic — and so it can be ported to Ghost. Your deliverable must be expressible as **two token sets** (light and dark), not bespoke per-component styling. (Token names in §11.)
4. **Font-size scaling in three steps.** Users can choose **Normal / Large / Larger**, implemented by scaling the root font-size with **all sizing in `rem`**. Every layout must remain usable and uncramped at the **largest** setting — design with that in mind, not just the default.
5. **Three-state theme.** **Light / Dark / System** (System follows the OS). Both themes are real deliverables; design dark deliberately.
6. **Touch targets ≥ ~44×44px** with adequate spacing, on every interactive element, at every breakpoint.
7. **Visible focus, always.** A clear, styled focus indicator on every focusable element — never removed. (A natural place for an accent: the teal or gold ring.)
8. **Respect `prefers-reduced-motion`.** Any motion you introduce must have a reduced/none variant. Keep motion subtle regardless — this audience and the byte-budget both argue against flashy animation.
9. **Component substrate is shadcn/ui + Radix.** Book is built from shadcn/ui (Radix primitives + Tailwind). Design *with* that grain. Where you reference another system's look (e.g. Material 3 input chips for the majors), it is a **visual reference only** — the component is rebuilt in shadcn; do not assume a second UI library.
10. **Byte-frugality.** Prefer system-cacheable, lightweight assets. Limit web-font weights to what's needed (the UI sans plus the single display face). Avoid heavy background images or large decorative assets. Effects should be cheap to render on modest hardware.
11. **Responsive by viewport width, not device.** A single breakpoint matters most: at Tailwind's **`md` (~768px)**, the Directory grid switches from a table to **stacked cards**, and the Profile collapses from two-up to a single column. Design both forms.

---

## 9. Screens to design

For each, the full functional spec is in `PRD.md` §5 (section numbers given). Design **light and dark**, and where noted, **desktop and mobile**.

### 9.1 App shell (PRD §5.2)
A persistent **slim top bar** on every page:
- **Left:** the app name/logo wordmark (in Manufacturing Consent), linking home to the Directory.
- **Right cluster:** the **person icon** (user's own headshot, downscaled, → their profile); beside it for elevated roles a **role badge** reading "MANAGER" or "ADMINISTRATOR" (brothers see none); a **"Report a bug"** control (opens a small form; PRD §5.2, D121); the account menu (includes **Sign out**). On phone widths the right cluster **collapses into one menu**.
- **Optional system banner** (PRD §5.2/§5.8, D117): a full-width admin-set message bar *above* the top bar, info or warning severity, persists until cleared (not per-user dismissible). Mirrors Ghost's announcement bar in spirit.
- **Persistent footer** (PRD §5.2, D116): a slim, deliberately quiet footer with a link to PBE's privacy notice.
- **Loading overlay** (PRD §5.5, D119): because the backend scales to zero, first load after a quiet period can take several seconds. Show a **"Loading…" overlay only past a short threshold**, adding a **"waking the server…"** reassurance line if it runs longer, removed the instant the directory can render. Design it to feel calm and intentional, not alarming.
- **Maintenance page** (PRD §5.2, D118): a full-page "down for maintenance, check back later" state for when the system itself is down. Distinct from the banner.

### 9.2 Directory page (PRD §5.6) — the home page and primary workspace
A **table ("grid")** of brother rows, searchable/filterable/sortable. Design:
- **Columns:** four fixed at the left edge in order — **Select** (checkbox; managers/admins only), **Star**, **Thumbnail** (96×96, circular per the references), **Canonical Name** (`First Last 'YY`) — then user-selectable, drag-reorderable columns (default: Class Year, Major, Email, Telephone, City, State/Province, Country).
- **The four left columns freeze** as a contiguous block during horizontal scroll; the **header row is sticky** during vertical scroll. **Zebra striping**; **hover and keyboard-focus** row highlight.
- **Star cell:** filled **gold** star vs. hollow outline (shape+fill, not color alone).
- **Name Search** box (labeled "Name Search"), an **"Include deceased"** checkbox, and a **"Starred only"** toggle, grouped near the top. Matched characters are highlighted in results.
- **Collapsible filter panel** above the grid (PRD §5.6.4): typed controls (numeric range input for Class Year, multi-selects for Major/Country/State, substring for City, presence/boolean filters for managers). Design the panel's resting (collapsed) and open states.
- **Action bar** (managers/admins only, PRD §5.6.8): **Export**, and for admins **Add Brother**. On phone widths these fold into an overflow menu.
- **Result-count readout** ("248 brothers") in place of pagination (the list is virtualized but scrolls as one continuous list — design it to read as a single long list, no page controls).
- **A Reset control** that clears search/filter/sort.
- **Deceased rows** (PRD §5.6.5): thumbnail carries a **dark diagonal corner bar** plus an **"In Memoriam"** text marker on the row.
- **De-brothered rows** (PRD §5.6.5, managers/admins only): **Canonical Name struck through** plus a text marker.
- **Unlisted rows** (D124, managers/admins only): a brother can mark his record **Unlisted** (a self-service privacy hide); to managers/admins it still appears, badged **"UNLISTED."** This badge must be **visually distinct from the de-brothered strikethrough** — de-brothered = expelled (name struck through); unlisted = present-but-private, so it reads as a **calm badge, not a strike**, in the app's "calm, trustworthy privacy" register.
- **Empty/edge states:** "Starred only" with no stars ("You haven't starred anyone yet — click a star to add them"); a zero-results search.
- **Mobile (< md):** the grid becomes a **virtualized list of stacked, tappable cards**. Design the card: thumbnail, name, a few key fields, the star, In Memoriam/de-brothered markers.

### 9.3 Profile page (PRD §5.7) — view and edit
One layout serves four audiences (owner, peer, manager, admin); fields a viewer may not see are simply absent. Design **view mode** and **edit mode**.
- **Layout (PRD §5.7.1):** a **full-width identity header** over a **responsive multi-section grid** that places sections two-up at `md`+ and collapses to one column below. Per the editor's reference preference, the **identity header places the headshot to one side** with identity fields beside/below it (collapsing to photo-on-top on mobile). The header holds: the headshot, the large **Canonical Name**, class year, the Constitution ID in house form (`#5247`), and the underlying name fields.
- The default section sequence is: **Identity header** (full width) → **Contact ‖ Emergency contacts** → **Professional & personal ‖ Relationships** → **Preferences & consent ‖ Record status / verification**. (Visual placement must never diverge from reading order — pair only adjacent sections. This is a firm accessibility rule; see PRD §5.7.1.)
- **Edit mode** is its own state with **Save / Cancel**; an **Edit** button enters it (owner, managers, admins).
- **In Memoriam** (PRD §5.7.7): when deceased, the profile opens with a **large, respectful "In Memoriam" banner** across the top — a dignified memorial, not a status badge — the headshot carrying the same diagonal corner bar, with the public deceased fields (date of death, obituary link, In Memoriam article link) below, alongside a **lifespan line** in memorial "b."/"d." notation (D122): "1940–2024" when both birth and death year are known (typographic **en-dash**, ideally non-breaking), "d. 2024" when only the death year is known, and nothing when only the birth year or neither is known. This is an emotional-design moment; give it real care.
- **Unlisted badge** (D124, managers/admins only): when a brother has marked his record **Unlisted**, the Profile carries the same **"UNLISTED"** badge as the Directory row — a **calm badge**, kept **visually distinct from the de-brothered strikethrough** (present-but-private, not expelled), in the app's "calm, trustworthy privacy" register.
- **Verification** (PRD §5.7.6): a Record-status area showing "Last verified YYYY-MM-DD by [name]" or "Not verified," and a **Verify** button. A gentle "please confirm your info" banner when the owner's record is stale (>2 years or never).
- **Admin controls** (PRD §5.7.10): **Delete Brother**, **Change role** (an explicit Brother/Manager/Administrator selector), and **De-brother / Reinstate** — each behind a confirmation of the appropriate tone (§10).

### 9.4 Add-Brother page (PRD §5.4, §5.7.8) — admin only
A focused entry form at `/brother/new` for the rare new record. Essentially the Profile edit form with a required, uniqueness-checked **Constitution ID** field (read-only everywhere else). Design it as a clean single-purpose form.

### 9.5 Admin page (PRD §5.8) — admin only
A narrow control panel for the whole-database operations that remain online: **Download backup**, **Sync with Ghost** (triggers a reconciliation audit and shows a **discrepancy report** on the page), and the **system-message banner** control (compose text + info/warning severity + set/clear). Each action carries a proportionate confirmation and clear result reporting. Design the page and the discrepancy-report presentation.

### 9.6 Key cross-cutting states
- **The conflict-reconcile state** (PRD §5.7.9): when a save is rejected because the record changed underneath, the user's edits are preserved and the changed fields are shown read-only beside the pending edits for manual reconciliation, with an announced notice ("This profile was changed while you were editing"). Design how the "changed underneath" fields are visually distinguished from the user's pending edits.
- **Loading, empty, error, and zero-results** states across the app (some listed above).

---

## 10. Components to design

Most come from shadcn/Radix and just need theming, but several are custom or carry specific requirements. Design the look (light + dark, all interaction states):

- **Buttons** — primary, secondary, quiet/ghost, and **destructive**. The brand accent (teal/gold) belongs here, used with restraint.
- **Inputs, selects, checkboxes, comboboxes** — including the searchable **combobox** used for majors and the Big-Brother typeahead. Persistent visible labels (never placeholder-as-label); helper text; AA-contrast placeholders.
- **Switches (privacy/consent toggles)** (PRD §5.7.3) — the most distinctive form control. **Eight** boolean switches, each **stating the currently-true consequence inline in plain language** (e.g. "Brothers can reach you by email"), **most** defaulting to the open/opted-in side — but the three that share *beyond the brotherhood* (emergency-contact, spouse/partner, and MITAA) defaulting **off / opt-in** (D89/D93) — with the **opposite-state consequence living in the switch's `?` help tip** (below). The same switch form also carries the separate **"Unlisted"** whole-record privacy control (D124). Design these to read as calm, trustworthy, and legible — they carry the app's data-honesty. Group lightly so they don't read as a wall (two of them group under an "Emails from PBE News" heading).
- **Major chips** (PRD §5.7.4) — draggable, removable "chips," one per course code, **colored by base course number** (every Course 6 variant shares a hue) — styled after Material 3 input chips but built in shadcn. The chip **text is the meaning** (the code); color is only a grouping aid; each chip's accessible name carries the full course name. **Deliver a course-area color palette** (a small set of distinguishable hues) that passes **AA contrast** in both themes. Also design the chip's editing affordances (drag handle, remove, the keyboard "Move/Make-first" controls), and note that the **first chip** is the one shown in the Directory.
- **The `?` help control** (PRD §5.9) — a **question-mark-in-a-circle** (Lucide `CircleHelp`) inside a real `<button>` with a ≥44px target, built on a **Radix Popover** (click-toggle disclosure, **not** a hover tooltip). It inherits `currentColor` and is sized in `rem`. Placed consistently immediately after a control's label. Design its resting icon and its opened popover.
- **Confirmation dialogs — three deliberately distinct tones** (PRD §5.7.7, §5.7.10):
  - **Soft/gentle** — *Mark deceased* ("significant, but reversible").
  - **Deliberate/consequential** — *De-brother* (grave, but reversible; distinct from both others).
  - **Destructive/"scary"** — *Delete brother* ("This cannot be undone").
  Make the three visually legible as different weights of warning.
- **Toasts / inline notices** — quiet success (e.g. "Saved — verified as of today"), errors, the announced conflict notice.
- **Role badge** — the "MANAGER" / "ADMINISTRATOR" text badge in the top bar (text, not color alone).
- **Avatar** — circular headshot thumbnail and the generic fallback avatar (used in the grid, the top-bar identity icon, and chips).
- **Lock affordance + "private" marker** (PRD §5.7.2) — managers see restricted fields **read-only and visibly locked**, and where a brother's toggle is *off*, a **"this field is private" marker in place of the value**. Design both.
- **"UNLISTED" badge** (D124, managers/admins only) — the badge shown on an unlisted brother's Directory row/card and Profile. A **calm badge** in the "calm, trustworthy privacy" register, deliberately **distinct from the de-brothered strikethrough** (present-but-private, not expelled). Design it for both the grid/card and the Profile header.
- **In Memoriam treatments** — the **profile banner** (dignified, §9.3), including the **lifespan line** in "b."/"d." notation (D122; en-dash range, "d. YYYY," or omitted); the **diagonal corner bar** on headshots/thumbnails; and the row/card text marker.
- **Headshot crop modal** (PRD §5.7.5) — a Radix Dialog wrapping react-easy-crop: a **1:1 crop frame**, zoom, drag-to-pan, with **explicit keyboard-operable** zoom buttons and arrow-key panning (crop widgets are an accessibility weak spot — design the keyboard affordances visibly).
- **Tables/grid chrome** — header row, sort indicators, zebra rows, frozen-column shadow/edge, selected-row state, the result-count readout.

---

## 11. Deliverables expected back

Please return a design that the team can drop into Book's token layer and key screens. Concretely:

1. **Two token sets — light and dark** — as concrete values mapped to the shadcn/Tailwind CSS-variable names, including at least: `--background`, `--foreground`, `--card`/`--card-foreground`, `--popover`/`--popover-foreground`, `--primary`/`--primary-foreground`, `--secondary`/`--secondary-foreground`, `--muted`/`--muted-foreground`, `--accent`/`--accent-foreground`, `--destructive`/`--destructive-foreground`, `--border`, `--input`, `--ring`, and a small set of **semantic/state** tokens (success/ivy, warning, info, the gold "starred" and selected-row states). Note which brand color maps to which token. Confirm each passes **AA contrast** in both themes.
2. **Type system** — the UI sans choice and the Manufacturing Consent masthead, with a **type scale** in `rem` (so it scales with the font-size preference), weights, and line-heights for headings, body, labels, helper text, and the masthead.
3. **Spacing, radius, elevation** — the spacing scale, corner radius, and a restrained shadow/elevation system (subtle depth, per the "not flat/plain" steer).
4. **The course-area chip color palette** (§10) — a named set of distinguishable, AA-passing hues.
5. **Key-screen mockups** (light and dark; desktop and mobile where noted): the **app shell** (top bar + footer + an example system banner); the **Directory** (desktop grid and mobile cards), including a **deceased** row and a **manager's** view (the latter showing the **de-brothered strikethrough** and an **"UNLISTED"** badge side by side, so their distinction is legible — D124); the **Profile** in **view** and **edit** mode, including the **In Memoriam** state (with the **lifespan line**, D122); one **confirmation dialog** of each of the three tones; the **`?` help popover**; and the **loading overlay**.
6. **Brand-motif guidance** — how (and how sparingly) the triangle / ivy / ΦΒΕ / 1890 motifs appear (app icon/favicon, empty states, any quiet watermark), and the wordmark treatment.
7. **A short rationale** — a paragraph or two on the palette and type choices, especially how the chosen accent works as a **Ghost accent** too (§4), so the back-port is grounded.

Everything must be **expressible purely through the token layer and shadcn components** — if a screen needs a one-off color or font outside the tokens, flag it explicitly.

---

## 12. Out of scope

- **Deferred pages** — the **Report / analytics** page and the **Big-Brother graph browser** are post-MVP (PRD §3.2). Do not design them. (You may keep them in mind so the system could accommodate them later, but they are not deliverables.)
- **Anything non-visual** — backend, data model, API, security, performance engineering. Where a technical fact constrains the look, it is called out above; you need nothing further.
- **New functionality or restructured flows.** The structure and behavior are locked (PRD §5). If a visual idea seems to require a behavioral change, **flag it** rather than designing around it — it likely conflicts with a deliberate decision.

---

## 13. Source pointers

- **Authoritative UI spec:** `pbe-address-book/docs/initial-build/PRD.md` §5 (page-by-page), §4 (roles/visibility), §6 (Ghost/Linter/MITAA integration).
- **Brand artwork:** `pbe-address-book/docs/design-references/Old Artwork/` (sample colors from the files).
- **Editor's reference collection:** `pbe-address-book/docs/design-references/Examples of Visually Attractive CRUD UIs.md` (self-contained — its screenshots are in `pbe-address-book/docs/design-references/_attachments/`).
- **Current Ghost look:** `pbe-address-book/docs/design-references/Ghost-PBE-News-Home-Page.png`, and the live theme under `pbe-news-ghost-theme/` (Maali fork; token layer in `assets/css/settings/` and `assets/css/components/_color-scheme.css`). The Manufacturing Consent masthead is injected via Ghost Code Injection onto `.header__title`.
- **Decision rationale (only if you want the "why"):** `pbe-address-book/docs/initial-build/DECISIONS.md` — notably D29 (component stack/theming), D32/D79 (accessibility policy), D113 (the consent-toggle copy), D115 (de-brothering), D116–D119/D121 (footer, banner, maintenance page, loading overlay, report-a-bug). You should not need these to do the visual work.
