import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import { Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import { BannerProvider } from "./auth/BannerContext.js";
import { SessionProvider, useSession } from "./auth/SessionContext.js";
import { AppShell } from "./components/AppShell.js";
import { FontSizeProvider } from "./components/FontSizeProvider.js";
import { LoadingOverlay } from "./components/LoadingOverlay.js";
import { MaintenanceOutage } from "./components/MaintenanceOutage.js";
import { ThemeProvider } from "./components/ThemeProvider.js";
import { useAnalytics } from "./lib/useAnalytics.js";
import { useDelayedFlag } from "./lib/useDelayedFlag.js";
import { AboutPage } from "./pages/AboutPage.js";
import { Admin } from "./pages/Admin.js";
import { AuthCallback } from "./pages/AuthCallback.js";
import { Directory } from "./pages/Directory.js";
import { NewProfile } from "./pages/NewProfile.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { OwnProfileRedirect } from "./pages/OwnProfileRedirect.js";
import { ProfileContainer, ProfileEditRoute, ProfileViewRoute } from "./pages/Profile.js";
import { SignIn } from "./pages/SignIn.js";
import { SelectionProvider } from "./pages/directory/SelectionContext.js";
import { StarsProvider } from "./pages/directory/StarsContext.js";

/**
 * The root layout. nuqs's URL-state adapter reads the router's location, so it
 * has to live **inside** the router (a data router renders its tree through
 * `RouterProvider`, not as `BrowserRouter` children); this layout route is that
 * inside-the-router home. The session/theme/font providers don't touch router
 * state and so wrap `RouterProvider` in {@link App}.
 */
function RootLayout() {
  // Analytics lives here because it needs both halves: route matches (for the
  // page-view pattern) and the session (for `identify`). This is the innermost
  // point that sees the router and the outermost that sees every route (7a-2).
  useAnalytics();
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
  // SelectionProvider and StarsProvider wrap the shell (so the masthead's clean-slate
  // reset can clear the selection, and so the star set is shared by the Directory and
  // the Profile page — OFC-256) and live on this layout route, which stays mounted
  // across child navigations — so both survive the Directory's remount (N79/OFC-196).
  // They sit inside the gate, so a sign-out unmounts and clears them. StarsProvider
  // seeds from the session's own stars, now that `state` is known authenticated.
  return (
    <BannerProvider>
      <SelectionProvider>
        <StarsProvider initial={state.me.stars}>
          <AppShell me={state.me}>
            <Outlet />
          </AppShell>
        </StarsProvider>
      </SelectionProvider>
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
      {
        path: "/auth/callback",
        element: <AuthCallback />,
        handle: { analyticsRoute: "/auth/callback" },
      },
      {
        element: <GateLayout />,
        children: [
          { index: true, element: <Directory />, handle: { analyticsRoute: "/" } },
          // `brother/new` (the Add-Brother essentials step, OFC-201) is a **static**
          // sibling of `brother/:id`, so the router ranks it above the dynamic param
          // and it is never mistaken for a brother whose id is "new" (the old bug).
          {
            path: "brother/new",
            element: <NewProfile />,
            handle: { analyticsRoute: "/brother/new" },
          },
          // Same reasoning as `brother/new`: `brother/me` and `brother/me/edit` are
          // **static** siblings ranked above `brother/:id`, so "me" is never taken
          // for a Constitution ID. They exist for callers that can't know one — the
          // build-time About copy, and (7.6) the Ghost theme — and redirect to the
          // real record so a profile keeps one canonical URL (N116).
          {
            path: "brother/me",
            element: <OwnProfileRedirect />,
            handle: { analyticsRoute: "/brother/me" },
          },
          {
            path: "brother/me/edit",
            element: <OwnProfileRedirect edit />,
            handle: { analyticsRoute: "/brother/me/edit" },
          },
          {
            path: "brother/:id",
            element: <ProfileContainer />,
            // The pattern, never the id — `/brother/5247` in an event property would
            // record *whom* a brother looked at, which P6 forbids (see analytics.ts).
            // The view child inherits this handle; only `edit` overrides it.
            handle: { analyticsRoute: "/brother/:id" },
            children: [
              { index: true, element: <ProfileViewRoute /> },
              {
                path: "edit",
                element: <ProfileEditRoute />,
                handle: { analyticsRoute: "/brother/:id/edit" },
              },
            ],
          },
          { path: "admin", element: <Admin />, handle: { analyticsRoute: "/admin" } },
          // Reached from the avatar menu (OFC-244). Inside the gate like every other
          // page — About is members-only, not a public marketing page.
          { path: "about", element: <AboutPage />, handle: { analyticsRoute: "/about" } },
          // An unknown URL renders an honest "page not found" (OFC-202) rather than
          // silently falling through to the Directory. Still a 200 (SPA behind the
          // Hosting `**`→index.html rewrite), but a real not-found UI.
          { path: "*", element: <NotFoundPage />, handle: { analyticsRoute: "/*" } },
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
