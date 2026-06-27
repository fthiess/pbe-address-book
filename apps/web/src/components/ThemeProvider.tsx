import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { type ThemeMode, applyMode, getStoredMode, storeMode } from "../lib/theme.js";

/**
 * App-wide theme state (D30). Owns the chosen mode, applies it to the document,
 * and — crucially — while in **system** mode keeps the app in sync with the OS
 * `prefers-color-scheme` *live* (the listener `index.html` can't add). An explicit
 * Light/Dark choice persists and overrides the system preference.
 */
interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredMode());

  // Apply on mount and whenever the mode changes.
  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  // While in system mode, re-apply when the OS scheme flips.
  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyMode("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    storeMode(next);
    setModeState(next);
  }, []);

  return <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
