import { z } from 'zod';

/**
 * Project Context DTOs (cross-module feature). These supersede the older,
 * all-optional `SpecFile` in `platform.ts` — that contract is left in place,
 * unused, but every field here is deliberately REQUIRED (no `.nullish()`)
 * so null-handling never has to be pushed into client surfaces downstream.
 */

/** One document in the Project Context listing (a file under a known bucket). */
export const ContextDocument = z.object({
  path: z.string(),
  bucket: z.string(),
  size_bytes: z.number().int(),
  estimated_tokens: z.number().int(),
  updated_at: z.string(),
  used_by_agents: z.number().int(),
});
export type ContextDocument = z.infer<typeof ContextDocument>;

/** GET listing response: documents + an aggregate summary. */
export const ContextListing = z.object({
  documents: z.array(ContextDocument),
  summary: z.object({
    document_count: z.number().int(),
    estimated_tokens_total: z.number().int(),
    refreshed_at: z.string(),
    clone_available: z.boolean(),
  }),
});
export type ContextListing = z.infer<typeof ContextListing>;

/** GET one document's content. */
export const ContextDocumentContent = z.object({
  path: z.string(),
  content: z.string(),
  size_bytes: z.number().int(),
  estimated_tokens: z.number().int(),
  updated_at: z.string(),
});
export type ContextDocumentContent = z.infer<typeof ContextDocumentContent>;

/** PUT/create body for writing one document's content. */
export const ContextDocumentWrite = z.object({
  path: z.string(),
  content: z.string(),
});
export type ContextDocumentWrite = z.infer<typeof ContextDocumentWrite>;

/**
 * Body for the attachment-set endpoint — REPLACE-ALL semantics (the full
 * desired set of attached paths, possibly empty), not a patch/diff.
 */
export const ContextAttachmentSet = z.object({
  paths: z.array(z.string()),
});
export type ContextAttachmentSet = z.infer<typeof ContextAttachmentSet>;
