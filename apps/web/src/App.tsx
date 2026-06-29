import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./auth/SessionContext.js";
import { AppShell } from "./components/AppShell.js";
import { FontSizeProvider } from "./components/FontSizeProvider.js";
import { LoadingOverlay } from "./components/LoadingOverlay.js";
import { ThemeProvider } from "./components/ThemeProvider.js";
import { useDelayedFlag } from "./lib/useDelayedFlag.js";
import { AuthCallback } from "./pages/AuthCallback.js";
import { Directory } from "./pages/Directory.js";
import { Profile } from "./pages/Profile.js";
import { SignIn } from "./pages/SignIn.js";

/**
 * The authenticated app, gated on session state. While `/api/me` is in flight a
 * cold start can take a few seconds (scale-to-zero), so the loading overlay is
 * threshold-gated (D119): the warm path shows a bare background and never the
 * overlay. Signed-out → the sign-in screen; signed-in → the shell wrapping the
 * authenticated routes (the Directory and, from Phase 4, the Profile page).
 */
function Gate() {
  const { state } = useSession();
  const showOverlay = useDelayedFlag(state.status === "loading", 500);

  if (state.status === "loading") {
    return showOverlay ? (
      <LoadingOverlay label="Loading the directory…" />
    ) : (
      <div className="min-h-dvh bg-background" />
    );
  }
  if (state.status === "unauthenticated") {
    return <SignIn />;
  }
  return (
    <AppShell me={state.me}>
      <Routes>
        <Route path="/brother/:id/edit" element={<Profile mode="edit" />} />
        <Route path="/brother/:id" element={<Profile mode="view" />} />
        <Route path="*" element={<Directory />} />
      </Routes>
    </AppShell>
  );
}

/**
 * The SPA root: the persistent shell, identity, and routing (React Router +
 * nuqs) of the Phase 1b walking skeleton. `/auth/callback` completes the Ghost
 * bridge; every other path resolves through the session gate.
 */
export function App() {
  return (
    <ThemeProvider>
      <FontSizeProvider>
        <BrowserRouter>
          <NuqsAdapter>
            <SessionProvider>
              <Routes>
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="*" element={<Gate />} />
              </Routes>
            </SessionProvider>
          </NuqsAdapter>
        </BrowserRouter>
      </FontSizeProvider>
    </ThemeProvider>
  );
}
