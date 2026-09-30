import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeClient, type AiUsageRecord } from '../src/ai/claude.js';

function fakeAnthropic(message: Partial<Anthropic.Message>) {
  const create = vi.fn(async () => ({
    content: [],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
    ...message,
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const config = { apiKey: 'test', modelFast: 'fast-model', modelSmart: 'smart-model' };

describe('ClaudeClient', () => {
  it('throws when the model for a tier is not configured', () => {
    const { client } = fakeAnthropic({});
    const claude = new ClaudeClient({ ...config, modelSmart: undefined }, undefined, client);
    expect(() => claude.resolveModel('smart')).toThrow(/CLAUDE_MODEL_SMART/);
    expect(claude.resolveModel('fast')).toBe('fast-model');
  });

  it('uses the model from config and records usage', async () => {
    const { client, create } = fakeAnthropic({
      content: [{ type: 'text', text: 'Hoi', citations: null }],
    });
    const usage: AiUsageRecord[] = [];
    const claude = new ClaudeClient(config, (record) => void usage.push(record), client);

    const text = await claude.generate({
      purpose: 'morning',
      tier: 'smart',
      messages: [{ role: 'user', content: 'Goedemorgen' }],
    });

    expect(text).toBe('Hoi');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'smart-model' }));
    expect(usage).toEqual([
      { purpose: 'morning', model: 'smart-model', inputTokens: 10, outputTokens: 5 },
    ]);
  });

  it('returns tool calls', async () => {
    const { client, create } = fakeAnthropic({
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 't1', name: 'add_task', input: { title: 'Banner' } },
      ] as Anthropic.ContentBlock[],
    });
    const claude = new ClaudeClient(config, undefined, client);

    const result = await claude.callWithTools({
      purpose: 'router',
      tier: 'fast',
      messages: [{ role: 'user', content: 'klant wil banner voor vrijdag' }],
      tools: [
        {
          name: 'add_task',
          description: 'Voeg een taak toe',
          input_schema: { type: 'object', properties: { title: { type: 'string' } } },
        },
      ],
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe('add_task');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fast-model', tool_choice: { type: 'auto' } }),
    );
  });
});
