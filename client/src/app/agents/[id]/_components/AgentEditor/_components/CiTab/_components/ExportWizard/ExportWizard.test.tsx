import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import ciMessages from "../../../../../../../../../../messages/en/ci.json";
import { ApiError } from "@/lib/api";

const previewFn = vi.fn();
const fileFn = vi.fn();
const exportFn = vi.fn();
const zipFn = vi.fn();

vi.mock("@/lib/hooks/core", () => ({
  useRepos: () => ({ data: [{ id: "r1", full_name: "acme/api" }, { id: "r2", full_name: "acme/web" }] }),
}));
vi.mock("@/lib/hooks/ci", () => ({
  useCiTargets: () => ({ data: [{ target: "gha", label_key: "ci.targets.gha" }] }),
  useCiPreview: () => ({ mutateAsync: previewFn }),
  useCiPreviewFile: () => ({ mutateAsync: fileFn }),
  useCiExport: () => ({ mutateAsync: exportFn }),
  useCiExportZip: () => ({ mutateAsync: zipFn }),
}));

import { ExportWizard } from "./ExportWizard";

const WF = "name: review\non: pull_request\n";
const PREVIEW = {
  files: [
    { path: ".devdigest/agents/sec.yaml", contents: "name: sec\n", editable: false, size_bytes: 10 },
    { path: ".devdigest/runner/index.js", contents: null, editable: false, size_bytes: 5000 },
    { path: ".github/workflows/devdigest-review.yml", contents: WF, editable: true, size_bytes: 30 },
  ],
  secrets: [
    { name: "OPENROUTER_API_KEY", status: "not_set" },
    { name: "GITHUB_TOKEN", status: "ready" },
  ],
  existing_installation: { agent_id: "other", agent_name: "Style Bot" },
};

beforeEach(() => {
  previewFn.mockResolvedValue(PREVIEW);
  fileFn.mockResolvedValue({ path: ".devdigest/runner/index.js", contents: "console.log(1)", editable: false, size_bytes: 5000 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWizard(defaultRepo: string | null = "acme/api") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <ExportWizard agent={{ id: "ag1", name: "Security Reviewer" }} defaultRepo={defaultRepo} onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

const cont = () => screen.getByRole("button", { name: "Continue" });

describe("ExportWizard", () => {
  it("walks Target -> Preview -> Configure -> Install, keeps state on Back, gates on repo/YAML/triggers", async () => {
    const user = userEvent.setup();
    renderWizard();

    // AC-1, AC-3, AC-4, AC-5
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Run Security Reviewer automatically on pull requests")).toBeInTheDocument();
    const steps = screen.getByTestId("wizard-steps");
    expect(steps.textContent?.replace(/\d/g, "")).toBe("TargetPreviewConfigureInstall");
    expect(steps).toHaveAttribute("data-current-step", "Target");
    expect(screen.getByText("GitHub Actions")).toBeInTheDocument();
    expect(screen.queryByText("CircleCI")).not.toBeInTheDocument();
    expect(await screen.findByText(/Style Bot is already installed/)).toBeInTheDocument();
    expect(cont()).toBeEnabled();
    await user.click(cont());

    // AC-7: runner contents load only on demand; only the workflow is editable
    expect(await screen.findByText(".devdigest/runner/index.js")).toBeInTheDocument();
    expect(fileFn).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /index\.js/ }));
    expect(await screen.findByDisplayValue("console.log(1)")).toHaveAttribute("readonly");
    expect(fileFn).toHaveBeenCalledTimes(1);

    // AC-10: invalid YAML disables Continue
    await user.click(screen.getByRole("button", { name: /devdigest-review\.yml/ }));
    const editor = screen.getByLabelText("Edit workflow file");
    await user.clear(editor);
    await user.click(editor);
    await user.paste("a: [");
    expect(await screen.findByText(/Invalid YAML/)).toBeInTheDocument();
    expect(cont()).toBeDisabled();
    await user.clear(editor);
    await user.paste("a: 1\n");
    expect(cont()).toBeEnabled();
    await user.click(cont());

    // AC-11, AC-13, AC-14
    expect(screen.getByRole("checkbox", { name: "pull_request:opened" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "pull_request:synchronize" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "pull_request:reopened" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /GitHub review/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "PR comment" })).toBeInTheDocument();
    expect(screen.getByText("not set")).toBeInTheDocument();

    // AC-12: toggling after an edit resets with a notice and regenerates
    await user.click(screen.getByRole("checkbox", { name: "pull_request:reopened" }));
    expect(await screen.findByText(/Manual edits to the workflow were reset/)).toBeInTheDocument();
    expect(previewFn).toHaveBeenLastCalledWith(expect.objectContaining({ triggers: ["opened", "synchronize", "reopened"] }));

    // none selected disables Continue
    for (const n of ["opened", "synchronize", "reopened"]) {
      await user.click(screen.getByRole("checkbox", { name: `pull_request:${n}` }));
    }
    expect(cont()).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "pull_request:opened" }));

    // AC-2: back keeps choices
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(cont());
    expect(screen.getByRole("checkbox", { name: "pull_request:opened" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "pull_request:synchronize" })).not.toBeChecked();
    await user.click(cont());

    // AC-15
    expect(screen.getByText(/with the 3 generated files/)).toBeInTheDocument();
  });

  it("gates Continue on a repo (AC-4)", async () => {
    const user = userEvent.setup();
    renderWizard(null);
    expect(cont()).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Target repository"), "acme/web");
    expect(cont()).toBeEnabled();
  });

  it("shows typed error on Install, keeps zip enabled, and sends one request per double click (AC-20)", async () => {
    const user = userEvent.setup();
    let reject!: (e: unknown) => void;
    exportFn.mockReturnValue(new Promise((_, rj) => (reject = rj)));
    renderWizard();
    await user.click(cont());
    await screen.findByText(".devdigest/runner/index.js");
    await user.click(cont());
    await user.click(cont());

    const install = screen.getByRole("button", { name: "Open PR" });
    await user.dblClick(install);
    expect(exportFn).toHaveBeenCalledTimes(1);
    reject(new ApiError("nope", 403, "forbidden"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/GitHub refused the write/);
    await waitFor(() => expect(screen.getByRole("radio", { name: /Download files as a zip/ })).toBeEnabled());
    await user.click(screen.getByRole("radio", { name: /Download files as a zip/ }));
    expect(screen.getByRole("button", { name: "Download zip" })).toBeEnabled();
  });
});
