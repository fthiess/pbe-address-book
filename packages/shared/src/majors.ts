/**
 * The MIT **course (major) vocabulary** — code → display name (DATABASE-SCHEMA
 * §6.2). At MIT a major is universally referred to by its **course number**
 * ("Course 6", "6-3"), so the number is the primary label everywhere; the name
 * is augmenting context (shown in the filter list and on hover over a course
 * chip).
 *
 * SCOPE (2026-06-28): this bundles only the **codes the dataset currently uses**
 * — a deliberate minimal step. DATABASE-SCHEMA §6.2 / D69 specify the full
 * vocabulary as a runtime-editable Firestore `majors` collection (so MIT's
 * course-number changes need no code release); that remains future work. Until
 * then this bundled lookup supplies display names the same way `geo.ts` bundles
 * country names — see DECISIONS N29.
 */

export interface Major {
  /** The course code and document id, e.g. "6-3". */
  code: string;
  /** The human-readable course name, e.g. "Computer Science and Engineering". */
  displayName: string;
  /** false = retired but still valid for historical profiles (none yet). */
  active: boolean;
}

/** The course vocabulary, keyed by code. Covers exactly the codes in use today. */
export const MAJORS: readonly Major[] = [
  { code: "6-1", displayName: "Electrical Science and Engineering", active: true },
  { code: "6-2", displayName: "Electrical Engineering and Computer Science", active: true },
  { code: "6-3", displayName: "Computer Science and Engineering", active: true },
  { code: "2", displayName: "Mechanical Engineering", active: true },
  { code: "7", displayName: "Biology", active: true },
  { code: "8", displayName: "Physics", active: true },
  { code: "10", displayName: "Chemical Engineering", active: true },
  { code: "14", displayName: "Economics", active: true },
  { code: "15", displayName: "Management", active: true },
  { code: "16", displayName: "Aeronautics and Astronautics", active: true },
  { code: "18", displayName: "Mathematics", active: true },
  { code: "21", displayName: "Humanities", active: true },
];

/** The set of course codes the vocabulary covers (the fake-data generator draws from this). */
export const MAJOR_CODES: readonly string[] = MAJORS.map((m) => m.code);

const BY_CODE = new Map(MAJORS.map((m) => [m.code, m]));

/** The course's display name, or "" when the code is unknown to the vocabulary. */
export function courseName(code: string): string {
  return BY_CODE.get(code)?.displayName ?? "";
}

/**
 * The full label "code — Name" (e.g. "6-3 — Computer Science and Engineering"),
 * for the filter checkbox and the chip's hover/accessible name. Falls back to the
 * bare code when the name is unknown, so an unrecognised code still reads cleanly.
 */
export function courseLabel(code: string): string {
  const name = courseName(code);
  return name ? `${code} — ${name}` : code;
}

/**
 * Order course codes the way MIT lists them — **numerically**, not as strings, so
 * Course 2 precedes Course 10 (a plain string sort puts "10" before "2"). Compares
 * the leading number first, then the dash sub-number (6-1 < 6-2 < 6-3, a bare "6"
 * before its dashed variants). A non-numeric code falls back to a locale compare.
 */
export function compareCourseCodes(a: string, b: string): number {
  const parse = (code: string): [number, number] => {
    const [main, sub] = code.split("-");
    return [Number.parseInt(main ?? "", 10), sub === undefined ? -1 : Number.parseInt(sub, 10)];
  };
  const [aMain, aSub] = parse(a);
  const [bMain, bSub] = parse(b);
  if (Number.isNaN(aMain) || Number.isNaN(bMain)) {
    return a.localeCompare(b);
  }
  return aMain !== bMain ? aMain - bMain : aSub - bSub;
}
