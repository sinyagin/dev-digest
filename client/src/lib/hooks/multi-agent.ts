/* hooks/multi-agent.ts — multi-agent review runs (one + recent list) + per-agent estimates. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentEstimatesResponse, MultiAgentRun, MultiAgentRunList } from "@devdigest/shared";

/** One multi-agent run. Polls every 4 s while `running`; on a fetch error the
   last data is kept (TanStack keeps `data` on refetch failure). */
export function useMultiAgentRun(id: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", id],
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 4000 : false),
  });
}

/** Recent multi-agent runs of a repo and/or PR, newest first (`limit: 1` = the
   latest run). Polls every 4 s while any of them is still `running`, so a
   just-started run settles in the list. Disabled until a filter is known. */
export function useMultiAgentRuns(
  filter: { repoId?: string | null; prId?: string | null },
  limit = 10,
) {
  const { repoId, prId } = filter;
  return useQuery({
    queryKey: ["multi-agent-runs", { repoId: repoId ?? null, prId: prId ?? null }, limit],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (repoId) qs.set("repoId", repoId);
      if (prId) qs.set("prId", prId);
      return api.get<MultiAgentRunList>(`/multi-agent-runs?${qs.toString()}`);
    },
    enabled: !!repoId || !!prId,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? 4000 : false),
  });
}

/** Average duration/cost per agent over its last 20 done runs (no LLM call). */
export function useAgentEstimates() {
  return useQuery({
    queryKey: ["agent-estimates"],
    queryFn: () => api.get<AgentEstimatesResponse>("/agents/estimates"),
  });
}
