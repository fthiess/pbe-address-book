import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { initAnalytics } from "./lib/analyticsClient.js";

// The runtime theme (initial paint from index.html's no-FOUC script; live
// system-follow + the light/system/dark toggle from ThemeProvider).

// Register the Mixpanel client before the tree mounts, so the first page view of a
// session has somewhere to go. A no-op when no token is built in (D138) — which is
// every local dev build and every CI/e2e build.
//
// Wrapped because this runs *before* `createRoot().render()`: analytics is never
// load-bearing, but an uncaught throw here — a storage `SecurityError` under a
// locked-down site-data policy, a hostile privacy extension, a library change —
// would white-screen the whole app before a single pixel painted. The rest of the
// analytics code is scrupulously inert when unconfigured; this keeps the entry
// point to the same standard.
try {
  initAnalytics();
} catch (error) {
  console.warn("[analytics] initialisation failed; continuing without analytics", error);
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root was not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
