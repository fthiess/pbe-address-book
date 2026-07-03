import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { cropToJpegBlob } from "./crop-image.js";

/**
 * The headshot crop dialog (§5.7; D47) — **lazily loaded** so react-easy-crop and
 * Radix Dialog land in an async chunk off the Directory/landing critical path
 * (D74; only a brother who opens the photo editor downloads them). A Radix Dialog
 * gives the focus trap, `Esc`-to-close, and labelled-modal semantics for free; the
 * crop area itself is keyboard-operable (react-easy-crop pans on arrow keys) and
 * the zoom is a native range slider, so the whole control has a non-drag
 * alternative (WCAG 2.5.7 / D47).
 *
 * On confirm the framed region is rendered through a canvas to a ≤1024² JPEG
 * ({@link cropToJpegBlob}) — the staged blob the profile Save uploads (N42). This
 * module is the ONLY place the two heavy dependencies are imported.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

export default function CropDialog({
  imageSrc,
  onCancel,
  onConfirm,
}: {
  /** Object URL of the file the brother selected. */
  imageSrc: string;
  /** Dismiss without staging a photo (Esc, overlay click, or Cancel). */
  onCancel: () => void;
  /** Stage the cropped, downscaled JPEG for upload on Save. */
  onConfirm: (blob: Blob) => void;
}) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setArea(areaPixels);
  }, []);

  async function usePhoto() {
    if (!area) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const blob = await cropToJpegBlob(imageSrc, area);
      onConfirm(blob);
    } catch {
      setError("We couldn't prepare that image. Please try a different photo.");
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          aria-describedby="crop-desc"
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-2xl)] border border-border bg-card p-6 shadow-[var(--shadow-popover-strong)]"
        >
          <Dialog.Title className="text-[length:var(--text-h3)] font-bold">
            Adjust your photo
          </Dialog.Title>
          <Dialog.Description
            id="crop-desc"
            className="mt-1 text-[length:var(--text-body-sm)] text-muted-foreground"
          >
            Drag to reposition (or use the arrow keys), and zoom to frame your face.
          </Dialog.Description>

          <div className="relative mt-4 h-72 overflow-hidden rounded-[var(--radius-lg)] bg-[#111] sm:h-80">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>

          <label className="mt-4 flex items-center gap-3 text-[length:var(--text-label)] font-semibold">
            Zoom
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              aria-label="Zoom"
              className="h-2 flex-1 cursor-pointer accent-[var(--primary)]"
            />
          </label>

          {error && (
            <p role="alert" className="mt-3 text-[length:var(--text-body-sm)] text-destructive">
              {error}
            </p>
          )}

          <div className="mt-5 flex items-center justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-[var(--radius-md)] border border-input bg-card px-4 py-2.5 text-[length:var(--text-label)] font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => void usePhoto()}
              disabled={busy || !area}
              className="rounded-[var(--radius-md)] bg-primary px-4 py-2.5 text-[length:var(--text-label)] font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {busy ? "Preparing…" : "Use photo"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
