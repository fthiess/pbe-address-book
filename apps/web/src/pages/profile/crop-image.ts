/**
 * Client-side crop + downscale for the headshot pipeline (N42). Given the source
 * image and the pixel rectangle react-easy-crop reports, render that region
 * through a canvas at **≤1024×1024 JPEG (quality ≈0.9)** and hand back the blob to
 * upload. Two wins beyond framing: a multi-megabyte phone photo never crosses a
 * DSL-class wire ([[project-audience-slow-connections]]), and the canvas
 * re-encode drops EXIF/GPS metadata. The server still magic-byte-checks and
 * re-encodes — this is a courtesy, not a trust boundary (D107).
 */

/** A crop rectangle in source-image pixels (react-easy-crop's `croppedAreaPixels`). */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The longest edge of the uploaded JPEG (N42); the crop is square, so both edges. */
export const MAX_UPLOAD_EDGE = 1024;
/** JPEG quality for the upload (N42) — visually ample; the server re-encodes to WEBP. */
const JPEG_QUALITY = 0.9;

/** Load an object-URL/data-URL into a decoded `HTMLImageElement`. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Could not load the selected image.")));
    image.src = src;
  });
}

/**
 * Crop `imageSrc` to `area` and downscale to at most {@link MAX_UPLOAD_EDGE} per
 * side, returning a JPEG `Blob`. The output side is `min(area edge, 1024)`, so a
 * small crop is never upscaled. Throws if the browser cannot produce a blob (e.g.
 * a canvas that could not be created).
 */
export async function cropToJpegBlob(imageSrc: string, area: CropArea): Promise<Blob> {
  const image = await loadImage(imageSrc);

  // The crop is framed 1:1 by the UI; clamp to a square defensively and cap the
  // output edge at 1024 so we never upscale a small selection.
  const sourceEdge = Math.min(area.width, area.height);
  const outputEdge = Math.min(Math.round(sourceEdge), MAX_UPLOAD_EDGE);

  const canvas = document.createElement("canvas");
  canvas.width = outputEdge;
  canvas.height = outputEdge;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare the image for upload.");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image, area.x, area.y, sourceEdge, sourceEdge, 0, 0, outputEdge, outputEdge);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not prepare the image for upload.")),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
