/**
 * The Directory's small chips and status badges (visual-design `COMPONENTS.md`).
 * Each carries its meaning in *text* — colour is only reinforcement, never the
 * sole signal (accessibility policy D32).
 */

/** Course-area chip palette families, keyed off the leading course number. */
type ChipFamily = "teal" | "gold" | "green" | "purple" | "red" | "slate";

/** Map an MIT course code (e.g. "6-3", "18") to its area's chip family. */
function courseFamily(code: string): ChipFamily {
  const lead = Number.parseInt(code, 10);
  switch (lead) {
    case 6:
      return "teal";
    case 2:
      return "gold";
    case 7:
      return "green";
    case 18:
      return "purple";
    case 10:
      return "red";
    default:
      return "slate";
  }
}

/** Inline style drawing a family's three chip tokens from the token layer. */
function familyStyle(family: ChipFamily) {
  return {
    color: `var(--chip-${family}-fg)`,
    backgroundColor: `var(--chip-${family}-bg)`,
    borderColor: `var(--chip-${family}-border)`,
  };
}

/**
 * A course chip — a rounded pill carrying the course code, tinted to the
 * course area (Course 6 → teal, 2 → gold, 7 → green, 18 → purple, 10 → red,
 * everything else → slate). The code text carries the meaning.
 */
export function CourseChip({ code }: { code: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums"
      style={familyStyle(courseFamily(code))}
    >
      {code}
    </span>
  );
}

/**
 * The manager/administrator **UNLISTED** badge (D124): a solid slate pill with an
 * eye-off glyph, marking a record the owner has hidden from peers. Present-but-
 * private — distinct from the de-brothered strike-through.
 */
export function UnlistedBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[length:var(--text-micro)] font-bold uppercase tracking-wide"
      style={familyStyle("slate")}
    >
      <EyeOffIcon />
      Unlisted
    </span>
  );
}

/**
 * The manager/administrator **DE-BROTHERED** badge (D115): an outline-only pill
 * (no fill) marking an expelled record. Pairs with the name strike-through and
 * the red ✕ over the avatar.
 */
export function DebrotheredBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-border px-1.5 py-0.5 text-[length:var(--text-micro)] font-bold uppercase tracking-wide text-muted-foreground">
      De-brothered
    </span>
  );
}

/**
 * The **IN MEMORIAM** badge shown on a deceased brother's row (D32/§5.6.5): a
 * gold-outline pill in the memorial tone, the textual half of the deceased
 * treatment (the mourning band on the thumbnail is the visual half).
 */
export function InMemoriamBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[length:var(--text-micro)] font-bold uppercase tracking-wide"
      style={{
        color: "var(--memorial-fg)",
        backgroundColor: "var(--gold-bg)",
        borderColor: "var(--gold-border-2)",
      }}
    >
      In Memoriam
    </span>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <path d="M2 2l12 12" />
      <path d="M6.5 6.6a2 2 0 002.8 2.8" />
      <path d="M8 3.5c3.2 0 5.6 2.4 6.5 4.5-.4.9-1 1.8-1.9 2.5M3.4 4.4C2.3 5.2 1.4 6.3 1 7.5c.9 2.1 3.3 4.5 7 4.5.9 0 1.7-.1 2.4-.4" />
    </svg>
  );
}
