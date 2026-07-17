import { courseLabel, courseName } from "@pbe/shared";
import { EyeOff } from "lucide-react";

/**
 * The Directory's small chips and status badges (visual-design `COMPONENTS.md`).
 * Each carries its meaning in *text* — colour is only reinforcement, never the
 * sole signal (accessibility policy D32).
 */

/** Course-area chip palette families, keyed off the leading course number. */
export type ChipFamily = "teal" | "gold" | "green" | "purple" | "red" | "slate";

/** Map an MIT course code (e.g. "6-3", "18") to its area's chip family. */
export function courseFamily(code: string): ChipFamily {
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
export function familyStyle(family: ChipFamily) {
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
  // The course number is the visible label (how MIT majors are named); the full
  // course name augments it on hover (native tooltip) and in the accessible name.
  const name = courseName(code);
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums"
      style={familyStyle(courseFamily(code))}
      title={courseLabel(code)}
      aria-label={name ? `Course ${code}, ${name}` : `Course ${code}`}
    >
      {code}
    </span>
  );
}

/**
 * A brother's full course list rendered as chips on a single line, in their
 * chosen order (primary first). Chips keep their full size (`shrink-0`); the
 * caller's cell clips the overflow at its edge — no wrapping and no row-height
 * change, exactly like a too-narrow text column (OFC-269, amends D33's
 * primary-course-only Directory display). Renders nothing when the list is empty
 * (the caller shows its own em-dash placeholder).
 */
export function CourseChips({ codes }: { codes: readonly string[] }) {
  return (
    <span className="flex items-center gap-1">
      {codes.map((code) => (
        <span key={code} className="shrink-0">
          <CourseChip code={code} />
        </span>
      ))}
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
      <EyeOff size={11} strokeWidth={1.4} aria-hidden="true" />
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
