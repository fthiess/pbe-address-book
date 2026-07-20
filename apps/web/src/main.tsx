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
initAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root was not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
