import type { Profile as ProfileType, Role } from "@pbe/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  ApiError,
  type DeceasedFacts,
  changeRole,
  deleteHeadshot,
  deleteProfile,
  fetchProfile,
  patchProfile,
  putDebrothered,
  putDeceased,
  putHeadshot,
  verifyProfile,
} from "../lib/api.js";
import type { DirectoryProfile, ProfileRecord } from "../lib/types.js";
import { useDelayedFlag } from "../lib/useDelayedFlag.js";
import { applyProfileToRoster, useRoster } from "../lib/useRoster.js";
import type { HeadshotChange } from "./profile/HeadshotEditor.js";
import type { ProfileActions } from "./profile/ProfileControls.js";
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
  /**
   * Apply a staged headshot change (`PUT`/`DELETE …/headshot`, N42) — run *after*
   * the text PATCH (D50). Merges the fresh `hasHeadshot`/`headshotVersion`/`ETag`
   * into the held record; returns whether it succeeded. */
  saveHeadshot: (change: HeadshotChange) => Promise<boolean>;
  /** Show a transient confirmation toast (the non-URL channel, N33). */
  showToast: (message: string) => void;
  /** The privileged status/admin actions (verify, deceased, de-brother, role, delete — 4c-2). */
  actions: ProfileActions;
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
  const { state, applyOwnHeadshot } = useSession();
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

  // Apply a staged headshot change to the record (§5.7; N42). The image write
  // returns fresh `hasHeadshot`/`headshotVersion` and a new `ETag`; both are
  // applied in place so the container stays warm (no refetch, N33). The record is
  // updated **functionally** so a photo write that runs right after a text PATCH in
  // one Save merges onto the PATCH's result rather than clobbering it with a stale
  // snapshot. (The typeahead roster is not touched — it shows names, not photos,
  // and the Directory re-fetches its own thumbnails.)
  const saveHeadshot = useCallback(
    async (change: HeadshotChange): Promise<boolean> => {
      try {
        const result =
          change.kind === "remove" ? await deleteHeadshot(id) : await putHeadshot(id, change.blob);
        setEtag(result.etag);
        setRecord((prev) => {
          if (!prev) {
            return prev;
          }
          // Drop `headshotVersion` on a removal (destructure-omit, not `delete`) and
          // set it on an upload — merged onto the latest `prev` so a photo write
          // after a text PATCH keeps the PATCH's fields.
          const { headshotVersion: _dropped, ...rest } = prev;
          return result.headshotVersion === undefined
            ? { ...rest, hasHeadshot: result.hasHeadshot }
            : { ...rest, hasHeadshot: result.hasHeadshot, headshotVersion: result.headshotVersion };
        });
        // If this is the signed-in brother's OWN record, update `me` so the masthead
        // avatar reflects the new (or removed) photo immediately.
        if (me?.profileId === id) {
          applyOwnHeadshot(result.hasHeadshot, result.headshotVersion);
        }
        return true;
      } catch {
        return false;
      }
    },
    [id, me?.profileId, applyOwnHeadshot],
  );

  const showToast = useCallback((message: string) => setToast(message), []);
  // Stable identity (a bare `() => setToast(null)` inline prop is recreated every
  // render): the toast's auto-dismiss effect depends on it, so an unstable `onDone`
  // would restart the 4s timer on any container re-render — e.g. the roster fetch
  // resolving — and the "Saved" toast would linger past its intended lifetime (OFC-116).
  const dismissToast = useCallback(() => setToast(null), []);

  // The 4c-2 privileged actions (API-SPEC §3–§5). Each dedicated server write
  // returns the updated record (or the verify fields) + a fresh ETag, applied in
  // place so the warm container's held token never goes stale (N42 pattern). The
  // deceased/de-brother writes also refresh the cached roster (a re-pointed status
  // affects the derived views), mirroring the PATCH path.
  const isOwner = viewer?.isOwner ?? false;
  const verify = useCallback(async () => {
    const result = await verifyProfile(id);
    setEtag(result.etag);
    setRecord((prev) =>
      prev
        ? { ...prev, lastVerifiedDate: result.lastVerifiedDate, verifiedBy: result.verifiedBy }
        : prev,
    );
    setToast(isOwner ? "Your details are confirmed current." : "Marked as verified.");
  }, [id, isOwner]);

  const setDeceased = useCallback(
    async (deceased: boolean, facts?: DeceasedFacts) => {
      const outcome = await putDeceased(id, deceased, facts);
      if (outcome.status === "ok") {
        // Replace the held record from the server's authoritative projection rather
        // than shallow-merging (OFC-137): a status write can *remove* a top-level
        // field (e.g. a cleared verification stamp on reversal), which a `{...prev}`
        // spread would leave stale. Mirrors the PATCH path.
        setRecord(outcome.profile);
        setEtag(outcome.etag);
        applyProfileToRoster(outcome.profile);
        setToast(deceased ? "Marked as deceased." : "Deceased mark removed.");
      }
      return outcome;
    },
    [id],
  );

  const setDebrothered = useCallback(
    async (debrothered: boolean) => {
      const outcome = await putDebrothered(id, debrothered);
      if (outcome.status === "ok") {
        setRecord(outcome.profile); // authoritative replace, not a shallow merge (OFC-137)
        setEtag(outcome.etag);
        applyProfileToRoster(outcome.profile);
        setToast(debrothered ? "Brother de-brothered." : "Brother reinstated.");
      }
      return outcome;
    },
    [id],
  );

  const changeRoleAction = useCallback((role: Role) => changeRole(id, role), [id]);

  const removeProfile = useCallback(async () => {
    const outcome = await deleteProfile(id);
    if (outcome.status === "ok") {
      // The record is gone server-side; return to the Directory (which re-downloads).
      navigate("/");
    }
    return outcome;
  }, [id, navigate]);

  const actions: ProfileActions = useMemo(
    () => ({
      verify,
      setDeceased,
      setDebrothered,
      changeRole: changeRoleAction,
      removeProfile,
    }),
    [verify, setDeceased, setDebrothered, changeRoleAction, removeProfile],
  );

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
    saveHeadshot,
    showToast,
    actions,
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
  const { record, viewer, roster, actions, backToDirectory } =
    useOutletContext<ProfileOutletContext>();
  return (
    <ProfileView
      record={record}
      viewer={viewer}
      roster={roster}
      actions={actions}
      onBackToDirectory={backToDirectory}
    />
  );
}

/**
 * The edit child route (`/brother/:id/edit`). A viewer who may not edit is sent to
 * the view (replace, so Back still reaches the Directory).
 */
export function ProfileEditRoute() {
  const { record, viewer, roster, rosterError, submit, saveHeadshot, showToast, exitEdit } =
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
      saveHeadshot={saveHeadshot}
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
