import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import type { ThemeMode } from "../lib/theme.js";
import { cn } from "../lib/utils.js";
import { useTheme } from "./ThemeProvider.js";

/**
 * The masthead light / system / dark theme control (PRD §5.2, visual-design). A
 * 3-option segmented toggle; the active mode is `aria-pressed`. "System" follows
 * the OS scheme live; Light/Dark are explicit overrides (D30).
 */
const OPTIONS: { mode: ThemeMode; label: string; icon: ReactNode }[] = [
  { mode: "light", label: "Light theme", icon: <Sun size={15} aria-hidden="true" /> },
  { mode: "system", label: "System theme", icon: <Monitor size={15} aria-hidden="true" /> },
  { mode: "dark", label: "Dark theme", icon: <Moon size={15} aria-hidden="true" /> },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <fieldset className="m-0 inline-flex items-center gap-0.5 rounded-full border border-border bg-secondary p-0.5">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map((option) => {
        const active = mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            onClick={() => setMode(option.mode)}
            className={cn(
              // ≥24px target (WCAG 2.5.8); active option gets the raised surface.
              "grid size-7 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.icon}
          </button>
        );
      })}
    </fieldset>
  );
}
