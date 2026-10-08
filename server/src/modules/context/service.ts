/**
 * Project Context module — application service (SPEC-01-project-context).
 *
 * Orchestrates T4's pure helpers and T5's confined clone-docs I/O into the
 * three operations the Presentation layer (T9's routes.ts) calls directly:
 * `list`, `getDocument`, `writeDocument`. No Fastify, no Drizzle — this is
 * the Application ring; persistence/cross-module reads go through
 * `container.reposRepo` / `container.agentsRepo`, and the filesystem goes
 * through `container.git.clonePathFor` + T5's `clone-docs.ts` exports only.
 */
import type { ContextDocument, ContextDocumentContent, ContextListing, RepoRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { bucketFor, estimateTokens } from './helpers.js';
import {
  ContextFsError,
  cloneAvailable,
  readDocument,
  statDocument,
  walkMarkdown,
  writeDocument as writeDocumentToClone,
} from './clone-docs.js';

export class ContextService {
  constructor(private container: Container) {}

  /**
   * Lists every Markdown document discoverable in the repo's working-tree
   * clone (AC-2), enriched with bucket/token-estimate/usage data. When the
   * clone isn't available yet (never cloned, or removed), this is a
   * SUCCESSFUL empty response — `clone_available: false` — never a thrown
   * error (AC-34).
   */
  async list(workspaceId: string, repoId: string): Promise<ContextListing> {
    const refreshedAt = new Date().toISOString();
    const cloneRoot = await this.resolveCloneRoot(workspaceId, repoId);

    if (!cloneRoot || !(await cloneAvailable(cloneRoot))) {
      return {
        documents: [],
        summary: {
          document_count: 0,
          estimated_tokens_total: 0,
          refreshed_at: refreshedAt,
          clone_available: false,
        },
      };
    }

    const [entries, usageCounts] = await Promise.all([
      walkMarkdown(cloneRoot),
      this.container.agentsRepo.countAgentsByContextPath(workspaceId),
    ]);

    const documents: ContextDocument[] = entries.map((entry) => ({
      path: entry.path,
      bucket: bucketFor(entry.path),
      size_bytes: entry.size_bytes,
      estimated_tokens: estimateTokens(entry.size_bytes),
      updated_at: entry.updated_at,
      used_by_agents: usageCounts.get(entry.path) ?? 0,
    }));

    // Deterministic order independent of call-to-call directory-walk
    // ordering, even though walkMarkdown already sorts — re-sorting here
    // keeps this guarantee local to the service's own contract (AC-7's
    // "repeated listing calls are stable" requirement lives here, not in
    // T5's infrastructure helper).
    documents.sort((a, b) => a.path.localeCompare(b.path));

    const estimatedTokensTotal = documents.reduce((sum, doc) => sum + doc.estimated_tokens, 0);

    return {
      documents,
      summary: {
        document_count: documents.length,
        estimated_tokens_total: estimatedTokensTotal,
        refreshed_at: refreshedAt,
        clone_available: true,
      },
    };
  }

  /**
   * Reads one document's full content. Throws `ValidationError` (422, a 4xx
   * — AC-37) when the path fails confinement, and a distinguishable
   * `AppError('context_document_unreadable', …, 422)` when confinement
   * passes but the read itself fails (unreadable or non-UTF-8 — AC-10).
   * Neither case is ever a 5xx/unhandled crash.
   */
  async getDocument(workspaceId: string, repoId: string, path: string): Promise<ContextDocumentContent> {
    const cloneRoot = await this.resolveCloneRoot(workspaceId, repoId);
    if (!cloneRoot) {
      throw new NotFoundError(`Repo ${repoId} has no working-tree clone to read from`);
    }

    let content: string;
    try {
      content = await readDocument(cloneRoot, path);
    } catch (cause) {
      throw this.toApiError(cause, path);
    }

    const sizeBytes = Buffer.byteLength(content, 'utf8');

    return {
      path,
      content,
      size_bytes: sizeBytes,
      estimated_tokens: estimateTokens(sizeBytes),
      updated_at: await this.statUpdatedAt(cloneRoot, path),
    };
  }

  /**
   * Writes one document's content wholesale into the working tree. Deliberately
   * a passthrough to T5's confined write — no git commit, no push (AC-24).
   */
  async writeDocument(workspaceId: string, repoId: string, path: string, content: string): Promise<void> {
    const cloneRoot = await this.resolveCloneRoot(workspaceId, repoId);
    if (!cloneRoot) {
      throw new NotFoundError(`Repo ${repoId} has no working-tree clone to write to`);
    }

    try {
      await writeDocumentToClone(cloneRoot, path, content);
    } catch (cause) {
      throw this.toApiError(cause, path);
    }
  }

  /**
   * Resolves the repo row and derives its clone root via
   * `container.git.clonePathFor` (`<cloneDir>/<owner>/<repo>`). Returns
   * `null` — never throws — when the repo doesn't exist in this workspace or
   * its `owner`/`name` are missing/blank, so callers can degrade gracefully
   * (AC-34) instead of crashing on a malformed row.
   */
  private async resolveCloneRoot(workspaceId: string, repoId: string): Promise<string | null> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo || !repo.owner || !repo.name) return null;

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    return this.container.git.clonePathFor(ref);
  }

  /**
   * Best-effort working-tree modification time for a single already-read
   * document, to match the listing's `updated_at` semantics. Never throws —
   * a stat failure after a successful read (e.g. a benign race with a
   * concurrent delete) falls back to "now" rather than failing the whole
   * response over metadata. Delegates to `clone-docs.ts`'s `statDocument`
   * (confinement + `node:fs` stat) rather than touching `node:fs` directly —
   * `clone-docs.ts` is this feature's sole `node:fs` surface.
   */
  private async statUpdatedAt(cloneRoot: string, path: string): Promise<string> {
    const result = await statDocument(cloneRoot, path);
    return result?.updated_at ?? new Date().toISOString();
  }

  /** Maps a `ContextFsError` to a route-safe, non-5xx `AppError`; rethrows anything else untouched. */
  private toApiError(cause: unknown, path: string): unknown {
    if (!(cause instanceof ContextFsError)) return cause;

    if (cause.code === 'confinement') {
      return new ValidationError(`Refused to access "${path}": path escapes the clone root`, { path });
    }

    // 'unreadable' | 'invalid_utf8' — confinement passed, the read itself
    // didn't. Distinguishable from the confinement case via `.code` so T9
    // can map it to its own status/message if it chooses to.
    return new AppError('context_document_unreadable', `Unable to read document "${path}"`, 422, {
      path,
      reason: cause.code,
    });
  }
}
