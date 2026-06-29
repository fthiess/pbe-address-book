import type { Profile as ProfileType } from "@pbe/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";
import { LoadingOverlay } from "../components/LoadingOverlay.js";
import { ApiError, fetchProfile, patchProfile } from "../lib/api.js";
import type { ProfileRecord } from "../lib/types.js";
import { useDelayedFlag } from "../lib/useDelayedFlag.js";
import { ProfileEdit, type SubmitResult } from "./profile/ProfileEdit.js";
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
 * The Profile page (§5.7) — Book's read/edit surface for one brother. It loads
 * the record (and its concurrency token) from `GET /api/profiles/:id`, derives
 * the viewer's relationship to it from `/api/me`, and renders the view or the
 * edit form. Edit mode is its own URL (`/brother/:id/edit`); a viewer who may not
 * edit is redirected to the view. Save is orchestrated here — the PATCH-first
 * sequence, the `412` reconcile re-fetch, and the success toast (§5.7.9).
 */
export function Profile({ mode }: { mode: "view" | "edit" }) {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const { state } = useSession();
  const navigate = useNavigate();

  const me = state.status === "authenticated" ? state.me : null;
  const viewer: Viewer | null = me ? { role: me.role, isOwner: me.profileId === id } : null;

  const [record, setRecord] = useState<ProfileRecord | null>(null);
  const [etag, setEtag] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
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
    // Re-fetch on id change. The view↔edit transition needs no re-fetch: a save
    // updates `record`/`etag` in place, Cancel leaves them untouched, and a stale
    // edit baseline is caught by the 412 reconcile.
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
          return { status: "ok" };
        }
        if (outcome.status === "stale") {
          const fresh = await fetchProfile(id);
          setEtag(fresh.etag);
          const changed = Object.keys(fresh.profile)
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
        return { status: "forbidden" };
      } catch {
        return { status: "error" };
      }
    },
    [id, etag, record],
  );

  const onSaved = useCallback(() => {
    const message = viewer?.isOwner ? "Saved — verified as of today." : "Saved.";
    navigate(`/brother/${id}`, { state: { toast: message } });
  }, [navigate, id, viewer?.isOwner]);

  const onCancel = useCallback(() => navigate(`/brother/${id}`), [navigate, id]);

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

  if (mode === "edit") {
    if (!canEdit(viewer)) {
      navigate(`/brother/${id}`, { replace: true });
      return null;
    }
    return (
      <ProfileEdit
        record={record}
        viewer={viewer}
        submit={submit}
        onCancel={onCancel}
        onSaved={onSaved}
      />
    );
  }

  return (
    <>
      <SavedToast />
      <ProfileView record={record} viewer={viewer} />
    </>
  );
}

/** A transient "Saved" confirmation read from navigation state (§5.7.6 toast). */
function SavedToast() {
  const location = useLocation();
  const message = (location.state as { toast?: string } | null)?.toast;
  const [visible, setVisible] = useState(Boolean(message));
  const cleared = useRef(false);

  useEffect(() => {
    if (!message) {
      return;
    }
    // Drop the message from history state so a refresh doesn't replay it.
    if (!cleared.current) {
      cleared.current = true;
      window.history.replaceState({ ...window.history.state, usr: null }, "");
    }
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message || !visible) {
    return null;
  }
  return (
    // <output> carries an implicit ARIA "status" polite live region (matching
    // LoadingOverlay) so the save confirmation is announced.
    <output className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[var(--radius-lg)] border border-[var(--success-border)] bg-[#1b262b] px-4 py-2.5 text-[length:var(--text-body)] text-white shadow-[var(--shadow-popover-strong)]">
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
