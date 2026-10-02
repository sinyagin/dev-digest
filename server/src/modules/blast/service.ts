import type { Container } from '../../platform/container.js';
import type { BlastRadiusResponse } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { BlastRepository } from './repository.js';
import { mapBlastResult } from './mapper.js';

export class BlastService {
  private readonly repo: BlastRepository;

  constructor(private readonly container: Container) {
    this.repo = new BlastRepository(container.db);
  }

  async getForPr(prId: string, workspaceId: string): Promise<BlastRadiusResponse> {
    const { pr, repo } = await this.repo.resolvePrAndRepo(prId, workspaceId);
    if (!pr) throw new NotFoundError('Pull request not found');
    if (!repo) throw new NotFoundError('Repo not found');

    const changedFiles = await this.repo.getChangedFilePaths(pr.id);

    if (changedFiles.length === 0) {
      return {
        changed_symbols: [],
        downstream: [],
        summary: 'No changed files to analyze.',
        degraded: true,
        reason: 'no_data',
      };
    }

    const blastResult = await this.container.repoIntel.getBlastRadius(repo.id, changedFiles);
    const mapped = mapBlastResult(blastResult);

    const priorPrsRaw = await this.repo.findPriorPrsTouchingSameFiles(
      repo.id,
      pr.id,
      changedFiles,
    );

    const priorPrs = priorPrsRaw.map((p) => ({
      id: p.id,
      number: p.number,
      title: p.title,
      openedAt: p.openedAt ? p.openedAt.toISOString() : null,
      status: p.status,
    }));

    return {
      ...mapped,
      ...(blastResult.degraded ? { degraded: true, reason: blastResult.reason } : {}),
      priorPrs,
    };
  }
}
