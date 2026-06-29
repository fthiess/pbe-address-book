import { useEffect } from "react";

/**
 * The unsaved-changes guard (§5.4/§5.7, D43). While an edit has pending changes,
 * a browser-level navigation away (reload, tab close, typing a new URL, an
 * external link) triggers the native "leave site?" prompt.
 *
 * Scope note: in-app navigations (the back button, an in-SPA `<Link>`) are NOT
 * intercepted here. React Router's `useBlocker` does that, but only under a
 * **data router** (`createBrowserRouter`); the app currently mounts
 * `<BrowserRouter>`. The two in-app exits from edit mode that the page itself
 * owns — **Cancel** and a successful **Save** — are guarded explicitly by the
 * container (Cancel confirms when dirty). Migrating to a data router to also
 * block the back button is a tracked follow-up.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers require returnValue to be set for the prompt to show.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
