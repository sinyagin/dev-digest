/* hooks/blast.ts — Blast Radius (F?: GET /pulls/:id/blast). One hook per
   domain file, same pattern as the sibling conventions/repo-intel/reviews
   hooks, re-exported from hooks/index.ts. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResponse } from "@devdigest/shared";

export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast-radius", prId],
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: prId != null,
    staleTime: 5 * 60 * 1000,
  });
}
