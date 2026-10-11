import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { listReviewsForPulls } from '../reviews/repository/review.repo.js';
import { DigestsRepository, type DigestRow } from './repository.js';

export class DigestsService {
  private repo: DigestsRepository;

  constructor(private container: Container) {
    this.repo = new DigestsRepository(container.db);
  }

  async generate(workspaceId: string, repoId: string, since: Date): Promise<DigestRow> {
    const repo = await this.container.reposRepo.get(workspaceId, repoId);
    if (!repo) throw new NotFoundError(`repo ${repoId} not found`);

    const token = await this.container.secrets.get('GITHUB_TOKEN');
    const github = new OctokitGitHubClient(token);
    const pulls = (await github.listPullRequests({ owner: repo.owner, name: repo.name })).filter(
      (p) => new Date(p.updated_at) >= since,
    );

    const reviews = await listReviewsForPulls(
      this.container.db,
      workspaceId,
      pulls.map((p) => p.number),
    );

    const blocking = reviews.filter((r) => r.verdict === 'request_changes').length;
    const summary =
      pulls.length === 0
        ? 'No pull request activity in this window.'
        : `${pulls.length} pull requests updated, ${reviews.length} reviewed, ${blocking} with requested changes.`;

    return this.repo.insert({
      workspaceId,
      repoId,
      since,
      pullCount: pulls.length,
      reviewedCount: reviews.length,
      blockingCount: blocking,
      summary,
    });
  }

  async get(workspaceId: string, id: string): Promise<DigestRow> {
    const row = await this.repo.get(workspaceId, id);
    if (!row) throw new NotFoundError(`digest ${id} not found`);
    return row;
  }
}
