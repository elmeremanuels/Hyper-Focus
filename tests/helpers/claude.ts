// A scripted stand-in for ClaudeClient.callWithTools.
import type Anthropic from '@anthropic-ai/sdk';
import { vi } from 'vitest';
import type { ToolCallOptions, ToolCallResult } from '../../src/ai/claude.js';

export interface ScriptedTurn {
  text?: string;
  tools?: Array<{ name: string; input: Record<string, unknown> }>;
}

export function scriptedClaude(turns: ScriptedTurn[]) {
  let index = 0;
  const callWithTools = vi.fn(async (_options: ToolCallOptions): Promise<ToolCallResult> => {
    const turn = turns[index++] ?? { text: '' };
    const toolCalls = (turn.tools ?? []).map(
      (tool, i): Anthropic.ToolUseBlock =>
        ({ type: 'tool_use', id: `call_${index}_${i}`, name: tool.name, input: tool.input }) as Anthropic.ToolUseBlock,
    );
    const content = [
      ...(turn.text ? [{ type: 'text', text: turn.text, citations: null }] : []),
      ...toolCalls,
    ] as Anthropic.ContentBlock[];
    return {
      text: turn.text ?? '',
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      message: { content } as Anthropic.Message,
    };
  });
  return { callWithTools };
}
