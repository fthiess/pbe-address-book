import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { ProfileRecord } from "../../lib/types.js";
import { ProfileHeadshot } from "./ProfileHeadshot.js";

// Lazily loaded so react-easy-crop + Radix Dialog stay in an async chunk off the
// critical path (D74): only a brother who opens the editor downloads them.
const CropDialog = lazy(() => import("./CropDialog.js"));

/** A staged, not-yet-saved headshot change (applied on the profile Save, N42). */
export type HeadshotChange = { kind: "set"; blob: Blob; previewUrl: string } | { kind: "remove" };

/** The upload types the client accepts; the server's magic-byte check is the authority (D107). */
const ACCEPT = "image/jpeg,image/png";

/**
 * The Profile-page headshot control (§5.7; D47). Shows the current (or staged)
 * photo and offers **Change photo** (opens the crop dialog) and **Remove photo**.
 * The chosen crop is **staged** — held in the parent form and applied only when the
 * brother Saves (D50 order: text PATCH → photo write) — so the photo follows the
 * same one-Save, discardable-on-Cancel model as every other field.
 *
 * HEIC and other formats are rejected here with a clear message (desktop browsers
 * can't decode HEIC into a canvas; iPhone Safari already converts it to JPEG on
 * the file input — see OFC-122); the server's `415`/`422` remain the backstop.
 */
export function HeadshotEditor({
  record,
  name,
  staged,
  onStage,
}: {
  record: ProfileRecord;
  name: string;
  staged: HeadshotChange | null;
  onStage: (change: HeadshotChange | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Revoke the previous staged preview object URL when it is replaced or cleared
  // (and on unmount), so a series of re-crops doesn't leak blobs.
  const lastPreview = useRef<string | null>(null);
  useEffect(() => {
    const current = staged?.kind === "set" ? staged.previewUrl : null;
    if (lastPreview.current && lastPreview.current !== current) {
      URL.revokeObjectURL(lastPreview.current);
    }
    lastPreview.current = current;
  }, [staged]);
  useEffect(
    () => () => {
      if (lastPreview.current) {
        URL.revokeObjectURL(lastPreview.current);
      }
    },
    [],
  );

  function onFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so re-picking the SAME file fires `change` again.
    event.target.value = "";
    if (!file) {
      return;
    }
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setFileError(
        "Please choose a JPEG or PNG image. Other formats (including HEIC) aren't supported yet.",
      );
      return;
    }
    setFileError(null);
    setCropSrc(URL.createObjectURL(file));
  }

  function closeCrop() {
    if (cropSrc) {
      URL.revokeObjectURL(cropSrc);
    }
    setCropSrc(null);
  }

  function onConfirm(blob: Blob) {
    onStage({ kind: "set", blob, previewUrl: URL.createObjectURL(blob) });
    closeCrop();
  }

  const showingRemoved = staged?.kind === "remove";
  const hasPhotoNow = showingRemoved
    ? false
    : staged?.kind === "set" || (record.hasHeadshot ?? false);

  return (
    <div className="flex flex-col items-center gap-2">
      <Preview record={record} name={name} staged={staged} />

      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-[var(--radius-md)] border border-input bg-card px-3 py-1.5 text-[length:var(--text-label)] font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          {hasPhotoNow ? "Change photo" : "Add a photo"}
        </button>
        {hasPhotoNow && (
          <button
            type="button"
            onClick={() => onStage({ kind: "remove" })}
            className="rounded-[var(--radius-md)] px-3 py-1 text-[length:var(--text-body-sm)] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Remove photo
          </button>
        )}
        {staged && (
          <button
            type="button"
            onClick={() => onStage(null)}
            className="rounded-[var(--radius-md)] px-3 py-1 text-[length:var(--text-body-sm)] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Undo photo change
          </button>
        )}
      </div>

      {staged?.kind === "set" && (
        <p className="text-[length:var(--text-body-sm)] text-muted-foreground">
          New photo — Save to apply.
        </p>
      )}
      {showingRemoved && (
        <p className="text-[length:var(--text-body-sm)] text-muted-foreground">
          Photo will be removed on Save.
        </p>
      )}
      {fileError && (
        <p
          role="alert"
          className="max-w-[16rem] text-center text-[length:var(--text-body-sm)] text-destructive"
        >
          {fileError}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onFilePicked}
        className="sr-only"
        // A visible button drives this; keep it out of the tab order and label it
        // for the rare AT that still reaches it.
        tabIndex={-1}
        aria-hidden="true"
      />

      {cropSrc && (
        <Suspense fallback={<div aria-hidden="true" className="fixed inset-0 z-50 bg-black/60" />}>
          <CropDialog imageSrc={cropSrc} onCancel={closeCrop} onConfirm={onConfirm} />
        </Suspense>
      )}
    </div>
  );
}

/** The current-or-staged photo preview: staged image, "removed" avatar, or the record's. */
function Preview({
  record,
  name,
  staged,
}: {
  record: ProfileRecord;
  name: string;
  staged: HeadshotChange | null;
}) {
  if (staged?.kind === "set") {
    return (
      <img
        src={staged.previewUrl}
        alt="Your new headshot preview"
        width={132}
        height={132}
        className="size-[132px] shrink-0 rounded-full object-cover"
        style={{ boxShadow: "var(--shadow-avatar)" }}
      />
    );
  }
  // A staged removal previews the initials/silhouette avatar (no photo).
  const previewRecord = staged?.kind === "remove" ? { ...record, hasHeadshot: false } : record;
  return <ProfileHeadshot record={previewRecord} name={name} responsive />;
}
