/**
 * Narrow ports the eval service depends on, so it never imports the reviews or
 * agents modules. `container.reviewRepo` / `container.agentsRepo` satisfy them
 * structurally; the factories below make that adaptation explicit.
 */
import type { LLMProvider } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import type { AgentRow, AgentVersionRow, FindingRow, PullRow, SkillRow } from '../../db/rows.js';

export interface FindingSource {
  findingContext(
    findingId: string,
  ): Promise<{ finding: FindingRow; review: { agentId: string | null }; pull: PullRow } | undefined>;
  getPrFiles(prId: string): Promise<{ path: string; patch: string | null }[]>;
}

export interface AgentSource {
  getById(workspaceId: string, id: string): Promise<AgentRow | undefined>;
  list(workspaceId: string): Promise<AgentRow[]>;
  linkedSkills(agentId: string): Promise<{ skill: SkillRow; order: number }[]>;
  getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined>;
}

export interface EvalPorts {
  findings: FindingSource;
  agents: AgentSource;
}

/** The slice of the DI container the eval service uses (Container satisfies it structurally). */
export interface EvalDeps {
  db: Db;
  llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider>;
  tokenizer: { count(text: string): number };
  priceBook: { estimate(model: string, tokensIn: number, tokensOut: number): number | null };
}

/** Minimal pino-compatible logger (ids and numbers only are ever logged). */
export interface EvalLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export function findingSourceFrom(c: { reviewRepo: FindingSource }): FindingSource {
  return c.reviewRepo;
}

export function agentSourceFrom(c: { agentsRepo: AgentSource }): AgentSource {
  return c.agentsRepo;
}
