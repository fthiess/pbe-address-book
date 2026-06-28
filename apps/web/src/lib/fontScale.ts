/**
 * Font-size preference (PRD §5.3). Three discrete steps — **Normal**, **Large**,
 * **Larger** — that scale the document root font-size; because the UI is sized in
 * `rem`, the whole interface grows proportionally. It is a readability
 * accommodation for the older-alum audience (the same cohort the slow-connection
 * frugality serves). The choice persists in `localStorage["book-font-size"]`;
 * **Normal is stored as the key's absence**, which is exactly what the no-FOUC
 * script in `index.html` reads, so the inline script and this module never
 * disagree. Deliberately mirrors the theme module (theme.ts/D30) so the two
 * preferences behave identically.
 *
 * The percentages here MUST stay in sync with the no-FOUC script in `index.html`.
 */

export type FontScale = "normal" | "large" | "larger";

const STORAGE_KEY = "book-font-size";

/** The root font-size each step applies, as a percentage of the 16px browser base. */
export const SCALE_PERCENT: Record<FontScale, number> = {
  normal: 100,
  large: 112.5,
  larger: 125,
};

/** The saved scale, defaulting to "normal" when nothing (or something odd) is stored. */
export function getStoredScale(): FontScale {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "large" || value === "larger") {
      return value;
    }
  } catch {
    // localStorage unavailable — fall through to normal.
  }
  return "normal";
}

/** Apply a scale to the document by setting the root font-size (the rem anchor). */
export function applyScale(scale: FontScale): void {
  if (typeof document !== "undefined") {
    document.documentElement.style.fontSize = `${SCALE_PERCENT[scale]}%`;
  }
}

/** Persist a scale — "normal" is stored as the key's *absence* (matches index.html). */
export function storeScale(scale: FontScale): void {
  try {
    if (scale === "normal") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, scale);
    }
  } catch {
    // localStorage unavailable — the choice won't persist, but still applies.
  }
}
