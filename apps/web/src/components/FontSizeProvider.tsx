import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { type FontScale, applyScale, getStoredScale, storeScale } from "../lib/fontScale.js";

/**
 * App-wide font-size state (PRD §5.3). Owns the chosen step and applies it to the
 * document root, so the rem-sized UI scales proportionally for readability. The
 * initial paint is set by index.html's no-FOUC script; this provider keeps the
 * root in sync once React mounts and drives the masthead control. Mirrors
 * ThemeProvider (D30) so the two preferences are structurally identical.
 */
interface FontSizeContextValue {
  scale: FontScale;
  setScale: (scale: FontScale) => void;
}

const FontSizeContext = createContext<FontSizeContextValue | null>(null);

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [scale, setScaleState] = useState<FontScale>(() => getStoredScale());

  // Apply on mount and whenever the scale changes.
  useEffect(() => {
    applyScale(scale);
  }, [scale]);

  const setScale = useCallback((next: FontScale) => {
    storeScale(next);
    setScaleState(next);
  }, []);

  return (
    <FontSizeContext.Provider value={{ scale, setScale }}>{children}</FontSizeContext.Provider>
  );
}

export function useFontSize(): FontSizeContextValue {
  const context = useContext(FontSizeContext);
  if (!context) {
    throw new Error("useFontSize must be used within a FontSizeProvider");
  }
  return context;
}
