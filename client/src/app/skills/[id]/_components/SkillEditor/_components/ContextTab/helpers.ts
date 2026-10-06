/* Pure helper for ContextTab's presentational "SERIALIZES AS" preview
   (AC-19). This is NOT the run-time injection format — see ContextTab.tsx's
   module doc — it is derived from the current `paths` during render only,
   never fetched from any endpoint. */

/** Build the preview text: the `## Project specifications` heading line
    (passed in, already translated), followed by one `- <path>` line per
    attached path, in the exact persisted order. */
export function buildSerializationPreview(paths: string[], heading: string): string {
  return [heading, ...paths.map((path) => `- ${path}`)].join("\n");
}
