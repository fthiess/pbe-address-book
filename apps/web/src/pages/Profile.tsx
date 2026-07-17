import type { Profile as ProfileType, Role } from "@pbe/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { DirectoryNav } from "./profile/DirectoryNav.js";
import type { HeadshotChange } from "./profile/HeadshotEditor.js";
import type { ProfileActions } from "./profile/ProfileControls.js";
import type { SubmitResult } from "./profile/ProfileEdit.js";
import { ProfileEdit } from "./profile/ProfileEdit.js";
import { ProfileView } from "./profile/ProfileView.js";
import {
  type DirectoryNav as DirectoryNavModel,
  type DirectoryNavState,
  type StepDirection,
  deriveDirectoryNav,
  stepNavState,
} from "./profile/directory-nav.js";
import { getDirectoryStash } from "./profile/directory-stash.js";
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
  /** The "← Directory" action: pop `directoryDelta` entries to the Directory, or `/` on a cold deep-link. */
  backToDirectory: () => void;
  /** The prev/next-through-the-Directory model derived from `location.state` (4d, N45). */
  directoryNav: DirectoryNavModel;
  /** Push to the previous brother in the stashed set (no-op at the start / with no stash). */
  goPrev: () => void;
  /** Push to the next brother in the stashed set (no-op at the end / with no stash). */
  goNext: () => void;
  /** The pending Prev/Next direction to re-focus after the step remounts the bar (OFC-144), else null. */
  autoFocusStep: StepDirection | null;
  /** Called by the bar once it has consumed {@link autoFocusStep} (clears the one-shot intent). */
  onStepFocused: () => void;
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

  // Prev/next-through-the-Directory (4d, N45). The `location.state` carries only a
  // `stashId` handle; the ordered id-list is resolved from the stash store
  // (OFC-141). The derivation stays pure and is correct even on the not-found path
  // (a stale stashed id still has neighbours to step to). It also carries the
  // `directoryDelta` that "← Directory" and the post-delete return pop back on.
  const directoryNav = useMemo(() => {
    const navState = location.state as DirectoryNavState | null;
    return deriveDirectoryNav(navState, id, getDirectoryStash(navState?.stashId));
  }, [location.state, id]);

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
        if (outcome.status === "last_admin") {
          return { status: "last_admin" };
        }
        return { status: "forbidden" };
      } catch (error) {
        // A mid-edit session lapse (401) surfaces as its own result so the editor
        // keeps the form and shows an honest "sign in again" message rather than the
        // generic failure, and is NOT bounced to the sign-in screen (D109; the write
        // opted out of the app-wide 401 handler in api.ts).
        if (error instanceof ApiError && error.status === 401) {
          return { status: "expired" };
        }
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

  // Return to the Directory ENTRY we arrived from as a POP — popping the whole
  // Prev/Next chain via `directoryDelta` (each entry carries its own, N45) so the
  // Directory's URL filters/search/sort and `location.key`-keyed scroll are
  // restored, not `navigate("/")` (which would open a fresh, unfiltered Directory
  // at the top and lose the user's place). A cold deep-link (delta 0) has no
  // Directory entry to pop, so it falls back to the Directory home. Shared by
  // "← Directory" and the post-delete return (OFC-143).
  const popToDirectory = useCallback(() => {
    if (directoryNav.delta > 0) {
      navigate(-directoryNav.delta);
    } else {
      navigate("/");
    }
  }, [directoryNav.delta, navigate]);

  const removeProfile = useCallback(async () => {
    const outcome = await deleteProfile(id);
    if (outcome.status === "ok") {
      // The Directory refetches on remount, so the just-deleted brother is gone.
      popToDirectory();
    }
    return outcome;
  }, [id, popToDirectory]);

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
  // Directory). A cold deep-link straight to `/edit` — or the Add-Brother handoff,
  // which lands on `/edit` via a `replace` — has nothing to pop, so we replace it
  // with the display URL. In that replace we **carry the directory-return state
  // forward** (`fromDirectory`/`stashId`/`directoryDelta`) so the view's
  // "← Directory" still pops to the Directory the user came from with its
  // search/filter/sort intact, rather than a fresh, cleared one (OFC-233).
  const exitEdit = useCallback(() => {
    const state = location.state as (DirectoryNavState & { fromProfile?: boolean }) | null;
    if (state?.fromProfile) {
      navigate(-1);
    } else {
      navigate(`/brother/${id}`, {
        replace: true,
        state: state
          ? {
              fromDirectory: state.fromDirectory,
              stashId: state.stashId,
              directoryDelta: state.directoryDelta,
            }
          : undefined,
      });
    }
  }, [location.state, navigate, id]);

  // "← Directory" is the same pop as the post-delete return.
  const backToDirectory = popToDirectory;

  // Prev/Next changes the route, which unmounts the whole DirectoryNav bar during
  // the fetch (`status = "loading"`) and remounts a fresh one on `ready` — so the
  // button the keyboard user just pressed no longer exists and focus falls to
  // <body>, breaking Enter-repeat stepping (OFC-144). We record the step direction
  // here (a ref survives the remount; the container itself does not unmount) and
  // the freshly-mounted bar re-focuses the matching button, so the user can keep
  // stepping. Consumed once per step so a later non-step remount (Back/Forward)
  // doesn't steal focus.
  const stepIntentRef = useRef<StepDirection | null>(null);
  const consumeStepIntent = useCallback(() => {
    stepIntentRef.current = null;
  }, []);

  // Prev/Next: an ordinary push to the neighbour's display page, re-carrying the
  // stashed id-list with `directoryDelta + 1` so "← Directory" keeps popping to
  // the real Directory entry (N45). Guarded so an end-of-set call is a no-op.
  const goPrev = useCallback(() => {
    if (directoryNav.prevId !== null) {
      stepIntentRef.current = "prev";
      navigate(`/brother/${directoryNav.prevId}`, { state: stepNavState(directoryNav) });
    }
  }, [directoryNav, navigate]);
  const goNext = useCallback(() => {
    if (directoryNav.nextId !== null) {
      stepIntentRef.current = "next";
      navigate(`/brother/${directoryNav.nextId}`, { state: stepNavState(directoryNav) });
    }
  }, [directoryNav, navigate]);

  if (status === "loading") {
    return showOverlay ? <LoadingOverlay /> : <div className="min-h-[40vh]" />;
  }
  if (status === "notfound") {
    // A stashed id can stop resolving between stash and click (deleted /
    // de-brothered / unlisted / newly deceased — 4c). MVP shows the normal
    // not-found state but keeps the prev/next bar (the id is still a member of
    // the stashed set) so the user steps past it — no auto-skip (N45).
    return (
      <section className="mx-auto max-w-5xl">
        <DirectoryNav
          nav={directoryNav}
          onBack={backToDirectory}
          onPrev={goPrev}
          onNext={goNext}
          autoFocusStep={stepIntentRef.current}
          onStepFocused={consumeStepIntent}
        />
        <NotFound canStep={directoryNav.hasStash} />
      </section>
    );
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
    directoryNav,
    goPrev,
    goNext,
    autoFocusStep: stepIntentRef.current,
    onStepFocused: consumeStepIntent,
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
  const {
    record,
    viewer,
    roster,
    actions,
    backToDirectory,
    directoryNav,
    goPrev,
    goNext,
    autoFocusStep,
    onStepFocused,
  } = useOutletContext<ProfileOutletContext>();
  return (
    <ProfileView
      record={record}
      viewer={viewer}
      roster={roster}
      actions={actions}
      onBackToDirectory={backToDirectory}
      directoryNav={directoryNav}
      onPrev={goPrev}
      onNext={goNext}
      autoFocusStep={autoFocusStep}
      onStepFocused={onStepFocused}
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

// Rendered under the shared DirectoryNav bar (which carries the back + prev/next
// affordances, so there is no duplicate inline link here). `canStep` is true when
// a directory set was stashed, so the Prev/Next controls are present to point at.
function NotFound({ canStep = false }: { canStep?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h1 className="text-[length:var(--text-h3)] font-bold">Brother not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This record doesn't exist, or it isn't visible to you.
        {canStep && " Use Prev / Next above to continue through the directory."}
      </p>
    </div>
  );
}
