/**
 * service.ts — BriefService: orchestrates the PR Why/Risk Brief.
 *
 * Onion layer: application layer — orchestrates repo + adapters; no SQL
 * here. Mirrors `intent/service.ts`'s constructor shape and
 * `blast/service.ts`'s zero-files short-circuit.
 *
 * `read()` is a pure cache read: zero LLM calls, zero recompute of
 * Intent/Blast/Smart Diff — a stored brief written by an older contract
 * shape degrades to `not_generated` rather than 500ing the Overview tab.
 *
 * `generate()` always fully regenerates (no "did the head SHA change?"
 * check) and always overwrites the stored row: resolve Project Context
 * (best-effort) → Intent (deterministic read) → Blast Radius (best-effort,
 * both a throw and a `degraded` response collapse to `blast: null`) →
 * Smart Diff (pure) → assemble facts → exactly one `completeStructured`
 * call → ground the model's output against the PR's real files/lines →
 * compose + persist `PrBrief`. A provider/validation failure propagates —
 * nothing is persisted on failure.
 */
import type { Container } from '../../platform/container.js';
import type {
  BlastRadius,
  BriefGenerateResponse,
  BriefReadResponse,
  Intent,
  PrBrief,
  RepoRef,
} from '@devdigest/shared';
import { PrBrief as PrBriefSchema } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { BriefRepository } from './repository.js';
import { BlastService } from '../blast/service.js';
import { buildSmartDiff } from '../reviews/smart-diff.js';
import { diffFromPrFiles } from '../reviews/diff-loader.js';
import { resolveProjectContext } from '../context/resolver.js';
import { readDocument } from '../context/clone-docs.js';
import { assembleBriefFacts, BRIEF_SYSTEM_PROMPT, type BriefContextDocument } from './facts.js';
import { BriefDraft } from './llm-schema.js';
import { buildChangedLineIndex, groundBrief } from './grounding.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { Logger } from '../reviews/run-executor.js';

export class BriefService {
  private readonly repo: BriefRepository;

  constructor(
    private readonly container: Container,
    private readonly logger?: Logger,
  ) {
    this.repo = new BriefRepository(container.db);
  }

  /**
   * Return the stored brief if present and still parseable against the
   * current `PrBrief` contract. Zero LLM calls, zero recompute of
   * Intent/Blast/Smart Diff.
   */
  async read(workspaceId: string, prId: string): Promise<BriefReadResponse> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`Pull request not found: ${prId}`);

    const json = await this.repo.getBriefJson(prId);
    if (json === undefined) return { status: 'not_generated' };

    const parsed = PrBriefSchema.safeParse(json);
    if (!parsed.success) {
      // A brief persisted under an older contract shape. Never 500 the
      // Overview tab over a stale stored shape — degrade to "not generated"
      // so the UI can offer to regenerate.
      this.logger?.warn(
        { prId, issues: parsed.error.issues },
        'brief: stored brief failed PrBrief validation — treating as not_generated',
      );
      return { status: 'not_generated' };
    }

    return { status: 'ready', brief: parsed.data };
  }

  /**
   * Always re-computes + overwrites the stored brief, regardless of whether
   * the PR has new commits since the last generation.
   */
  async generate(workspaceId: string, prId: string): Promise<BriefGenerateResponse> {
    // 1. Resolve PR + repo. Missing PR/repo → NotFoundError.
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`Pull request not found: ${prId}`);
    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError(`Repository not found for PR: ${prId}`);

    // 2. Zero-files short-circuit — before touching the LLM.
    const files = await this.container.reviewRepo.getPrFiles(prId);
    if (files.length === 0) {
      return { status: 'nothing_to_brief', reason: 'This PR has no changed files to brief.' };
    }

    // 3. Reviews for this PR (newest-first) — reused for both the Project
    // Context agent lookup and Smart Diff's latest-findings merge.
    const reviewRows = await this.container.reviewRepo.reviewsForPull(prId);
    const agentId = reviewRows[0]?.review.agentId ?? null;

    // Project Context resolution — best-effort. Any failure anywhere in this
    // block (including resolveProjectContext itself throwing, or clone
    // resolution failing) degrades to `documents = []`, never fails
    // generation. Mirrors run-executor.ts's fail-soft project-context block.
    let documents: BriefContextDocument[] = [];
    if (agentId) {
      try {
        const repoRef: RepoRef = { owner: repoRow.owner, name: repoRow.name };
        const cloneRoot = this.container.git.clonePathFor(repoRef);
        const agentPaths = await this.container.agentsRepo.contextDocumentsFor(agentId);
        const linkedSkills = await this.container.agentsRepo.linkedSkills(agentId);
        const skillPathLists = linkedSkills
          .filter((l) => l.skill.enabled)
          .map((l) => l.skill.contextDocuments ?? []);
        const resolved = await resolveProjectContext({
          agentPaths,
          skillPathLists,
          read: (relPath) => readDocument(cloneRoot, relPath),
        });
        documents = resolved.read.map((path, i) => ({ source: path, text: resolved.specs[i]! }));
      } catch (err) {
        this.logger?.info(
          `brief: project context resolution failed — continuing without documents (${(err as Error).message})`,
        );
        documents = [];
      }
    }

    // 4. Intent — deterministic read, no recompute.
    const storedIntent = await this.container.reviewRepo.getIntent(prId);
    const intent: Intent | null = storedIntent
      ? {
          intent: storedIntent.intent,
          in_scope: storedIntent.in_scope,
          out_of_scope: storedIntent.out_of_scope,
        }
      : null;

    // 5. Blast Radius — best-effort. Both a thrown error and a `degraded`
    // response collapse to `blast: null` (a never-indexed repo degrades
    // rather than throwing — both cases must map the same way).
    let blast: BlastRadius | null = null;
    let blastUnavailableReason: string | null = null;
    try {
      const blastResponse = await new BlastService(this.container).getForPr(prId, workspaceId);
      if (blastResponse.degraded) {
        blastUnavailableReason = blastResponse.reason ?? null;
      } else {
        blast = {
          changed_symbols: blastResponse.changed_symbols,
          downstream: blastResponse.downstream,
          summary: blastResponse.summary,
        };
      }
    } catch (err) {
      blast = null;
      blastUnavailableReason = (err as Error).message;
    }

    // 6. Smart Diff — pure, no LLM. Merges in the newest review's findings.
    const latestFindings = reviewRows[0]?.findings ?? [];
    const smartDiff = buildSmartDiff(
      files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      latestFindings.map((f) => ({ file: f.file, startLine: f.startLine, endLine: f.endLine })),
    );

    // 7. Assemble the single completeStructured user message + deterministic
    // bookkeeping (missingContext, allowedFiles).
    const { userMessage, missingContext, allowedFiles } = assembleBriefFacts({
      title: pull.title,
      body: pull.body,
      intent,
      blast,
      blastUnavailableReason,
      smartDiff,
      documents,
    });

    // 8. Resolve the feature model + make exactly one LLM call. Propagates
    // on failure — nothing is persisted.
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
    const llm = await this.container.llm(provider);
    const result = await llm.completeStructured({
      model,
      schema: BriefDraft,
      schemaName: 'BriefDraft',
      messages: [
        { role: 'system', content: BRIEF_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
    });

    // 9. Ground the model's risks/review_focus against this PR's real
    // files/lines, rebuilt purely from persisted pr_files patches (no git,
    // no network).
    const diff = await diffFromPrFiles(this.container.reviewRepo, prId);
    const changedLines = buildChangedLineIndex(diff);
    const grounded = groundBrief(result.data, { allowedFiles, changedLines });
    if (grounded.dropped.length > 0) {
      this.logger?.info(
        { prId, dropped: grounded.dropped },
        `brief: grounding dropped ${grounded.dropped.length} item(s)`,
      );
    }

    // 10. Compose the final PrBrief. `summary` is ungrounded (only
    // structured file/line refs are grounded per the spec). `history` is
    // always empty in this pass — no PR-history computation yet.
    // `missing_context` is computed from step 7, never from the model.
    const composed: PrBrief = {
      intent,
      blast,
      risks: { risks: grounded.risks },
      history: { history: [] },
      summary: result.data.summary,
      review_focus: grounded.review_focus,
      missing_context: missingContext,
      generated_for_sha: pull.headSha,
    };

    // 11. Validate + persist. Throws (and does not persist) if something's
    // off — that's intentional, not caught here.
    const brief = PrBriefSchema.parse(composed);
    await this.repo.upsertBriefJson(prId, brief);
    return { status: 'ready', brief };
  }
}
