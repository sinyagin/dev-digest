import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadManifest, loadAgentManifest } from './manifest.js';
import { RunnerError } from './errors.js';

const VALID_MANIFEST_YAML = `
format: "devdigest-agent/v1"
name: "Security Reviewer"
slug: "security-reviewer"
agent_version: 3
provider: "openrouter"
model: "deepseek/deepseek-v4-flash"
system_prompt: "Review this PR for security issues."
skills: ["security-basics"]
strategy: "auto"
ci_fail_on: "critical"
`;

describe('manifest loading + validation (AC-30)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'devdigest-runner-manifest-'));
    mkdirSync(path.join(dir, 'agents'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads and validates a well-formed manifest against the AgentManifest schema', () => {
    writeFileSync(path.join(dir, 'agents', 'security-reviewer.yaml'), VALID_MANIFEST_YAML);

    const { manifest, sha256 } = loadManifest(dir, 'security-reviewer');

    expect(manifest.name).toBe('Security Reviewer');
    expect(manifest.agent_version).toBe(3);
    expect(sha256).toBe(createHash('sha256').update(VALID_MANIFEST_YAML).digest('hex'));
    expect(manifest.model).toBe('deepseek/deepseek-v4-flash');
    expect(manifest.skills).toEqual(['security-basics']);
    expect(manifest.ci_fail_on).toBe('critical');
  });

  it('fails clearly when the manifest fails schema validation (bad ci_fail_on)', () => {
    writeFileSync(
      path.join(dir, 'agents', 'bad.yaml'),
      `
format: "devdigest-agent/v1"
name: "Bad Agent"
slug: "bad"
agent_version: 1
model: "gpt-4.1"
system_prompt: "review"
ci_fail_on: "sometimes"
`,
    );

    expect(() => loadManifest(dir, 'bad')).toThrow(RunnerError);
    expect(() => loadManifest(dir, 'bad')).toThrow(/failed validation/i);
  });

  it('fails clearly when the manifest is missing required fields', () => {
    writeFileSync(path.join(dir, 'agents', 'incomplete.yaml'), 'name: "No model or prompt"\n');
    expect(() => loadManifest(dir, 'incomplete')).toThrow(RunnerError);
  });

  it('rejects a pre-v1 manifest (no format/slug/agent_version)', () => {
    writeFileSync(
      path.join(dir, 'agents', 'legacy.yaml'),
      'name: "Legacy"\nmodel: "m"\nsystem_prompt: "p"\n',
    );
    expect(() => loadManifest(dir, 'legacy')).toThrow(/format|slug|agent_version/);
  });

  it('fails clearly when the requested agent has no manifest', () => {
    expect(() => loadManifest(dir, 'missing-agent')).toThrow(/Cannot read agent manifest/i);
  });

  it('picks the manifest by slug when several agents are exported side by side', () => {
    writeFileSync(path.join(dir, 'agents', 'security-reviewer.yaml'), VALID_MANIFEST_YAML);
    writeFileSync(
      path.join(dir, 'agents', 'style.yaml'),
      VALID_MANIFEST_YAML.replace('Security Reviewer', 'Style').replace('"security-reviewer"', '"style"'),
    );
    expect(loadManifest(dir, 'style').manifest.name).toBe('Style');
    expect(loadManifest(dir, 'security-reviewer').manifest.name).toBe('Security Reviewer');
  });

  it("fails when the file's declared slug does not match the requested one", () => {
    writeFileSync(path.join(dir, 'agents', 'other.yaml'), VALID_MANIFEST_YAML);
    expect(() => loadManifest(dir, 'other')).toThrow(/declares slug 'security-reviewer'/);
  });

  it('fails clearly on malformed YAML', () => {
    writeFileSync(path.join(dir, 'agents', 'broken.yaml'), 'name: "unterminated\n  bad: [1, 2\n');
    const manifestPath = path.join(dir, 'agents', 'broken.yaml');
    expect(() => loadAgentManifest(manifestPath)).toThrow(RunnerError);
  });
});
