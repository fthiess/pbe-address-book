# Handoff: PBE Address Book

## Overview
A members' address book / directory web app for the Phi Beta Epsilon (PBE) fraternity, sibling to the PBE News site (pbe400.org). It lets brothers find and update contact records, and gives managers/administrators tools to maintain membership: roles, privacy, "deceased / In Memoriam," "de-brother," "unlisted," and record deletion. The audience skews 60+, so legibility, large hit targets, calm confirmations, and full keyboard/AT support are first-class requirements. Light **and** dark themes; WCAG 2.2 AA in both.

## About the design files
The files in `references/` are **design references created in HTML** — prototypes that show the intended look, layout, copy, and behavior. **They are not production code to copy.** They are authored as self-contained "Design Component" HTML docs (each `.dc.html` stacks several states/screens on one page for review).

The task is to **recreate these designs in the target codebase** using its established environment and patterns. The team is building with **React + Tailwind + shadcn/ui**, so:
- Wire `tokens.css` into the shadcn token layer (`globals.css` `:root` / `.dark`) and build screens from shadcn primitives (Button, Switch, Popover, Dialog, Badge, Table, Tooltip, Tabs, Select, Checkbox…).
- Treat the HTML as the visual + behavioral source of truth; do not ship the HTML.
- If something isn't covered by a shadcn primitive (the avatar-with-mourning-band, the chip editor, the UNLISTED badge), build it as a small custom component per `COMPONENTS.md`.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, shadows, copy, and states are final. Recreate pixel-close using shadcn + the tokens here. Where this doc and the HTML disagree, the HTML wins — but it should match.

## What's in this bundle
```
design_handoff_pbe_address_book/
├── README.md            ← you are here
├── tokens.css           ← LOAD-BEARING. shadcn-named light+dark vars + brand/semantic/chip tokens + type scale
├── COMPONENTS.md        ← component & state spec (buttons, switch, ?, badges, dialogs, grid, filter, …)
├── ASSETS.md            ← motif (triangle/crest/ivy), avatar approach, fonts, color discipline
├── assets/
│   ├── crest.svg            ← masthead crest (wide isosceles triangle)
│   └── favicon/             ← finished ivy-leaf favicon set (.ico, png 16–512, apple-touch) + HOWTO.txt
├── references/          ← the HTML design prototypes (each self-contained; runtime embedded, no support.js)
│   ├── Book - Design Package.dc.html  ← START HERE — human entry point, links to all six
│   ├── Profile.dc.html
│   ├── Directory.dc.html
│   ├── Shell and Components.dc.html
│   ├── Admin.dc.html
│   ├── Profile-print.dc.html
│   ├── Design System.dc.html
│   └── Design Direction.dc.html
└── screenshots/         ← rendered PNGs of the key screens (visual reference)
```

## Screens / views
(Each reference HTML stacks multiple states; this is the inventory.)

### App shell — `Shell and Components.dc.html`
- **Layout**: optional system banner (gold warning) → top bar (crest + wordmark · spacer · PBE News link · theme switch · Report a bug · role pill · avatar menu) → page content → footer (now just "Privacy notice", right-aligned — brand line & footer PBE News link were removed as redundant with the top bar).
- Also contains: loading overlay, `?` help popover, headshot crop modal, the **three confirmation tones**, buttons/focus specimen, success toast, and the **session-expired notice**.

### Directory — `Directory.dc.html`
- **Purpose**: find/sort/filter brothers; managers select rows and act in bulk.
- **Desktop (light, admin)**: top bar → controls row (search, "Include deceased", "Starred only", Filters[count], Columns, Reset, count, Export, Add Brother) → open filter panel → grid header → rows → "Showing n of N" → footer. Column grid `[☑][★][photo][name][class][major][email][city][state]`; first four frozen.
- **Row states**: default / zebra / hover / selected (teal left border + tint) / starred / **deceased (IN MEMORIAM)** / **de-brothered** (strike + ✕ avatar, manager view) / **unlisted** (slate UNLISTED badge, manager view). The deceased and unlisted/de-brothered states co-occur and must stay distinguishable.
- **Mobile (< md)**: stacked cards. **Dark**: brother view (no admin chrome).
- **Column chooser dialog**: drag-handle reorder, **keyboard-operable** (focus handle, ↑/↓ to move); frozen columns can't be hidden/reordered.
- **Filter value picker**: 300px popover with search + checkbox list (chip + match count) + Clear / Apply(n).
- Empty states: "no one starred", "no matches".

### Profile — `Profile.dc.html`
- **View mode**: identity header (avatar, name + class, IDs, chips, Verified) + sectioned grid (Contact, Emergency contacts [manager/admin-only], Professional & personal, Relationships [Big/Little Brothers], Preferences & consent summary, Record status).
- **Edit mode**: editable photo (upload → crop modal), boxed fields, the **majors chip editor**, the **8 privacy/consent switches with mixed resting states** (3 default off; emergency + spouse/partner toggles inline with their fields; MIT-Alumni off in panel), the **Unlisted whole-record control**, locked Little-Brothers list.
- **Admin view**: the profile + an Administrator-controls panel (Role segmented control, Mark deceased, De-brother, Delete) each opening its matched confirmation tone. Manager/admin views show the **UNLISTED** badge by the name when applicable.
- **In Memoriam**: dignified memorial — gold banner, **lifespan line** under the name (`1940–2024` / `d. 2024` / nothing; see rules in COMPONENTS.md), and below: Date of death, Obituary, In Memoriam article fields.
- **Deceased field group** (edit, managers/admins): reveals on the soft confirm, focus into the first field; five fields (date of death, year of death [fallback + helper], year of birth, obituary link, In Memoriam article link).

### Admin — `Admin.dc.html`
Administrator surfaces (membership/roles/record actions). Same shell + tones.

### Profile print — `Profile-print.dc.html`
Print-optimized profile layout.

## Interactions & behavior
- **Theme**: light / dark / system segmented control; persist choice; `prefers-color-scheme` for system.
- **Confirmations matched to weight**: soft (deceased) → deliberate (de-brother, with "I understand" checkbox) → destructive (delete, type `DELETE`). See COMPONENTS.md.
- **Privacy switches**: each shows its currently-true consequence inline; the `?` popover shows the counterfactual. Toggling is immediate-state in the form; saved on Save.
- **Mark deceased** → soft confirm → reveals the deceased field group, **moves focus into the first field**.
- **Column reorder**: drag OR keyboard (focus handle → ↑/↓). Frozen columns excluded.
- **Filters**: setting a filter opens the value picker; selections become chips + bump the Filters count.
- **Loading**: show the calm overlay only past a short threshold (cold-start server can take seconds).
- **Save**: re-verifies the record as of today; quiet success toast.
- **Session expired** (4-hour cap or membership removal): calm interstitial before the sign-in redirect — reassure, don't error.
- **Reduced motion**: spinner and transitions respect `prefers-reduced-motion`.
- **Responsive**: Directory collapses grid → cards below `md`.

## State management (functional notes for scaffolding)
- **Auth/session**: current user, role (`brother | manager | administrator`), 4-hour session cap → expired state.
- **Record fields** per brother: identity (first/last/full/class/constitution-id[read-only]), contact (email, alt email, phone, mailing address), emergency contacts[], spouse/partner, employer, majors[] (ordered; first is the directory chip), relationships (big brother [editable], little brothers [derived, read-only]), verification (date, by), and status flags: `deceased` (+ memorial fields), `deBrothered`, `unlisted`.
- **Privacy/consent** (8 booleans): emailReachable, cityStateVisible, phoneVisible, shareEmergencyContact(off), shareSpousePartner(off), shareMITAlumni(off), newsletter, eventInvites. Defaults: the three "beyond the brotherhood" off, rest on.
- **Visibility rules**: emergency contact, spouse/partner, and UNLISTED badge are **manager/admin-only**; unlisted records are hidden from brothers' directory but visible to managers/admins.
- **Directory view state**: search, filters (class-year range, majors[], state, city), sort column+dir, visible/ordered columns (4 frozen), starred set, includeDeceased, starredOnly, selection set (bulk).

## Design tokens
See **`tokens.css`** for the authoritative, exact values (light + dark) mapped to shadcn variable names, plus brand/semantic/chip tokens and the type scale. Highlights: primary teal `#007194`; canvas `#EEF0F1` / cards `#fff`; text ramp `#14181B → #5A6470 → #8A949C`; focus ring `0 0 0 3px rgba(0,113,148,0.20)`; card radius 18px / control radius 9px; card shadow `0 1px 2px /.04 + 0 10px 30px /.07`. Heritage gold `#AD8736`, memorial `#6E5526`, success `#1E7A50`, destructive `#B42318`.

### Tailwind v3 config snippet (if not on v4)
```js
// tailwind.config.js → theme.extend.colors — values via CSS vars
colors: {
  background: 'var(--background)', foreground: 'var(--foreground)',
  card: 'var(--card)', 'card-foreground': 'var(--card-foreground)',
  popover: 'var(--popover)', 'popover-foreground': 'var(--popover-foreground)',
  primary: 'var(--primary)', 'primary-foreground': 'var(--primary-foreground)',
  secondary: 'var(--secondary)', 'secondary-foreground': 'var(--secondary-foreground)',
  muted: 'var(--muted)', 'muted-foreground': 'var(--muted-foreground)',
  accent: 'var(--accent)', 'accent-foreground': 'var(--accent-foreground)',
  destructive: 'var(--destructive)', 'destructive-foreground': 'var(--destructive-foreground)',
  border: 'var(--border)', input: 'var(--input)', ring: 'var(--ring)',
},
borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
```
(Use these as plain hex too — every var has a concrete value in `tokens.css`.)

## Assets
See `assets/` (crest, favicon) and **ASSETS.md** for motif/font guidance. Fonts: Manufacturing Consent (masthead + "In Memoriam" only) and Inter (UI) from Google Fonts; self-host in production. No photographic/marketing imagery; avatars are CSS gradient + silhouette + initials; real headshots are user-uploaded (1:1).

## Files (references)
Each file is **self-contained** — the render runtime is embedded inline, so there is no separate `support.js`; just open any file in a browser.
- `references/Book - Design Package.dc.html` — **entry point**: a human-facing index that links to all six pieces below
- `references/Profile.dc.html` — view / edit / admin / In Memoriam / deceased field group
- `references/Directory.dc.html` — desktop grid, mobile cards, dark, row states, filter picker, column chooser
- `references/Shell and Components.dc.html` — shell, dialogs, popover, loading, toast, session-expired
- `references/Admin.dc.html`, `references/Profile-print.dc.html`
- `references/Design System.dc.html`, `references/Design Direction.dc.html` — broader system & rationale

> Open any reference file in a browser to see it live (start with **Book - Design Package.dc.html**). Screenshots of the key screens are in `screenshots/`.
