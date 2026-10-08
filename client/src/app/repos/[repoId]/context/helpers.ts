/** Pure helpers for the Project Context page. No hooks, no fetch. */

import type { ContextDocument } from "@devdigest/shared";

/**
 * Bytes → whole kilobytes, rounded, for the `kb` i18n key. Floors at 1kb for
 * any non-zero file so a tiny document doesn't display as "0kb".
 */
export function bytesToKb(bytes: number): number {
  if (bytes <= 0) return 0;
  return Math.max(1, Math.round(bytes / 1024));
}

/**
 * ISO timestamp → locale string; falls back to the raw ISO string if
 * unparsable. Mirrors `ReviewRunAccordion`'s `formatWhen`.
 */
export function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Documents ordered with the `root` bucket first (then other buckets
 * alphabetically), and alphabetically by path within a bucket — a stable,
 * predictable order for the list regardless of what order the server
 * returned them in.
 */
export function sortDocuments(documents: ContextDocument[]): ContextDocument[] {
  return documents.slice().sort((a, b) => {
    if (a.bucket !== b.bucket) {
      if (a.bucket === "root") return -1;
      if (b.bucket === "root") return 1;
      return a.bucket.localeCompare(b.bucket);
    }
    return a.path.localeCompare(b.path);
  });
}
