import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { OpenRouterProvider } from '../src/llm/openrouter.js';
import { StructuredOutputError } from '../src/llm/errors.js';

/**
 * Hermetic unit test for the exhausted-retries failure path
 * (reviewer-core/src/llm/openrouter.ts:115) that produced an undiagnosed
 * plain `Error` before this fix — no network, the `openai` SDK client is
 * mocked directly.
 */
const create = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create } };
  },
}));

describe('OpenRouterProvider.completeStructured', () => {
  const schema = z.object({ ok: z.boolean() });

  it('throws StructuredOutputError with diagnostics after exhausting retries on schema-invalid output', async () => {
    create.mockReset();
    create.mockResolvedValue({
      choices: [{ message: { content: '{"not_the_right_shape": true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const provider = new OpenRouterProvider('test-key');
    const call = provider.completeStructured({
      model: 'some/model',
      schema,
      schemaName: 'TestSchema',
      messages: [{ role: 'user', content: 'go' }],
      maxRetries: 1,
    });

    await expect(call).rejects.toBeInstanceOf(StructuredOutputError);
    const err = await call.catch((e) => e as StructuredOutputError);
    expect(err.schemaName).toBe('TestSchema');
    expect(err.model).toBe('some/model');
    expect(err.attempts).toBe(2); // maxRetries (1) + 1
    expect(err.raw).toContain('not_the_right_shape');
    expect(err.finishReason).toBe('stop');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('throws StructuredOutputError when OpenRouter returns no choices', async () => {
    create.mockReset();
    create.mockResolvedValue({ choices: [], error: { message: 'upstream provider error' } });

    const provider = new OpenRouterProvider('test-key');
    const call = provider.completeStructured({
      model: 'some/model',
      schema,
      schemaName: 'TestSchema',
      messages: [{ role: 'user', content: 'go' }],
      maxRetries: 1,
    });

    await expect(call).rejects.toBeInstanceOf(StructuredOutputError);
    const err = await call.catch((e) => e as StructuredOutputError);
    expect(err.message).toContain('upstream provider error');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
