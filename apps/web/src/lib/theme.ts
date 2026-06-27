/**
 * Theme mode and resolution (D30). Three modes: an explicit **light** or **dark**
 * choice, or **system** (follow the OS `prefers-color-scheme`, live). The chosen
 * mode persists in `localStorage["book-theme"]`; **system is stored as the key's
 * absence**, which is exactly what the no-FOUC script in `index.html` reads, so
 * the two never disagree. An explicit Light/Dark choice wins over whatever the
 * browser reports for the system preference — the user is always in control.
 */

export type ThemeMode = "light" | "system" | "dark";

const STORAGE_KEY = "book-theme";

/** The saved mode, defaulting to "system" when nothing (or something odd) is stored. */
export function getStoredMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") {
      return value;
    }
  } catch {
    // localStorage unavailable — fall through to system.
  }
  return "system";
}

/** Whether the OS currently prefers a dark scheme. */
export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Resolve a mode to a concrete light/dark decision. */
export function resolveDark(mode: ThemeMode): boolean {
  return mode === "dark" || (mode === "system" && systemPrefersDark());
}

/** Apply a mode to the document by toggling the `.dark` class. */
export function applyMode(mode: ThemeMode): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", resolveDark(mode));
  }
}

/** Persist a mode — "system" is stored as the key's *absence* (matches index.html). */
export function storeMode(mode: ThemeMode): void {
  try {
    if (mode === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    // localStorage unavailable — the choice won't persist, but still applies.
  }
}
