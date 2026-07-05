import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, de-duplicating conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Save a Blob to the user's disk under `filename` via a transient object-URL
 * anchor — the one client-side download mechanism, shared by the Directory CSV
 * export and the Admin backup download (OFC-184). The same-tick `revokeObjectURL`
 * after `click()` is safe; `try/finally` frees the URL even if the click throws.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
