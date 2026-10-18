import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
vi.mock("../api", () => ({ api: { get: (...a: unknown[]) => get(...a) }, API_BASE: "" }));

import { useMultiAgentRun, useMultiAgentRuns } from "./multi-agent";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useMultiAgentRun", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("polls every 4s while running and stops once done", async () => {
    get.mockResolvedValue({ status: "running" });
    renderHook(() => useMultiAgentRun("m1"), { wrapper: wrapper() });
    await act(async () => {});
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(get).toHaveBeenCalledTimes(2);
    get.mockResolvedValue({ status: "done" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(get).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(get).toHaveBeenCalledTimes(3);
  });
});

describe("useMultiAgentRuns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("fetches the repo's recent runs and polls only while one is running", async () => {
    get.mockResolvedValue([{ status: "done" }, { status: "running" }]);
    renderHook(() => useMultiAgentRuns({ repoId: "r1" }), { wrapper: wrapper() });
    await act(async () => {});
    expect(get).toHaveBeenCalledWith("/multi-agent-runs?limit=10&repoId=r1");
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(get).toHaveBeenCalledTimes(2);
    get.mockResolvedValue([{ status: "done" }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("fetches a PR's latest run with prId + limit=1, and nothing without a filter", async () => {
    get.mockResolvedValue([]);
    renderHook(() => useMultiAgentRuns({ prId: "p1" }, 1), { wrapper: wrapper() });
    await act(async () => {});
    expect(get).toHaveBeenCalledWith("/multi-agent-runs?limit=1&prId=p1");
    get.mockReset();
    renderHook(() => useMultiAgentRuns({ repoId: null }), { wrapper: wrapper() });
    await act(async () => {});
    expect(get).not.toHaveBeenCalled();
  });
});
