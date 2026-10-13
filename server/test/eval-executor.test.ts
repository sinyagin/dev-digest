import { describe, it, expect } from 'vitest';
import type { EvalCaseInput, LLMProvider } from '@devdigest/shared';
import { buildEvalReviewInput, executeCase, type EvalIdentity } from '../src/modules/eval/executor.js';

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 111..222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '+const key = "sk_live_abc";',
  ' export {};',
  '',
].join('\n');

const identity: EvalIdentity = {
  agentId: 'agent-1',
  version: 3,
  systemPrompt: 'You are a reviewer.',
  model: 'm',
  provider: 'openrouter',
  strategy: 'single-pass',
  skillBodies: [],
};

const input: EvalCaseInput = {
  name: 'c',
  input_diff: DIFF,
  input_files: ['src/a.ts'],
  input_meta: { pr_number: 7, title: 'Add key', body: 'frozen body' },
  expectation: { type: 'must_find', file: 'src/a.ts', start_line: 2, end_line: 2 },
};

const finding = {
  id: 'f1',
  severity: 'high',
  category: 'security',
  title: 'Hardcoded key',
  file: 'src/a.ts',
  start_line: 2,
  end_line: 2,
  rationale: 'secret',
  confidence: 0.9,
};

function stub(behavior?: () => Promise<never> | void) {
  const calls: { messages: { role: string; content: string }[] }[] = [];
  const llm = {
    id: 'openrouter',
    listModels: async () => [],
    complete: async () => {
      throw new Error('unused');
    },
    embed: async () => [],
    async completeStructured(req: any) {
      calls.push({ messages: req.messages });
      await behavior?.();
      const data = { verdict: 'comment', summary: 's', score: 50, findings: [finding] };
      return { data, model: 'm', tokensIn: 10, tokensOut: 5, costUsd: 0.01, raw: '{}', attempts: 1 };
    },
  } as unknown as LLMProvider;
  return { llm, calls };
}

const text = (m: { content: string }[]) => m.map((x) => x.content).join('\n');

describe('eval executor', () => {
  it('AC-16 assembled messages contain none of ## Repo skeleton, ## Callers of changed symbols, ## Project context, ## Intent', async () => {
    const { llm, calls } = stub();
    const res = await executeCase(identity, input, llm);
    expect('error' in res).toBe(false);
    const all = text(calls[0]!.messages);
    for (const h of ['## Repo skeleton', '## Callers of changed symbols', '## Project context', '## Intent']) {
      expect(all).not.toContain(h);
    }
    const built = buildEvalReviewInput(identity, input, llm);
    for (const k of ['callers', 'repoMap', 'specs', 'intent', 'memory']) expect(built).not.toHaveProperty(k);
  });

  it('AC-16 contains ## Diff to review with the frozen diff inside the untrusted wrapper', async () => {
    const { llm, calls } = stub();
    await executeCase(identity, input, llm);
    const all = text(calls[0]!.messages);
    const idx = all.indexOf('## Diff to review');
    expect(idx).toBeGreaterThan(-1);
    expect(all.slice(idx)).toContain('sk_live_abc');
    expect(all.slice(idx)).toMatch(/untrusted/i);
    expect(all).toContain('frozen body');
  });

  it('AC-17 two builds for the same case+identity yield deep-equal messages', async () => {
    const a = stub();
    const b = stub();
    await executeCase(identity, input, a.llm);
    await executeCase(identity, input, b.llm);
    expect(a.calls[0]!.messages).toEqual(b.calls[0]!.messages);
    expect(buildEvalReviewInput(identity, input, a.llm).sessionId).toBe('eval:agent-1');
  });

  it('returns kept findings and usage on success', async () => {
    const { llm } = stub();
    const res = await executeCase(identity, input, llm);
    if ('error' in res) throw new Error('unexpected');
    expect(res.kept).toHaveLength(1);
    expect(res.tokensIn).toBe(10);
    expect(res.costUsd).toBe(0.01);
  });

  it('maps provider errors and timeouts to bare error strings', async () => {
    const boom = stub(async () => {
      throw new Error('secret prompt content sk-123');
    });
    const r1 = await executeCase(identity, input, boom.llm);
    expect(r1).toEqual({ error: 'provider_error' });

    const slow = stub(() => new Promise<never>(() => {}));
    const r2 = await executeCase(identity, input, slow.llm, { timeoutMs: 20 });
    expect(r2).toEqual({ error: 'timeout' });
  });
});
