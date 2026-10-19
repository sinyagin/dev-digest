import { parseDocument } from 'yaml';
import { strToU8, zipSync } from 'fflate';
import { RunTrace } from '@devdigest/shared';
import type {
  CiExport,
  CiExportInput,
  CiFile,
  CiInstallation,
  CiPreview,
  CiPreviewFileInput,
  CiRefreshResult,
  CiRepublishResult,
  CiRun,
  CiSecretStatus,
  CiTargetOption,
  RepoRef,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { buildRunTrace, emptyPromptAssembly } from '../../platform/trace-builder.js';
import type { AgentRow } from '../../db/rows.js';
import type { RepoRow } from '../../db/rows.js';
import {
  ARTIFACT_NAME,
  CI_BRANCH,
  GITHUB_TOKEN_SECRET,
  INSTALL_COMMIT_MESSAGE,
  INSTALL_PR_BODY,
  INSTALL_PR_TITLE,
  MAX_RUNS_PER_INSTALLATION,
  MAX_WORKFLOW_BYTES,
  OPENROUTER_SECRET,
  RUNNER_DIR,
  WORKFLOW_FILE,
  WORKFLOW_VERSION,
} from './constants.js';
import { assembleBundle, listRunnerFiles, readRunnerFile, runnerDistDir } from './bundle.js';
import { CiExportError, mapGitHubError } from './errors.js';
import {
  installationToDto,
  memoryJsonl,
  parseRepo,
  runToDto,
  secretStatus,
} from './helpers.js';
import { agentSlug, buildManifest, manifestYaml, skillSlugs } from './manifest.js';
import { CiRepository, type CiInstallationRow, type InstallationWithAgent } from './repository.js';
import { isSupportedTarget, listTargets } from './targets.js';
import { findCredential, verifyArtifact } from './verify-artifact.js';
import { buildWorkflow } from './workflow.js';

interface Logger {
  warn(obj: unknown, msg?: string): void;
}

/** Everything generation needs about the target repository. */
interface ResolvedRepo {
  row: RepoRow;
  ref: RepoRef;
}

/** Export-to-CI orchestration (SPEC-04). No LLM calls anywhere in this class (AC-40). */
export class CiService {
  private repo: CiRepository;

  constructor(
    private container: Container,
    private log?: Logger,
  ) {
    this.repo = new CiRepository(container.db);
  }

  listTargets(): CiTargetOption[] {
    return listTargets();
  }

  // ---- generation --------------------------------------------------------

  async preview(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiPreview> {
    const agent = await this.getAgent(workspaceId, agentId);
    const target = await this.resolveRepo(workspaceId, input.repo);
    this.assertInput(input);
    // Preview always shows the GENERATED workflow; the client keeps any edit (D8).
    const files = await this.generate(workspaceId, agent, target, { ...input, workflow_override: undefined }, false);
    const other = await this.repo.otherAgentInstallation(workspaceId, input.repo, agent.id);
    return {
      files,
      secrets: await this.secretStatuses(target.ref),
      existing_installation: other ? { agent_id: other.agentId, agent_name: other.agentName } : null,
    };
  }

  /** One preview file with contents (how runner files are loaded on demand, AC-7). */
  async previewFile(
    workspaceId: string,
    agentId: string,
    input: CiPreviewFileInput,
  ): Promise<CiFile> {
    const agent = await this.getAgent(workspaceId, agentId);
    const target = await this.resolveRepo(workspaceId, input.repo);
    this.assertInput(input);
    const prefix = `${RUNNER_DIR}/`;
    if (input.path.startsWith(prefix)) {
      // Resolve through the dist listing, never by joining the caller's path.
      const name = input.path.slice(prefix.length);
      const dir = runnerDistDir(this.container.config.runnerDistDir);
      const runner = await listRunnerFiles(dir);
      const file = runner.find((f) => f.name === name);
      if (!file) throw new NotFoundError('File not found in the bundle');
      return {
        path: input.path,
        contents: await readRunnerFile(file.name, dir),
        editable: false,
        size_bytes: file.size,
      };
    }
    const files = await this.generate(workspaceId, agent, target, { ...input, workflow_override: undefined }, false);
    const found = files.find((f) => f.path === input.path);
    if (!found) throw new NotFoundError('File not found in the bundle');
    return found;
  }

  // ---- install -----------------------------------------------------------

  /** Install via PR: commit to `devdigest/ci`, reuse/open the PR, then record the installation. */
  async exportViaPr(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    const agent = await this.getAgent(workspaceId, agentId);
    const target = await this.resolveRepo(workspaceId, input.repo);
    this.assertInput(input);
    return this.installViaPr(workspaceId, agent, target, input);
  }

  async exportZip(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<{ filename: string; bytes: Uint8Array }> {
    const agent = await this.getAgent(workspaceId, agentId);
    const target = await this.resolveRepo(workspaceId, input.repo);
    this.assertInput(input);
    const files = await this.generate(workspaceId, agent, target, input, true);
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f.path] = strToU8(f.contents ?? '');
    const bytes = zipSync(entries, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') });
    await this.recordInstallation(agent, input, null);
    return { filename: `devdigest-ci-${agentSlug(agent)}.zip`, bytes };
  }

  private async installViaPr(
    workspaceId: string,
    agent: AgentRow,
    target: ResolvedRepo,
    input: CiExportInput,
  ): Promise<CiExport> {
    // Generate FIRST so a missing runner bundle fails before any GitHub call.
    const files = await this.generate(workspaceId, agent, target, input, true);
    let prUrl: string;
    try {
      const gh = await this.container.github();
      const base = await gh.getDefaultBranch(target.ref);
      await gh.commitFiles(target.ref, {
        branch: CI_BRANCH,
        base,
        message: INSTALL_COMMIT_MESSAGE,
        files: files.map((f) => ({ path: f.path, contents: f.contents ?? '' })),
      });
      const existing = await gh.findOpenPr(target.ref, CI_BRANCH);
      prUrl =
        existing?.url ??
        (
          await gh.openPullRequest(target.ref, {
            title: INSTALL_PR_TITLE,
            head: CI_BRANCH,
            base,
            body: INSTALL_PR_BODY,
          })
        ).url;
    } catch (err) {
      const mapped = mapGitHubError(err);
      this.log?.warn(
        {
          repo: `${target.ref.owner}/${target.ref.name}`,
          status: (err as { status?: number } | null)?.status,
          code: mapped.exportCode,
          err: safeMessage(err),
        },
        'ci export: GitHub rejected the install',
      );
      throw mapped;
    }
    // Recorded only after GitHub accepted the write (AC-20).
    const installation = await this.recordInstallation(agent, input, prUrl);
    return {
      installation,
      files: files.map((f) => (f.path.startsWith(`${RUNNER_DIR}/`) ? { ...f, contents: null } : f)),
      pr_url: prUrl,
    };
  }

  private async recordInstallation(
    agent: AgentRow,
    input: CiExportInput,
    prUrl: string | null,
  ): Promise<CiInstallation> {
    const row = await this.repo.upsertInstallation({
      agentId: agent.id,
      repo: input.repo,
      targetType: input.target,
      triggers: [...input.triggers],
      postAs: input.post_as,
      exportedAgentVersion: agent.version,
      workflowVersion: WORKFLOW_VERSION,
      prUrl,
    });
    return installationToDto(row, agent.version, undefined);
  }

  async listInstallations(workspaceId: string, agentId: string): Promise<CiInstallation[]> {
    const agent = await this.getAgent(workspaceId, agentId);
    const rows = await this.repo.installationsForAgent(agent.id);
    const last = await this.repo.lastRuns(rows.map((r) => r.id));
    return rows.map((r) => installationToDto(r, agent.version, last.get(r.id)));
  }

  async secretStatus(workspaceId: string, repoFullName: string): Promise<CiSecretStatus[]> {
    const target = await this.resolveRepo(workspaceId, repoFullName);
    return this.secretStatuses(target.ref);
  }

  /** "Update CI config": regenerate + republish every installation, per-repo outcome (AC-46). */
  async republish(workspaceId: string, agentId: string): Promise<CiRepublishResult> {
    const agent = await this.getAgent(workspaceId, agentId);
    const rows = await this.repo.installationsForAgent(agent.id);
    const results: CiRepublishResult['results'] = [];
    for (const inst of rows) {
      if (inst.targetType !== 'gha') continue;
      try {
        const target = await this.resolveRepo(workspaceId, inst.repo);
        const out = await this.installViaPr(workspaceId, agent, target, {
          repo: inst.repo,
          target: 'gha',
          action: 'open_pr',
          post_as: inst.postAs,
          triggers: storedTriggers(inst),
        });
        results.push({
          installation_id: inst.id,
          repo: inst.repo,
          ok: true,
          pr_url: out.pr_url,
          error: null,
        });
      } catch (err) {
        const e = err instanceof AppError ? err : mapGitHubError(err);
        results.push({
          installation_id: inst.id,
          repo: inst.repo,
          ok: false,
          pr_url: null,
          error: { code: e.code, message: e.message },
        });
      }
    }
    return { results };
  }

  // ---- ingestion ---------------------------------------------------------

  /** Pull workflow runs + result artifacts from GitHub and store the verified ones (D5/D6). */
  async refresh(workspaceId: string): Promise<CiRefreshResult> {
    const all = await this.repo.installationsForWorkspace(workspaceId);
    // D7: one active agent per repository — the newest installation owns the repo's runs.
    const seen = new Set<string>();
    const owners: InstallationWithAgent[] = [];
    for (const inst of all) {
      if (inst.installation.targetType !== 'gha') continue;
      if (seen.has(inst.installation.repo)) continue;
      seen.add(inst.installation.repo);
      owners.push(inst);
    }

    const result: CiRefreshResult = { ingested: 0, failed: 0, errors: [] };
    for (const inst of owners) {
      try {
        const counts = await this.refreshInstallation(workspaceId, inst);
        result.ingested += counts.ingested;
        result.failed += counts.failed;
      } catch (err) {
        result.errors.push({
          installation_id: inst.installation.id,
          repo: inst.installation.repo,
          message: safeMessage(err),
        });
        this.log?.warn(
          { installation: inst.installation.id, repo: inst.installation.repo, err: safeMessage(err) },
          'ci refresh failed for installation',
        );
      }
    }
    return result;
  }

  private async refreshInstallation(
    workspaceId: string,
    inst: InstallationWithAgent,
  ): Promise<{ ingested: number; failed: number }> {
    const { installation } = inst;
    const ref = parseRepo(installation.repo);
    if (!ref) throw new Error('installation has an invalid repository');
    const gh = await this.container.github();
    const runs = await gh.listWorkflowRuns(ref, WORKFLOW_FILE, MAX_RUNS_PER_INSTALLATION);
    const candidates = runs.slice(0, MAX_RUNS_PER_INSTALLATION);
    const known = await this.repo.existingRunStatuses(
      workspaceId,
      candidates.map((r) => r.id),
    );
    const repoRow = await this.container.reposRepo.findByFullName(workspaceId, installation.repo);

    let ingested = 0;
    let failed = 0;
    for (const run of candidates) {
      if (run.status === 'completed' && run.conclusion === 'skipped') continue; // fork PRs etc.
      const prior = known.get(run.id);
      if (prior !== undefined && prior !== 'running') continue; // each run is ingested once

      const base = {
        workspaceId,
        installationId: installation.id,
        agentId: installation.agentId,
        repo: installation.repo,
        workflowRunId: run.id,
        githubUrl: run.htmlUrl,
        ranAt: new Date(run.createdAt),
        prNumber: run.prNumber,
        prUrl: run.prNumber == null ? null : `https://github.com/${installation.repo}/pull/${run.prNumber}`,
        commitSha: run.headSha,
        fallbackAgentName: inst.agentName,
      };

      let outcome;
      if (run.status !== 'completed') {
        outcome = await this.repo.ingestRun({
          ...base,
          status: 'running',
          failureReason: null,
          accepted: null,
        });
      } else {
        let failureReason: string | null = null;
        let bytes: Uint8Array | null = null;
        try {
          bytes = await gh.downloadRunArtifact(ref, run.id, ARTIFACT_NAME);
          if (!bytes) failureReason = 'artifact_unavailable';
        } catch (err) {
          if ((err as Error)?.name !== 'ArtifactTooLargeError') throw err; // transient: retry next refresh
          failureReason = 'artifact_rejected:oversize';
        }
        const verdict = bytes
          ? verifyArtifact(bytes, { repository: installation.repo, headSha: run.headSha })
          : null;
        if (verdict && !verdict.ok) failureReason = `artifact_rejected:${verdict.check}`;

        if (verdict?.ok) {
          const a = verdict.artifact;
          const runFailed = a.status === 'failed';
          const prNumber = run.prNumber ?? a.pr_number ?? null;
          const prId =
            repoRow && prNumber != null
              ? await this.repo.prIdFor(workspaceId, repoRow.id, prNumber)
              : null;
          const trace = RunTrace.parse({
            ...buildRunTrace({
              config: {
                agent: a.agent,
                version: String(a.agent_version),
                provider: 'openrouter',
                model: a.model,
                pr: prNumber,
                source: 'ci',
              },
              stats: {
                duration_ms: a.duration_ms ?? 0,
                tokens_in: 0,
                tokens_out: 0,
                cost_usd: a.cost_usd,
                findings: a.findings_count,
                grounding: 'grounded by the CI runner',
              },
              promptAssembly: emptyPromptAssembly('', ''),
              toolCalls: [],
              rawOutput: '',
              memoryPulled: [],
              specsRead: [],
              log: [
                {
                  t: '00.00',
                  kind: runFailed ? 'error' : 'info',
                  msg: `Ingested from GitHub Actions run ${run.id}`,
                },
              ],
            }),
            ci: {
              manifest_sha256: a.manifest_sha256,
              agent_version: a.agent_version,
              dependencies: a.dependencies,
              commit_sha: a.commit_sha,
              workflow_run_id: run.id,
            },
          });
          outcome = await this.repo.ingestRun({
            ...base,
            prNumber,
            prUrl: prNumber == null ? null : `https://github.com/${installation.repo}/pull/${prNumber}`,
            status: runFailed ? 'failed' : a.findings_count === 0 ? 'no_findings' : 'succeeded',
            failureReason: runFailed ? `runner_${a.error_category ?? 'unknown'}` : null,
            accepted: {
              agentName: a.agent,
              model: a.model,
              verdict: a.verdict,
              findingsCount: a.findings_count,
              critical: a.critical ?? null,
              warning: a.warning ?? null,
              suggestion: a.suggestion ?? null,
              blockers: a.blockers,
              costUsd: a.cost_usd,
              durationMs: a.duration_ms ?? null,
              runStatus: runFailed ? 'failed' : 'done',
              error: runFailed ? (a.error_category ?? 'internal') : null,
              trace,
              prId,
            },
          });
          if (runFailed && outcome !== 'unchanged') failed += 1;
        } else {
          // No artifact, or a D6 check failed: a bare failed run, NO artifact field stored.
          outcome = await this.repo.ingestRun({
            ...base,
            status: 'failed',
            failureReason,
            accepted: null,
          });
          if (outcome !== 'unchanged') failed += 1;
        }
      }
      if (outcome !== 'unchanged') ingested += 1;
    }
    return { ingested, failed };
  }

  /** Stored runs only — makes no GitHub call (AC-40). */
  async listRuns(workspaceId: string, agentId?: string): Promise<CiRun[]> {
    if (agentId) await this.getAgent(workspaceId, agentId);
    const rows = await this.repo.listRuns(workspaceId, agentId);
    return rows.map(runToDto);
  }

  // ---- internals ---------------------------------------------------------

  private async getAgent(workspaceId: string, id: string): Promise<AgentRow> {
    const agent = await this.container.agentsRepo.getById(workspaceId, id);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  /** 400 naming `repo` for a malformed value; 404 for a repo not imported in this workspace. */
  private async resolveRepo(workspaceId: string, full: string): Promise<ResolvedRepo> {
    const ref = parseRepo(full);
    if (!ref) {
      throw new AppError('validation_error', 'repo must be "owner/name"', 400, { field: 'repo' });
    }
    const row = await this.container.reposRepo.findByFullName(workspaceId, full);
    if (!row) throw new NotFoundError('Repository not found');
    return { row, ref };
  }

  private assertInput(input: CiExportInput): void {
    if (!isSupportedTarget(input.target)) {
      throw new AppError('validation_error', 'target is not supported yet', 400, { field: 'target' });
    }
    const wf = input.workflow_override;
    if (wf !== undefined) {
      if (Buffer.byteLength(wf, 'utf8') > MAX_WORKFLOW_BYTES) {
        throw new AppError('validation_error', 'workflow_override is too large', 400, {
          field: 'workflow_override',
        });
      }
      if (parseDocument(wf).errors.length > 0) {
        throw new AppError('validation_error', 'workflow_override is not valid YAML', 400, {
          field: 'workflow_override',
        });
      }
    }
  }

  /** Deterministic bundle for (agent version, workflow version, repo, triggers, post mode). */
  private async generate(
    workspaceId: string,
    agent: AgentRow,
    target: ResolvedRepo,
    input: CiExportInput,
    runnerContents: boolean,
  ): Promise<CiFile[]> {
    const linked = await this.container.agentsRepo.linkedSkills(agent.id);
    const skills = skillSlugs(
      linked.filter((l) => l.skill.enabled).map((l) => ({
        id: l.skill.id,
        name: l.skill.name,
        body: l.skill.body,
      })),
    );
    const manifest = buildManifest(
      {
        id: agent.id,
        name: agent.name,
        version: agent.version,
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        strategy: agent.strategy,
        ciFailOn: agent.ciFailOn,
      },
      skills,
    );
    const memory = await this.repo.repoMemory(workspaceId, target.row.id);
    const workflow =
      input.workflow_override ??
      buildWorkflow({ slug: manifest.slug, postAs: input.post_as, triggers: input.triggers });
    return assembleBundle(
      {
        slug: manifest.slug,
        manifestYaml: manifestYaml(manifest),
        skills,
        memoryJsonl: memoryJsonl(memory),
        workflow,
      },
      { runnerContents, runnerDir: this.container.config.runnerDistDir },
    );
  }

  /** OPENROUTER_API_KEY presence via the repo's secret NAMES (never values); GITHUB_TOKEN is always ready. */
  private async secretStatuses(ref: RepoRef): Promise<CiSecretStatus[]> {
    let openrouter: CiSecretStatus['status'] = 'unknown';
    try {
      const gh = await this.container.github();
      const names = await gh.listRepoSecretNames(ref);
      openrouter = names.includes(OPENROUTER_SECRET) ? 'ready' : 'not_set';
    } catch {
      openrouter = 'unknown'; // no token, or GitHub refused the lookup
    }
    return [secretStatus(OPENROUTER_SECRET, openrouter), secretStatus(GITHUB_TOKEN_SECRET, 'ready')];
  }
}

function storedTriggers(inst: CiInstallationRow): CiExportInput['triggers'] {
  const allowed = ['opened', 'synchronize', 'reopened'] as const;
  const t = (inst.triggers as string[]).filter((x): x is (typeof allowed)[number] =>
    (allowed as readonly string[]).includes(x),
  );
  return t.length > 0 ? t : ['opened', 'synchronize'];
}

/** A short error string that can never carry a credential-shaped value. */
function safeMessage(err: unknown): string {
  const msg = String((err as { message?: string } | null)?.message ?? 'unknown error').slice(0, 300);
  return findCredential(msg) ? 'error (message withheld)' : msg;
}
