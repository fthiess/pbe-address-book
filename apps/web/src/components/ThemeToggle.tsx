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
  { mode: "light", label: "Light theme", icon: <SunIcon /> },
  { mode: "system", label: "System theme", icon: <SystemIcon /> },
  { mode: "dark", label: "Dark theme", icon: <MoonIcon /> },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-secondary p-0.5"
    >
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
    </div>
  );
}

function SunIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
