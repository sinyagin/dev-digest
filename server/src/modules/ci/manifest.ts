import { stringify } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';

/** The slice of an agent the manifest needs (kept DB-free so this stays pure). */
export interface ManifestAgent {
  id: string;
  name: string;
  version: number;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
}

export interface ManifestSkill {
  id: string;
  name: string;
  body: string;
}

export interface SlugifiedSkill {
  slug: string;
  body: string;
}

/** Lower-case, `[a-z0-9-]` only, collapsed, trimmed, at most 64 chars; '' if nothing survives. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug;
}

/** Deterministic agent slug; falls back to `agent-<first 8 of id>` (spec gap: names can collide). */
export function agentSlug(agent: Pick<ManifestAgent, 'id' | 'name'>): string {
  return slugify(agent.name) || `agent-${agent.id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
}

/** Unique, deterministic skill slugs in the given (already ordered) list. */
export function skillSlugs(skills: ManifestSkill[]): SlugifiedSkill[] {
  const used = new Set<string>();
  return skills.map((s) => {
    const base =
      slugify(s.name) || `skill-${s.id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
    let slug = base;
    for (let n = 2; used.has(slug); n++) {
      const suffix = `-${n}`;
      slug = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    }
    used.add(slug);
    return { slug, body: s.body };
  });
}

/** Build + validate the manifest object (the same schema the runner reads with). */
export function buildManifest(agent: ManifestAgent, skills: SlugifiedSkill[]): AgentManifest {
  return AgentManifest.parse({
    format: 'devdigest-agent/v1',
    name: agent.name,
    slug: agentSlug(agent),
    agent_version: agent.version,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: skills.map((s) => s.slug),
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
  });
}

/**
 * Serialise the manifest with a real YAML serializer: agent-authored text
 * (names, prompts with quotes / `${{ }}` / newlines) is only ever DATA here.
 */
export function manifestYaml(manifest: AgentManifest): string {
  return stringify(manifest, { lineWidth: 0 });
}
