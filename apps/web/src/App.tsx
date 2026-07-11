import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import { Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import { BannerProvider } from "./auth/BannerContext.js";
import { SessionProvider, useSession } from "./auth/SessionContext.js";
import { AppShell } from "./components/AppShell.js";
import { FontSizeProvider } from "./components/FontSizeProvider.js";
import { LoadingOverlay } from "./components/LoadingOverlay.js";
import { MaintenanceOutage } from "./components/MaintenanceOutage.js";
import { ThemeProvider } from "./components/ThemeProvider.js";
import { useDelayedFlag } from "./lib/useDelayedFlag.js";
import { Admin } from "./pages/Admin.js";
import { AuthCallback } from "./pages/AuthCallback.js";
import { Directory } from "./pages/Directory.js";
import { NewProfile } from "./pages/NewProfile.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
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
  const { state, refresh } = useSession();
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
  // Backend unreachable / 5xx / down for maintenance (survived one auto-retry) —
  // the D118 maintenance-outage screen with a manual retry, not a forced re-login
  // (OFC-76, D118).
  if (state.status === "error") {
    return <MaintenanceOutage onRetry={() => void refresh()} />;
  }
  return (
    <BannerProvider>
      <AppShell me={state.me}>
        <Outlet />
      </AppShell>
    </BannerProvider>
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
          // `brother/new` (the Add-Brother essentials step, OFC-201) is a **static**
          // sibling of `brother/:id`, so the router ranks it above the dynamic param
          // and it is never mistaken for a brother whose id is "new" (the old bug).
          { path: "brother/new", element: <NewProfile /> },
          {
            path: "brother/:id",
            element: <ProfileContainer />,
            children: [
              { index: true, element: <ProfileViewRoute /> },
              { path: "edit", element: <ProfileEditRoute /> },
            ],
          },
          { path: "admin", element: <Admin /> },
          // An unknown URL renders an honest "page not found" (OFC-202) rather than
          // silently falling through to the Directory. Still a 200 (SPA behind the
          // Hosting `**`→index.html rewrite), but a real not-found UI.
          { path: "*", element: <NotFoundPage /> },
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
