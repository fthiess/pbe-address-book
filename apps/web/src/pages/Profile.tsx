import type { Profile as ProfileType } from "@pbe/shared";
import { useCallback, useEffect, useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";
import { LoadingOverlay } from "../components/LoadingOverlay.js";
import { ApiError, fetchProfile, patchProfile } from "../lib/api.js";
import type { DirectoryProfile, ProfileRecord } from "../lib/types.js";
import { useDelayedFlag } from "../lib/useDelayedFlag.js";
import { applyProfileToRoster, useRoster } from "../lib/useRoster.js";
import type { SubmitResult } from "./profile/ProfileEdit.js";
import { ProfileEdit } from "./profile/ProfileEdit.js";
import { ProfileView } from "./profile/ProfileView.js";
import { valuesEqual } from "./profile/patch.js";
import { type Viewer, canEdit } from "./profile/viewer.js";

/** Server-stamped housekeeping that should not appear in the reconcile "changed" list. */
const HOUSEKEEPING = new Set<string>([
  "id",
  "lastModified",
  "lastVerifiedDate",
  "verifiedBy",
  "newsletterConsentChangedAt",
]);

/**
 * Everything the view and edit child routes need from the container, shared
 * through the `Outlet` context so the container can own the record (and survive
 * the view↔edit switch without remounting — N33).
 */
export interface ProfileOutletContext {
  record: ProfileRecord;
  viewer: Viewer;
  /** The session-cached roster — Big Brother typeahead + derived Little Brothers (§5.7.4). */
  roster: DirectoryProfile[] | null;
  /** Whether the roster fetch failed (the picker degrades gracefully). */
  rosterError: boolean;
  /** The PATCH-first save with the 412 reconcile (§5.7.9). */
  submit: (patch: Partial<ProfileType>) => Promise<SubmitResult>;
  /** Show a transient confirmation toast (the non-URL channel, N33). */
  showToast: (message: string) => void;
  /** Leave edit mode back to the view: pop the edit entry, or replace it on a cold deep-link. */
  exitEdit: () => void;
  /** The "← Directory" action: return to the Directory entry, or `/` on a cold deep-link. */
  backToDirectory: () => void;
}

/**
 * The Profile page container (§5.7) — Book's read/edit surface for one brother.
 * It loads the record (and its concurrency token) from `GET /api/profiles/:id`,
 * derives the viewer's relationship to it from `/api/me`, owns the save
 * orchestration, and renders the view or edit child through the `Outlet`. Because
 * the container stays mounted across the view↔edit switch (a shared layout route),
 * a save updates the record in place from the PATCH response — no second GET — and
 * the confirmation toast lives here rather than travelling in the URL (N33).
 */
export function ProfileContainer() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const { state } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const me = state.status === "authenticated" ? state.me : null;
  const viewer: Viewer | null = me ? { role: me.role, isOwner: me.profileId === id } : null;
  const { profiles: roster, error: rosterError } = useRoster();

  const [record, setRecord] = useState<ProfileRecord | null>(null);
  const [etag, setEtag] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [toast, setToast] = useState<string | null>(null);
  const showOverlay = useDelayedFlag(status === "loading", 500);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) {
      setStatus("error");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    fetchProfile(id, controller.signal)
      .then(({ profile, etag: token }) => {
        setRecord(profile);
        setEtag(token);
        setStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setStatus(error instanceof ApiError && error.status === 404 ? "notfound" : "error");
      });
    return () => controller.abort();
    // Re-fetch only on id change (a different brother). The view↔edit transition
    // does NOT refetch: a save updates `record`/`etag` in place from the PATCH
    // response, Cancel leaves them untouched, and a stale edit baseline is caught
    // by the 412 reconcile (so the old post-save GET is gone — N33).
  }, [id]);

  // The save sequence (§5.7.9): PATCH with If-Match; on 412 re-fetch to get the
  // fresh token and report what changed underneath; the user's edits are kept.
  const submit = useCallback(
    async (patch: Partial<ProfileType>): Promise<SubmitResult> => {
      if (!record) {
        return { status: "error" };
      }
      try {
        const outcome = await patchProfile(id, patch, etag);
        if (outcome.status === "ok") {
          setRecord(outcome.profile);
          setEtag(outcome.etag);
          // Keep the cached roster in step so the *other* brother's derived Little-
          // Brother list reflects a re-pointed bigBrotherId (§5.7.4).
          applyProfileToRoster(outcome.profile);
          return { status: "ok" };
        }
        if (outcome.status === "stale") {
          const fresh = await fetchProfile(id);
          setEtag(fresh.etag);
          // Diff over the UNION of both key sets, not just the fresh record's:
          // a field the concurrent writer *removed* (cleared) is absent from
          // `fresh.profile`, so iterating fresh's keys alone would silently miss
          // it and tell the user it was unchanged when it was wiped (OFC-108).
          const keys = new Set<string>([...Object.keys(record), ...Object.keys(fresh.profile)]);
          const changed = [...keys]
            .filter((key) => !HOUSEKEEPING.has(key))
            .filter(
              (key) =>
                !valuesEqual(
                  record[key as keyof ProfileRecord],
                  fresh.profile[key as keyof ProfileRecord],
                ),
            );
          return { status: "stale", changedFields: changed };
        }
        if (outcome.status === "invalid") {
          return { status: "invalid", issues: outcome.issues };
        }
        if (outcome.status === "reload") {
          return { status: "reload" };
        }
        return { status: "forbidden" };
      } catch {
        return { status: "error" };
      }
    },
    [id, etag, record],
  );

  const showToast = useCallback((message: string) => setToast(message), []);
  // Stable identity (a bare `() => setToast(null)` inline prop is recreated every
  // render): the toast's auto-dismiss effect depends on it, so an unstable `onDone`
  // would restart the 4s timer on any container re-render — e.g. the roster fetch
  // resolving — and the "Saved" toast would linger past its intended lifetime (OFC-116).
  const dismissToast = useCallback(() => setToast(null), []);

  // The no-anachronistic-history model (N33): Edit pushed one entry tagged
  // `fromProfile`, so leaving edit pops it (Back from the view then reaches the
  // Directory). A cold deep-link straight to `/edit` has nothing to pop, so we
  // replace it with the display URL instead.
  const exitEdit = useCallback(() => {
    if ((location.state as { fromProfile?: boolean } | null)?.fromProfile) {
      navigate(-1);
    } else {
      navigate(`/brother/${id}`, { replace: true });
    }
  }, [location.state, navigate, id]);

  // "← Directory": prefer popping back to the Directory entry (restoring its URL
  // filters and history-state scroll) when we arrived from a row; otherwise fall
  // back to the Directory home. Full prev/next "return to where I was" is 4d (N32).
  const backToDirectory = useCallback(() => {
    if ((location.state as { fromDirectory?: boolean } | null)?.fromDirectory) {
      navigate(-1);
    } else {
      navigate("/");
    }
  }, [location.state, navigate]);

  if (status === "loading") {
    return showOverlay ? <LoadingOverlay /> : <div className="min-h-[40vh]" />;
  }
  if (status === "notfound") {
    return <NotFound />;
  }
  if (status === "error" || !record || !viewer) {
    return (
      <p className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        We couldn't load this profile just now. Please refresh to try again.
      </p>
    );
  }

  const context: ProfileOutletContext = {
    record,
    viewer,
    roster,
    rosterError,
    submit,
    showToast,
    exitEdit,
    backToDirectory,
  };
  return (
    <>
      <ProfileToast message={toast} onDone={dismissToast} />
      <Outlet context={context} />
    </>
  );
}

/** The view child route (`/brother/:id`) — pulls the record from the container. */
export function ProfileViewRoute() {
  const { record, viewer, roster, backToDirectory } = useOutletContext<ProfileOutletContext>();
  return (
    <ProfileView
      record={record}
      viewer={viewer}
      roster={roster}
      onBackToDirectory={backToDirectory}
    />
  );
}

/**
 * The edit child route (`/brother/:id/edit`). A viewer who may not edit is sent to
 * the view (replace, so Back still reaches the Directory).
 */
export function ProfileEditRoute() {
  const { record, viewer, roster, rosterError, submit, showToast, exitEdit } =
    useOutletContext<ProfileOutletContext>();
  if (!canEdit(viewer)) {
    return <Navigate to={`/brother/${record.id}`} replace />;
  }
  return (
    <ProfileEdit
      record={record}
      viewer={viewer}
      roster={roster}
      rosterError={rosterError}
      submit={submit}
      showToast={showToast}
      exitEdit={exitEdit}
    />
  );
}

/**
 * A transient "Saved" confirmation (§5.7.6 toast). Driven by container state (the
 * non-URL channel — N33), so a save that pops back to the view still announces.
 */
function ProfileToast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = setTimeout(onDone, 4000);
    return () => clearTimeout(timer);
  }, [message, onDone]);

  if (!message) {
    return null;
  }
  return (
    // <output> carries an implicit ARIA "status" polite live region (matching
    // LoadingOverlay) so the save confirmation is announced. Positioned high (a
    // third down) so it's noticed — the bottom of a long profile was easy to miss.
    <output className="fixed left-1/2 top-1/3 z-50 -translate-x-1/2 rounded-[var(--radius-lg)] border border-[var(--success-border)] bg-[#1b262b] px-4 py-2.5 text-[length:var(--text-body)] text-white shadow-[var(--shadow-popover-strong)]">
      <span aria-hidden="true" className="mr-2 text-[var(--success)]">
        ✓
      </span>
      {message}
    </output>
  );
}

function NotFound() {
  return (
    <section className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6">
      <h1 className="text-[length:var(--text-h3)] font-bold">Brother not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This record doesn't exist, or it isn't visible to you.
      </p>
      <Link
        to="/"
        className="mt-4 inline-block rounded-[var(--radius-md)] border border-input bg-background px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Back to the Directory
      </Link>
    </section>
  );
}
