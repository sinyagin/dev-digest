/* hooks/ci.ts — React Query hooks for Export-to-CI + CI Runs (SPEC-04). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CiTargetOption,
  CiExportInputBody,
  CiPreviewFileInputBody,
  CiPreview,
  CiFile,
  CiExport,
  CiInstallation,
  CiSecretStatus,
  CiRepublishResult,
  CiRefreshResult,
  CiRun,
} from "@devdigest/shared";

export function useCiTargets() {
  return useQuery({ queryKey: ["ci-targets"], queryFn: () => api.get<CiTargetOption[]>("/ci/targets") });
}

export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci/installations`),
    enabled: !!agentId,
  });
}

export function useCiSecrets(repo: string | null | undefined) {
  return useQuery({
    queryKey: ["ci-secrets", repo],
    queryFn: () => api.get<CiSecretStatus[]>(`/ci/secrets?repo=${encodeURIComponent(repo!)}`),
    enabled: !!repo,
  });
}

export function useCiRuns(agentId?: string | null) {
  return useQuery({
    queryKey: ["ci-runs", agentId ?? null],
    queryFn: () => api.get<CiRun[]>(`/ci/runs${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`),
  });
}

/** Preview is a POST but behaves as a read: a mutation the wizard fires on step entry / config change. */
export function useCiPreview(agentId: string) {
  return useMutation({
    mutationFn: (input: CiExportInputBody) => api.post<CiPreview>(`/agents/${agentId}/ci/preview`, input),
  });
}

export function useCiPreviewFile(agentId: string) {
  return useMutation({
    mutationFn: (input: CiPreviewFileInputBody) =>
      api.post<CiFile>(`/agents/${agentId}/ci/preview/file`, input),
  });
}

export function useCiExport(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) => api.post<CiExport>(`/agents/${agentId}/ci/export`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ci-installations", agentId] }),
  });
}

/** Zip flow: returns the bytes; the caller triggers the browser download. */
export function useCiExportZip(agentId: string) {
  return useMutation({
    mutationFn: (input: CiExportInputBody): Promise<Blob> =>
      api.postBlob(`/agents/${agentId}/ci/export/zip`, input),
  });
}

export function useCiRepublish(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiRepublishResult>(`/agents/${agentId}/ci/republish`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}

export function useCiRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiRefreshResult>("/ci/runs/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
      qc.invalidateQueries({ queryKey: ["ci-installations"] });
    },
  });
}
