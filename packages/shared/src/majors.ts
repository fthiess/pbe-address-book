/**
 * The MIT **course (major) vocabulary** — code → display name and colour family
 * (DATABASE-SCHEMA §6.2). At MIT a major is universally referred to by its
 * **course number** ("Course 6", "6-3"), so the number is the primary label
 * everywhere; the name is augmenting context (shown in the filter list and on
 * hover over a course chip).
 *
 * SCOPE (2026-08-01, D165/OFC-320): this is the curated launch vocabulary — the
 * 58 codes the Book ships with, covering brothers back to 1890. Historical
 * course *names* are folded into their modern entry rather than carried as
 * separate retired codes ("15 — Management / Industrial Management / Engineering
 * Administration"), so a brother who read Course 15 in 1958 and one who read it
 * in 2024 share a code. Numbers that were retired outright and never reused
 * (19 Meteorology, 13 Ocean Engineering) keep their own entry. Every code is
 * `active: true` for launch; if real member data turns up a genuinely extinct
 * course we will revisit (Forrest's call, 2026-08-01).
 *
 * Each code belongs to a **family** — the leading course number — and the family
 * is what carries a colour. All nine Course 6 codes wear one chip colour; see
 * `apps/web/src/styles/tokens.css` for the generated palette.
 *
 * DATABASE-SCHEMA §6.2 / D69 still specify the eventual runtime-editable
 * Firestore `majors` collection (so MIT's course-number changes need no code
 * release); that remains future work. Until then this bundled lookup supplies
 * display names the same way `geo.ts` bundles country names — see DECISIONS N29.
 */

/**
 * The colour families, in catalogue order. A family is the leading course
 * number; `Other` collects the lettered inter-school programmes (CMS, HST, STS).
 * These strings are the chip token keys (`--chip-6-bg`, `--chip-other-bg`), so
 * they are load-bearing — renaming one orphans three CSS variables.
 */
export const COURSE_FAMILIES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "24",
  "25",
  "Other",
] as const;

export type CourseFamily = (typeof COURSE_FAMILIES)[number];

export interface Major {
  /** The course code and document id, e.g. "6-3". */
  code: string;
  /** The human-readable course name, e.g. "Computer Science and Engineering". */
  displayName: string;
  /** The colour family this code belongs to — the leading course number. */
  family: CourseFamily;
  /** false = retired but still valid for historical profiles (none yet). */
  active: boolean;
}

/** The curated launch vocabulary, in catalogue order. */
export const MAJORS: readonly Major[] = [
  { code: "1", displayName: "Civil Engineering", family: "1", active: true },
  {
    code: "1-12",
    displayName: "Climate System Science and Engineering",
    family: "1",
    active: true,
  },
  { code: "2", displayName: "Mechanical Engineering", family: "2", active: true },
  {
    code: "3",
    displayName: "Materials Science and Engineering / Metallurgy / Mining Engineering",
    family: "3",
    active: true,
  },
  { code: "3-C", displayName: "Archaeology and Materials", family: "3", active: true },
  { code: "4", displayName: "Architecture", family: "4", active: true },
  { code: "4-B", displayName: "Art and Design", family: "4", active: true },
  { code: "5", displayName: "Chemistry", family: "5", active: true },
  { code: "5-7", displayName: "Chemistry and Biology", family: "5", active: true },
  {
    code: "6",
    displayName: "Electrical Engineering and Computer Science",
    family: "6",
    active: true,
  },
  { code: "6-1", displayName: "Electrical Engineering", family: "6", active: true },
  {
    code: "6-2",
    displayName: "Electrical Engineering and Computer Science",
    family: "6",
    active: true,
  },
  { code: "6-3", displayName: "Computer Science and Engineering", family: "6", active: true },
  {
    code: "6-4",
    displayName: "Artificial Intelligence and Decision Making",
    family: "6",
    active: true,
  },
  {
    code: "6-5",
    displayName: "Electrical Engineering with Computing",
    family: "6",
    active: true,
  },
  {
    code: "6-7",
    displayName: "Computer Science and Molecular Biology",
    family: "6",
    active: true,
  },
  { code: "6-9", displayName: "Computation and Cognition", family: "6", active: true },
  {
    code: "6-14",
    displayName: "Computer Science, Economics, and Data Science",
    family: "6",
    active: true,
  },
  { code: "7", displayName: "Biology / Life Sciences", family: "7", active: true },
  { code: "8", displayName: "Physics", family: "8", active: true },
  {
    code: "9",
    displayName: "Brain and Cognitive Sciences / Psychology",
    family: "9",
    active: true,
  },
  { code: "10", displayName: "Chemical Engineering", family: "10", active: true },
  { code: "10-B", displayName: "Chemical-Biological Engineering", family: "10", active: true },
  {
    code: "11",
    displayName: "Planning / Urban Studies and Planning",
    family: "11",
    active: true,
  },
  {
    code: "11-6",
    displayName: "Urban Science with Computer Science",
    family: "11",
    active: true,
  },
  {
    code: "12",
    displayName: "Earth, Atmospheric, and Planetary Sciences / Geology and Geophysics",
    family: "12",
    active: true,
  },
  {
    code: "13",
    displayName:
      "Naval Architecture and Marine Engineering / Ocean Engineering / Marine Transportation",
    family: "13",
    active: true,
  },
  { code: "14", displayName: "Economics", family: "14", active: true },
  { code: "14-1", displayName: "Economics", family: "14", active: true },
  { code: "14-2", displayName: "Mathematical Economics", family: "14", active: true },
  {
    code: "15",
    displayName: "Management / Industrial Management / Engineering Administration",
    family: "15",
    active: true,
  },
  { code: "15-1", displayName: "Management", family: "15", active: true },
  { code: "15-2", displayName: "Business Analytics", family: "15", active: true },
  { code: "15-3", displayName: "Finance", family: "15", active: true },
  {
    code: "16",
    displayName: "Aerospace Engineering / Aeronautics and Astronautics",
    family: "16",
    active: true,
  },
  { code: "17", displayName: "Political Science", family: "17", active: true },
  { code: "18", displayName: "Mathematics", family: "18", active: true },
  { code: "18-C", displayName: "Mathematics with Computer Science", family: "18", active: true },
  { code: "19", displayName: "Meteorology", family: "19", active: true },
  {
    code: "20",
    displayName: "Biological Engineering / Nutrition and Food Science / Food Technology",
    family: "20",
    active: true,
  },
  { code: "20-B", displayName: "Biochemical Engineering", family: "20", active: true },
  { code: "21", displayName: "Humanities", family: "21", active: true },
  { code: "21A", displayName: "Anthropology", family: "21", active: true },
  { code: "21E", displayName: "Humanities and Engineering", family: "21", active: true },
  { code: "21G", displayName: "Global Studies and Languages", family: "21", active: true },
  { code: "21H", displayName: "History", family: "21", active: true },
  { code: "21L", displayName: "Literature", family: "21", active: true },
  { code: "21M", displayName: "Music and Theater Arts", family: "21", active: true },
  { code: "21S", displayName: "Humanities and Science", family: "21", active: true },
  { code: "21T", displayName: "Theater Arts", family: "21", active: true },
  { code: "21W", displayName: "Writing", family: "21", active: true },
  { code: "22", displayName: "Nuclear Science and Engineering", family: "22", active: true },
  { code: "24-1", displayName: "Philosophy", family: "24", active: true },
  { code: "24-2", displayName: "Linguistics", family: "24", active: true },
  { code: "25", displayName: "Interdisciplinary Science Program", family: "25", active: true },
  { code: "CMS", displayName: "Comparative Media Studies", family: "Other", active: true },
  { code: "HST", displayName: "Health Sciences and Technology", family: "Other", active: true },
  {
    code: "STS",
    displayName: "Science, Technology, and Society",
    family: "Other",
    active: true,
  },
];

/** The set of course codes the vocabulary covers (the fake-data generator draws from this). */
export const MAJOR_CODES: readonly string[] = MAJORS.map((m) => m.code);

const BY_CODE = new Map(MAJORS.map((m) => [m.code, m]));

/** The course's display name, or "" when the code is unknown to the vocabulary. */
export function courseName(code: string): string {
  return BY_CODE.get(code)?.displayName ?? "";
}

/**
 * The colour family a course code belongs to — the leading course number, which
 * is what the chip palette is keyed on. Unknown codes fall back to `"Other"`, so
 * a code that predates the vocabulary still renders a chip rather than throwing.
 */
export function courseFamily(code: string): CourseFamily {
  return BY_CODE.get(code)?.family ?? "Other";
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
 * Course codes come in four shapes, and the comparator has to order all of them:
 * a bare number (`18`), a number with a letter suffix (`21W`), a number with a
 * numeric sub-code (`6-14`), and a number with an alpha sub-code (`18-C`). A few
 * inter-school programmes are pure letters (`CMS`) and have no number at all.
 */
const CODE_SHAPE = /^(\d+)([A-Za-z]*)(?:-(\d+|[A-Za-z]+))?$/;

/** `subKind` ranks the three sub-code forms: bare course first, then `-14`, then `-C`. */
const SUB_NONE = 0;
const SUB_NUMERIC = 1;
const SUB_ALPHA = 2;

interface ParsedCode {
  main: number;
  suffix: string;
  subKind: number;
  subNumber: number;
  subAlpha: string;
}

function parseCode(code: string): ParsedCode | null {
  const m = CODE_SHAPE.exec(code.trim());
  if (!m) {
    return null;
  }
  const [, main = "", suffix = "", sub] = m;
  const subKind = sub === undefined ? SUB_NONE : /^\d+$/.test(sub) ? SUB_NUMERIC : SUB_ALPHA;
  return {
    main: Number.parseInt(main, 10),
    suffix,
    subKind,
    subNumber: subKind === SUB_NUMERIC ? Number.parseInt(sub as string, 10) : 0,
    subAlpha: subKind === SUB_ALPHA ? (sub as string).toUpperCase() : "",
  };
}

/**
 * Order course codes the way MIT lists them — **numerically**, not as strings, so
 * Course 2 precedes Course 10 (a plain string sort puts "10" before "2"). Within a
 * family the bare code leads, then letter-suffixed subjects alphabetically
 * (21 < 21A < 21W), then numeric sub-codes (6-1 < 6-2 < 6-14), then alpha
 * sub-codes (18 < 18-C). The pure-letter programmes (CMS, HST, STS) sort after
 * every numbered course, alphabetically among themselves.
 *
 * ⚠ The comparator must be a **total order**: `Array.sort` has undefined behaviour
 * given a comparator that returns NaN or reports two distinct values as equal, and
 * an earlier version did both on the lettered codes — `21A` parsed as bare `21`
 * (tying with nine siblings) and `3-C` produced NaN from `parseInt("C")`. That
 * silently scrambled the Directory's Course column and the filter list. The
 * "consistent total order" test in `majors.test.ts` is the regression guard
 * (OFC-320; the natural-sort requirement itself is OFC-290).
 */
export function compareCourseCodes(a: string, b: string): number {
  const pa = parseCode(a);
  const pb = parseCode(b);
  if (!pa || !pb) {
    // Numbered courses first; two unnumbered ones fall back to a locale compare.
    return pa ? -1 : pb ? 1 : a.localeCompare(b);
  }
  if (pa.main !== pb.main) {
    return pa.main - pb.main;
  }
  if (pa.suffix !== pb.suffix) {
    return pa.suffix.localeCompare(pb.suffix);
  }
  if (pa.subKind !== pb.subKind) {
    return pa.subKind - pb.subKind;
  }
  if (pa.subKind === SUB_NUMERIC) {
    return pa.subNumber - pb.subNumber;
  }
  return pa.subAlpha.localeCompare(pb.subAlpha);
}
