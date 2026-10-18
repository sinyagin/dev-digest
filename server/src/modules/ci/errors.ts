import type { CiExportErrorCode } from '@devdigest/shared';
import { AppError, ConfigError } from '../../platform/errors.js';

const STATUS: Record<CiExportErrorCode, number> = {
  no_token: 400,
  forbidden: 403,
  missing_workflow_scope: 403,
  not_found: 404,
  upstream_unavailable: 502,
  runner_bundle_missing: 503,
};

/** A typed export failure; `code` is a `CiExportErrorCode` and is the API error code. */
export class CiExportError extends AppError {
  constructor(
    public readonly exportCode: CiExportErrorCode,
    message: string,
  ) {
    super(exportCode, message, STATUS[exportCode]);
    this.name = 'CiExportError';
  }
}

export const runnerBundleMissing = (): CiExportError =>
  new CiExportError(
    'runner_bundle_missing',
    'runner bundle not built — build agent-runner (or set DEVDIGEST_RUNNER_DIST) and retry',
  );

/** Map any GitHub / config failure onto the typed export errors (AC-20). Never echoes tokens. */
export function mapGitHubError(err: unknown): CiExportError {
  if (err instanceof CiExportError) return err;
  if (err instanceof ConfigError) {
    return new CiExportError('no_token', 'No GitHub token is configured (set GITHUB_TOKEN in Settings)');
  }
  const status = (err as { status?: number } | null)?.status;
  const message = String((err as { message?: string } | null)?.message ?? '');
  if (status === 401 || status === 403) {
    if (/workflow/i.test(message) && /scope/i.test(message)) {
      return new CiExportError(
        'missing_workflow_scope',
        'GitHub refused the write: the token needs the `workflow` scope to create workflow files',
      );
    }
    return new CiExportError(
      'forbidden',
      'GitHub refused the write: the token lacks permission on this repository',
    );
  }
  if (status === 404) {
    return new CiExportError('not_found', 'Repository not found, or the token cannot see it');
  }
  return new CiExportError('upstream_unavailable', 'GitHub is unavailable or returned an error');
}
