/**
 * Export-to-CI constants (SPEC-04). Everything the generated files depend on is
 * a constant here so the output is deterministic (byte-identical for identical
 * inputs) and the workflow's `run:` bodies can never carry authored text (D11).
 */

/** Bumped whenever the generator's output changes (D13). */
export const WORKFLOW_VERSION = 1;

/** Dedicated install branch; the studio never writes to the default branch. */
export const CI_BRANCH = 'devdigest/ci';
export const INSTALL_PR_TITLE = 'Add DevDigest CI review';
export const INSTALL_PR_BODY =
  'Adds the DevDigest agent manifest, skills, repository memory, the bundled review runner ' +
  'and a GitHub Actions workflow that reviews every pull request.\n\n' +
  'Required repository secret: `OPENROUTER_API_KEY`.';
export const INSTALL_COMMIT_MESSAGE = 'Add DevDigest CI review';

export const WORKFLOW_FILE = 'devdigest-review.yml';
export const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILE}`;
export const MEMORY_PATH = '.devdigest/memory.jsonl';
export const RUNNER_DIR = '.devdigest/runner';
export const RUNNER_ENTRY = `${RUNNER_DIR}/index.js`;
export const manifestPath = (slug: string): string => `.devdigest/agents/${slug}.yaml`;
export const skillPath = (slug: string): string => `.devdigest/skills/${slug}.md`;

/** Env var that overrides where the built runner bundle is read from (tests, deploys). */

export const ARTIFACT_NAME = 'devdigest-result';
export const ARTIFACT_FILE = 'devdigest-result.json';

/** Secrets the workflow expects (AC-14). */
export const OPENROUTER_SECRET = 'OPENROUTER_API_KEY';
export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN';

/** Canonical trigger order, so the workflow is independent of input order. */
export const TRIGGER_ORDER = ['opened', 'synchronize', 'reopened'] as const;

/** Ingestion limits (D6). */
export const MAX_RUNS_PER_INSTALLATION = 50;
export const MAX_ZIP_ENTRIES = 64;
export const MAX_ENTRY_BYTES = 256 * 1024;
export const MAX_ZIP_BYTES = 2 * 1024 * 1024;

/** Cap on a user-edited workflow sent for install. */
export const MAX_WORKFLOW_BYTES = 128 * 1024;

/** Generator-pinned third-party actions (full 40-hex commit SHAs; AC-27). */
export const ACTION_CHECKOUT = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
export const ACTION_SETUP_NODE = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';
export const ACTION_UPLOAD_ARTIFACT =
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02';
export const NODE_VERSION = 22;
