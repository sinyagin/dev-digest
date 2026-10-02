/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract,
   plus SmartDiffViewer (files grouped by risk role, findings overlaid) and
   FileCard (its per-file building block), and the DiffFindingApi contract
   that threads accept/dismiss + the inline finding card into the diff. */
export { DiffViewer } from "./DiffViewer";
export { SmartDiffViewer } from "./SmartDiffViewer";
export { FileCard } from "./FileCard";
export type { DiffCommentApi } from "./comments";
export type { DiffFindingApi } from "./findings";
