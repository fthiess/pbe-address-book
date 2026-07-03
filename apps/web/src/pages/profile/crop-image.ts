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
  const srcW = image.naturalWidth;
  const srcH = image.naturalHeight;

  // Clamp the crop rect into the source bounds (OFC-127). react-easy-crop can report
  // an x/y slightly negative or a square extending past the source (rounding /
  // object-fit math at min-zoom or an edge drag). Sampling outside the bitmap draws
  // transparent pixels, which — since the output is alpha-less JPEG — flatten to
  // BLACK wedges on the saved photo. Snapping the rect to the actual image avoids
  // that. The crop is framed 1:1, so start from the shorter reported edge.
  const originX = Math.max(0, Math.min(area.x, srcW));
  const originY = Math.max(0, Math.min(area.y, srcH));
  const sourceEdge = Math.max(1, Math.min(area.width, area.height, srcW - originX, srcH - originY));
  const outputEdge = Math.min(Math.round(sourceEdge), MAX_UPLOAD_EDGE);

  const canvas = document.createElement("canvas");
  canvas.width = outputEdge;
  canvas.height = outputEdge;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare the image for upload.");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image, originX, originY, sourceEdge, sourceEdge, 0, 0, outputEdge, outputEdge);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not prepare the image for upload.")),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
