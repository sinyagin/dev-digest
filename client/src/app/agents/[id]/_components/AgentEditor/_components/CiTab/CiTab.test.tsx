import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import ciMessages from "../../../../../../../../messages/en/ci.json";

const updateMutate = vi.fn();
const republishMutate = vi.fn();
let republishResult: unknown = null;

const INSTALLS = [
  { id: "i1", agent_id: "ag1", repo: "acme/api", target_type: "gha", installed_at: "", triggers: ["opened"], post_as: "github_review", exported_agent_version: 4, workflow_version: 1, pr_url: null, out_of_date: true, last_run: { status: "succeeded", ran_at: "2026-01-02T00:00:00Z" } },
  { id: "i2", agent_id: "ag1", repo: "acme/web", target_type: "gha", installed_at: "", triggers: ["opened"], post_as: "github_review", exported_agent_version: 5, workflow_version: 1, pr_url: null, out_of_date: false, last_run: null },
];
const RUN = { id: "r1", ci_installation_id: "i1", pr_number: 7, ran_at: "2026-01-02T00:00:00Z", status: "succeeded", findings_count: 3, cost_usd: null, github_url: "https://github.com/acme/api/actions/runs/1", source: null, agent: "Security Reviewer", duration_s: null, repo: "acme/api", pr_url: "https://github.com/acme/api/pull/7", verdict: null, critical: 1, warning: 2, suggestion: 0, blockers: 0, commit_sha: null, failure_reason: null };

vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ activeRepo: { full_name: "acme/api" } }) }));
vi.mock("@/lib/hooks/core", () => ({ useRepos: () => ({ data: [] }) }));
vi.mock("@/lib/hooks/agents", () => ({ useUpdateAgent: () => ({ mutate: updateMutate }) }));
vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations: () => ({ data: INSTALLS, isError: false, refetch: vi.fn() }),
  useCiRuns: () => ({ data: [RUN] }),
  useCiRepublish: () => ({
    mutate: (_: unknown, o: { onSuccess: (r: unknown) => void }) => {
      republishMutate();
      o.onSuccess(republishResult);
    },
    isPending: false,
    isError: false,
  }),
  useCiTargets: () => ({ data: [] }),
  useCiPreview: () => ({ mutateAsync: () => Promise.resolve({ files: [], secrets: [], existing_installation: null }) }),
  useCiPreviewFile: () => ({ mutateAsync: vi.fn() }),
  useCiExport: () => ({ mutateAsync: vi.fn() }),
  useCiExportZip: () => ({ mutateAsync: vi.fn() }),
}));

import { CiTab } from "./CiTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const AGENT: Agent = {
  id: "ag1", name: "Security Reviewer", description: "", provider: "openai", model: "gpt-4.1", system_prompt: "x",
  output_schema: null, strategy: "single-pass", ci_fail_on: "critical", repo_intel: true, skills_count: 0, enabled: true, version: 5,
};

describe("CiTab", () => {
  it("shows installations, out-of-date, per-repo republish results, Fail CI on save, and history without agent column", async () => {
    const user = userEvent.setup();
    republishResult = {
      results: [
        { installation_id: "i1", repo: "acme/api", ok: true, pr_url: "https://github.com/x", error: null },
        { installation_id: "i2", repo: "acme/web", ok: false, pr_url: null, error: { code: "forbidden", message: "403" } },
      ],
    };
    render(
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
        <CiTab agent={AGENT} />
      </NextIntlClientProvider>,
    );

    // AC-44 / AC-45
    expect(screen.getByText("Active in 2 repos")).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "CI deployment" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3); // 2 installations + Add repository row
    expect(screen.getAllByText("out of date")).toHaveLength(1);

    // AC-46
    await user.click(screen.getByRole("button", { name: "Update CI config" }));
    expect(republishMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("acme/api: updated")).toBeInTheDocument();
    expect(screen.getByText("acme/web: failed — 403")).toBeInTheDocument();

    // AC-47
    await user.selectOptions(screen.getByRole("combobox"), "warning");
    expect(updateMutate).toHaveBeenCalledWith({ id: "ag1", patch: { ci_fail_on: "warning" } });

    // AC-48: no agent column
    expect(screen.queryByRole("columnheader", { name: "Agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Findings" })).toBeInTheDocument();

    // Add repository opens the wizard
    await user.click(screen.getByRole("button", { name: /Add repository/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
