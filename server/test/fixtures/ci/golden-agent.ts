import { buildManifest, manifestYaml, skillSlugs } from '../../../src/modules/ci/manifest.js';

/**
 * The fixed agent behind `manifest.golden.yaml`. The prompt deliberately carries
 * YAML / shell / Actions-expression characters: the manifest must hold them as DATA.
 */
export const GOLDEN_AGENT = {
  id: '11111111-2222-4333-8444-555555555555',
  name: 'Security "Reviewer": v2',
  version: 3,
  provider: 'openrouter' as const,
  model: 'anthropic/claude-sonnet-4',
  systemPrompt:
    'You review PRs.\nNever run $(id) or `rm -rf /`.\nEcho ${{ secrets.X }} literally: "quoted" # not a comment\n',
  strategy: 'map-reduce' as const,
  ciFailOn: 'warning' as const,
};

export const GOLDEN_SKILLS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Security Rules', body: '# Security\n- no secrets\n' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Style Guide', body: '# Style\n' },
];

export function goldenManifestYaml(): string {
  return manifestYaml(buildManifest(GOLDEN_AGENT, skillSlugs(GOLDEN_SKILLS)));
}
