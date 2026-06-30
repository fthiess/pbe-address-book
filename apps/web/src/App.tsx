import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import { Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import { SessionProvider, useSession } from "./auth/SessionContext.js";
import { AppShell } from "./components/AppShell.js";
import { FontSizeProvider } from "./components/FontSizeProvider.js";
import { LoadingOverlay } from "./components/LoadingOverlay.js";
import { ThemeProvider } from "./components/ThemeProvider.js";
import { useDelayedFlag } from "./lib/useDelayedFlag.js";
import { AuthCallback } from "./pages/AuthCallback.js";
import { Directory } from "./pages/Directory.js";
import { ProfileContainer, ProfileEditRoute, ProfileViewRoute } from "./pages/Profile.js";
import { SignIn } from "./pages/SignIn.js";

/**
 * The root layout. nuqs's URL-state adapter reads the router's location, so it
 * has to live **inside** the router (a data router renders its tree through
 * `RouterProvider`, not as `BrowserRouter` children); this layout route is that
 * inside-the-router home. The session/theme/font providers don't touch router
 * state and so wrap `RouterProvider` in {@link App}.
 */
function RootLayout() {
  return (
    <NuqsAdapter>
      <Outlet />
    </NuqsAdapter>
  );
}

/**
 * The authenticated shell, gated on session state. While `/api/me` is in flight a
 * cold start can take a few seconds (scale-to-zero), so the loading overlay is
 * threshold-gated (D119): the warm path shows a bare background and never the
 * overlay. Signed-out → the sign-in screen; signed-in → the shell wrapping the
 * authenticated routes (rendered through the `Outlet`).
 */
function GateLayout() {
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
      <Outlet />
    </AppShell>
  );
}

/**
 * The route tree, on a **data router** (`createBrowserRouter`) so the Profile
 * page can use `useBlocker` for the unified unsaved-changes guard (OFC-65/N33).
 * `/auth/callback` completes the Ghost bridge outside the session gate; every
 * other path resolves through {@link GateLayout}. The Profile page is a single
 * `brother/:id` route whose container owns the record and hosts the view and
 * `edit` children as a shared layout — so the view↔edit switch never remounts or
 * refetches (N33).
 */
const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/auth/callback", element: <AuthCallback /> },
      {
        element: <GateLayout />,
        children: [
          { index: true, element: <Directory /> },
          {
            path: "brother/:id",
            element: <ProfileContainer />,
            children: [
              { index: true, element: <ProfileViewRoute /> },
              { path: "edit", element: <ProfileEditRoute /> },
            ],
          },
          { path: "*", element: <Directory /> },
        ],
      },
    ],
  },
]);

/**
 * The SPA root: the theme/font/session providers (none of which read router
 * state) wrapping the data router that carries the rest of the app.
 */
export function App() {
  return (
    <ThemeProvider>
      <FontSizeProvider>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </FontSizeProvider>
    </ThemeProvider>
  );
}
