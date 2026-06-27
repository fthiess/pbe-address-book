import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

/**
 * Follow the OS colour scheme **live** while there is no explicit saved
 * preference. index.html sets the initial `.dark` class (no FOUC); this keeps it
 * in sync when the user flips their system theme after the page has loaded. The
 * explicit light/dark/auto toggle (which would set `book-theme` and take
 * precedence here) is still to come; until then the app is always in "auto" mode.
 */
function followSystemTheme(): void {
  try {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", (event) => {
      if (!localStorage.getItem("book-theme")) {
        document.documentElement.classList.toggle("dark", event.matches);
      }
    });
  } catch {
    // matchMedia/localStorage unavailable — the load-time default stands.
  }
}

followSystemTheme();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root was not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
