/* hooks/brief.ts — React Query hooks for the PR Why/Risk Brief. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BriefReadResponse, BriefGenerateResponse } from "@devdigest/shared";

/** Fetch the cached brief for a PR, if one has already been generated.
 *  No `refetchInterval` and no automatic generate-on-mount: a reload must
 *  show whatever's cached without triggering a new LLM call. */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-brief", prId],
    queryFn: () => api.get<BriefReadResponse>(`/pulls/${prId}/brief`),
    enabled: prId != null,
  });
}

/** Trigger a fresh brief generation for a PR and update the cache on success.
 *  When the result is `nothing_to_brief`, the cache is left untouched — the
 *  mutation's own result carries that state back to the caller. */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BriefGenerateResponse>(`/pulls/${prId}/brief/generate`),
    onSuccess: (data) => {
      if (data.status === "ready") {
        qc.setQueryData(["pr-brief", prId], data);
      }
    },
  });
}
