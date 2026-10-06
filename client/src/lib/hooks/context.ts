/* hooks/context.ts — React Query hooks for Project Context: per-repo document
   listing/content/write, and the attachment sets (which document paths are
   currently attached) for agents and skills. Mirrors hooks/agents.ts and
   hooks/skills.ts conventions: query keys, cache invalidation on mutation
   success, error surfacing via ApiError (left to callers). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ContextListing,
  ContextDocumentContent,
  ContextDocumentWrite,
  ContextAttachmentSet,
} from "@devdigest/shared";

/** Full context-document listing for a repo (GET /repos/:repoId/context). */
export function useContextDocuments(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", repoId],
    queryFn: () => api.get<ContextListing>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/** One document's working-tree content (GET /repos/:repoId/context/document). */
export function useContextDocument(
  repoId: string | null | undefined,
  path: string | null | undefined
) {
  return useQuery({
    queryKey: ["context-document", repoId, path],
    queryFn: () =>
      api.get<ContextDocumentContent>(
        `/repos/${repoId}/context/document?path=${encodeURIComponent(path!)}`
      ),
    enabled: !!repoId && !!path,
  });
}

export interface WriteContextDocumentInput extends ContextDocumentWrite {
  repoId: string;
}

/** Write a document's content to the working tree (PUT /repos/:repoId/context/document). */
export function useWriteContextDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, ...body }: WriteContextDocumentInput) =>
      api.put<ContextDocumentContent>(`/repos/${repoId}/context/document`, body),
    onSuccess: (data, { repoId }) => {
      // Listing carries size/token/used_by_agents figures that may now be stale.
      qc.invalidateQueries({ queryKey: ["context", repoId] });
      qc.invalidateQueries({ queryKey: ["context-document", repoId, data.path] });
    },
  });
}

/** An agent's currently attached document paths (GET /agents/:id/context-documents). */
export function useAgentContextDocuments(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context-documents", agentId],
    queryFn: () => api.get<ContextAttachmentSet>(`/agents/${agentId}/context-documents`),
    enabled: !!agentId,
  });
}

/** Replace an agent's full attached-document set (POST /agents/:id/context-documents). */
export function useSetAgentContextDocuments(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContextAttachmentSet) =>
      api.post<ContextAttachmentSet>(`/agents/${agentId}/context-documents`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-context-documents", agentId] });
      // used_by_agents counts in the repo listing(s) may have changed.
      qc.invalidateQueries({ queryKey: ["context"] });
    },
  });
}

/** A skill's currently attached document paths (GET /skills/:id/context-documents). */
export function useSkillContextDocuments(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context-documents", skillId],
    queryFn: () => api.get<ContextAttachmentSet>(`/skills/${skillId}/context-documents`),
    enabled: !!skillId,
  });
}

/** Replace a skill's full attached-document set (POST /skills/:id/context-documents). */
export function useSetSkillContextDocuments(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContextAttachmentSet) =>
      api.post<ContextAttachmentSet>(`/skills/${skillId}/context-documents`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-context-documents", skillId] });
      // used_by_agents counts in the repo listing(s) may have changed.
      qc.invalidateQueries({ queryKey: ["context"] });
    },
  });
}
