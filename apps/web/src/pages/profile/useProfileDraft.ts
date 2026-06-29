import {
  type PrivacyFlags,
  type Profile,
  type ValidationIssue,
  validateProfile,
} from "@pbe/shared";
import { useCallback, useMemo, useState } from "react";
import type { ProfileRecord } from "../../lib/types.js";
import { buildPatch, isDirty } from "./patch.js";
import type { Viewer } from "./viewer.js";

/**
 * The edit form's state engine (§5.7.8/§5.7.9). Holds the editing **draft**
 * (a clone of the server record), runs the **shared** validator (D50) so the
 * client check can't drift from the server's, tracks which fields the user has
 * touched (errors show on blur, then everything on Save), folds in server-side
 * issues from a `422`, computes the **dirty** bit for the unsaved-changes guard,
 * and builds the minimal **patch** of changed-and-writable fields.
 *
 * Empty optional inputs are stored as `undefined` (a cleared field), so the
 * validator skips them and the patch carries the clear; the always-required
 * name/class-year fields are validated with `requireRequired` so blanking one is
 * caught here, not only by the server.
 */

/** The optional string fields where an empty input means "clear this field". */
const OPTIONAL_TEXT: ReadonlySet<keyof Profile> = new Set<keyof Profile>([
  "middleName",
  "fullLegalName",
  "mugName",
  "email",
  "alternateEmail",
  "phone",
  "employerName",
  "jobTitle",
  "spousePartnerName",
  "adminNote",
]);

export interface ProfileDraft {
  draft: ProfileRecord;
  /** Set a text field; an empty value clears an optional field (→ `undefined`). */
  setText: (key: keyof Profile, value: string) => void;
  /** The class-year input is string-backed; "" / "unknown" → `null`. */
  classYearText: string;
  setClassYear: (value: string) => void;
  /** Flip one privacy flag (the `privacy` sub-object). */
  setPrivacy: (flag: keyof PrivacyFlags, value: boolean) => void;
  /** Set a top-level boolean consent (`allow*`, `unlisted`). */
  setBool: (key: keyof Profile, value: boolean) => void;
  /** Mark a field touched (on blur), so its error may show. */
  touch: (field: string) => void;
  /** Reveal every error (on a Save attempt); returns the first invalid field. */
  revealAll: () => string | null;
  /** The error to show for a field now, or `undefined` (touch/submit-gated). */
  errorFor: (field: string) => string | undefined;
  /** Fold server `422` issues into the visible error set. */
  applyServerIssues: (issues: ValidationIssue[]) => void;
  /** Whether the draft differs from the record in any writable field. */
  dirty: boolean;
  /** The minimal patch to send. */
  patch: () => Partial<Profile>;
}

export function useProfileDraft(record: ProfileRecord, viewer: Viewer): ProfileDraft {
  const [draft, setDraft] = useState<ProfileRecord>(() => structuredClone(record));
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverIssues, setServerIssues] = useState<Record<string, string>>({});
  const [classYearText, setClassYearText] = useState<string>(() =>
    record.classYear == null ? "" : String(record.classYear),
  );

  const currentYear = new Date().getUTCFullYear();

  const clearServerIssue = useCallback((field: string) => {
    setServerIssues((prev) => {
      if (!(field in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const setText = useCallback(
    (key: keyof Profile, value: string) => {
      const stored = value === "" && OPTIONAL_TEXT.has(key) ? undefined : value;
      setDraft((d) => ({ ...d, [key]: stored }));
      clearServerIssue(key);
    },
    [clearServerIssue],
  );

  const setClassYear = useCallback(
    (value: string) => {
      setClassYearText(value);
      const trimmed = value.trim();
      let parsed: number | null;
      if (trimmed === "" || /^unknown$/i.test(trimmed)) {
        parsed = null;
      } else {
        const n = Number(trimmed);
        parsed = Number.isInteger(n) ? n : Number.NaN;
      }
      setDraft((d) => ({ ...d, classYear: parsed }));
      clearServerIssue("classYear");
    },
    [clearServerIssue],
  );

  const setPrivacy = useCallback((flag: keyof PrivacyFlags, value: boolean) => {
    setDraft((d) => ({
      ...d,
      privacy: { ...(d.privacy as PrivacyFlags), [flag]: value },
    }));
  }, []);

  const setBool = useCallback(
    (key: keyof Profile, value: boolean) => {
      setDraft((d) => ({ ...d, [key]: value }));
      clearServerIssue(key);
    },
    [clearServerIssue],
  );

  const touch = useCallback((field: string) => {
    setTouched((prev) => {
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }, []);

  // The authoritative client validation: the shared validator over the draft,
  // with the always-required fields enforced (this IS a full record edit).
  const errors = useMemo(() => {
    const { issues } = validateProfile(draft, { currentYear, requireRequired: true });
    const map: Record<string, string> = {};
    for (const issue of issues) {
      if (!(issue.field in map)) {
        map[issue.field] = issue.message;
      }
    }
    return map;
  }, [draft, currentYear]);

  const revealAll = useCallback((): string | null => {
    setSubmitted(true);
    return Object.keys(errors)[0] ?? null;
  }, [errors]);

  const errorFor = useCallback(
    (field: string): string | undefined => {
      if (submitted || touched.has(field)) {
        return errors[field] ?? serverIssues[field];
      }
      return serverIssues[field];
    },
    [submitted, touched, errors, serverIssues],
  );

  const applyServerIssues = useCallback((issues: ValidationIssue[]) => {
    setSubmitted(true);
    const map: Record<string, string> = {};
    for (const issue of issues) {
      if (!(issue.field in map)) {
        map[issue.field] = issue.message;
      }
    }
    setServerIssues(map);
  }, []);

  const dirty = useMemo(
    () => isDirty(record, draft, viewer.role, viewer.isOwner),
    [record, draft, viewer.role, viewer.isOwner],
  );

  const patch = useCallback(
    () => buildPatch(record, draft, viewer.role, viewer.isOwner),
    [record, draft, viewer.role, viewer.isOwner],
  );

  return {
    draft,
    setText,
    classYearText,
    setClassYear,
    setPrivacy,
    setBool,
    touch,
    revealAll,
    errorFor,
    applyServerIssues,
    dirty,
    patch,
  };
}
