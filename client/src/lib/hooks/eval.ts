/* hooks/eval.ts — React Query hooks for the eval pipeline (SPEC-03). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCase,
  EvalCaseDraft,
  EvalCaseInput,
  EvalDryRunInput,
  EvalDryRunResult,
  EvalRunRecord,
  EvalRunSummary,
  EvalRunEstimate,
  EvalRunAllResult,
  EvalCompare,
  EvalDashboard,
  EvalAgentDetail,
} from "@devdigest/shared";

export const evalKeys = {
  all: ["eval"] as const,
  draft: (findingId: string | null | undefined) => ["eval", "draft", findingId] as const,
  cases: (agentId: string | null | undefined) => ["eval", "cases", agentId] as const,
  case: (id: string | null | undefined) => ["eval", "case", id] as const,
  estimate: (agentId: string | null | undefined) => ["eval", "estimate", agentId] as const,
  runs: (agentId: string | null | undefined) => ["eval", "runs", agentId] as const,
  run: (runId: string | null | undefined) => ["eval", "run", runId] as const,
  compare: (a: string | null | undefined, b: string | null | undefined) =>
    ["eval", "compare", a, b] as const,
  dashboard: ["eval", "dashboard"] as const,
  agentDetail: (agentId: string | null | undefined) => ["eval", "agent", agentId] as const,
};

/** Draft from a finding. Enabled only while the modal is open — no request before a click. */
export function useEvalCaseDraft(findingId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: evalKeys.draft(findingId),
    queryFn: () => api.get<EvalCaseDraft>(`/findings/${findingId}/eval-case-draft`),
    enabled: enabled && findingId != null,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(agentId),
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: agentId != null,
  });
}

export function useEvalCase(id: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.case(id),
    queryFn: () => api.get<EvalCase>(`/eval-cases/${id}`),
    enabled: id != null,
  });
}

function invalidateAgentEval(qc: ReturnType<typeof useQueryClient>, agentId: string) {
  void qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
  void qc.invalidateQueries({ queryKey: evalKeys.estimate(agentId) });
  void qc.invalidateQueries({ queryKey: evalKeys.agentDetail(agentId) });
  void qc.invalidateQueries({ queryKey: evalKeys.dashboard });
}

export function useCreateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) =>
      api.post<EvalCase>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: () => invalidateAgentEval(qc, agentId),
  });
}

export function useUpdateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EvalCaseInput }) =>
      api.put<EvalCase>(`/eval-cases/${id}`, input),
    onSuccess: (_d, vars) => {
      invalidateAgentEval(qc, agentId);
      void qc.invalidateQueries({ queryKey: evalKeys.case(vars.id) });
    },
  });
}

export function useDeleteEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/eval-cases/${id}`),
    onSuccess: () => invalidateAgentEval(qc, agentId),
  });
}

/** Runs the agent on a saved case or an unsaved draft. Calls the LLM — mutation only. */
export function useEvalDryRun(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalDryRunInput) =>
      api.post<EvalDryRunResult>(`/agents/${agentId}/eval-cases/dry-run`, input),
    onSuccess: (_d, vars) => {
      // A saved-case dry run persists last_result, so refresh the list.
      if ("case_id" in vars) {
        void qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
        void qc.invalidateQueries({ queryKey: evalKeys.case(vars.case_id) });
      }
    },
  });
}

export function useEvalRunEstimate(agentId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: evalKeys.estimate(agentId),
    queryFn: () => api.get<EvalRunEstimate>(`/agents/${agentId}/eval-runs/estimate`),
    enabled: enabled && agentId != null,
  });
}

/** Starts a suite run. Sends `{}` — a bodyless POST would reach the server as null. */
export function useStartEvalRun(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunRecord>(`/agents/${agentId}/eval-runs`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.runs(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.agentDetail(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.dashboard });
    },
  });
}

/** Polls every 2s while the run is `running` (AC-15). */
export function useEvalRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.run(runId),
    queryFn: () => api.get<EvalRunRecord>(`/eval-runs/${runId}`),
    enabled: runId != null,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
  });
}

export function useEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.runs(agentId),
    queryFn: () => api.get<EvalRunSummary[]>(`/agents/${agentId}/eval-runs`),
    enabled: agentId != null,
  });
}

export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunAllResult>(`/eval-runs/all`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalKeys.all });
    },
  });
}

export function useEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(a, b),
    queryFn: () =>
      api.get<EvalCompare>(
        `/eval-runs/compare?a=${encodeURIComponent(a ?? "")}&b=${encodeURIComponent(b ?? "")}`,
      ),
    enabled: a != null && b != null,
  });
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: evalKeys.dashboard,
    queryFn: () => api.get<EvalDashboard>(`/eval/dashboard`),
  });
}

export function useEvalAgentDetail(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.agentDetail(agentId),
    queryFn: () => api.get<EvalAgentDetail>(`/eval/agents/${agentId}`),
    enabled: agentId != null,
  });
}
