// Router evaluation (BOUWPLAN.md, 15): sends each case to Claude with the real prompts and
// tools and compares the chosen tools. Never runs a tool and never touches the database.
// Usage: npm run eval [-- --filter offerte] · needs ANTHROPIC_API_KEY and CLAUDE_MODEL_FAST.
import { parseArgs } from 'node:util';
import type Anthropic from '@anthropic-ai/sdk';
import { ClaudeClient } from '../src/ai/claude.js';
import { getEnv } from '../src/config/env.js';
import { buildSystemPrompt, ROUTER_TOOLS } from '../src/conversation/assistant.js';
import { renderContext } from '../src/conversation/context.js';
import { toAnthropicTools } from '../src/conversation/tools.js';
import { CASES, type EvalCase } from './eval/cases.js';
import { EVAL_CONTEXT } from './eval/context.js';
import { judge } from './eval/judge.js';

const TARGET = 0.9;
const CONCURRENCY = 4;

const { values } = parseArgs({ options: { filter: { type: 'string' } } });
const env = getEnv();
if (!env.ANTHROPIC_API_KEY || !env.CLAUDE_MODEL_FAST) {
  console.error('Set ANTHROPIC_API_KEY and CLAUDE_MODEL_FAST to run the eval.');
  process.exit(1);
}

const claude = new ClaudeClient({
  apiKey: env.ANTHROPIC_API_KEY,
  modelFast: env.CLAUDE_MODEL_FAST,
  modelSmart: env.CLAUDE_MODEL_SMART,
});
const system = buildSystemPrompt(
  EVAL_CONTEXT.name,
  EVAL_CONTEXT.businessName,
  EVAL_CONTEXT.localTime,
  EVAL_CONTEXT.timezone,
  renderContext(EVAL_CONTEXT),
);
const tools = toAnthropicTools(ROUTER_TOOLS);
const cases = CASES.filter((c) => !values.filter || c.text.includes(values.filter));

interface Result {
  case: EvalCase;
  calls: Anthropic.ToolUseBlock[];
  problem?: string;
}

async function evaluate(evalCase: EvalCase): Promise<Result> {
  try {
    const { toolCalls } = await claude.callWithTools({
      purpose: 'eval',
      tier: 'fast',
      system,
      messages: [{ role: 'user', content: evalCase.text }],
      tools,
      maxTokens: 1024,
    });
    return { case: evalCase, calls: toolCalls, ...judge(evalCase, toolCalls) };
  } catch (error) {
    return { case: evalCase, calls: [], problem: `error: ${(error as Error).message}` };
  }
}

const results: Result[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < cases.length) {
      const evalCase = cases[next++];
      if (evalCase) results.push(await evaluate(evalCase));
    }
  }),
);

const failed = results.filter((result) => result.problem);
for (const result of failed) {
  const calls = result.calls.map((call) => `${call.name}(${JSON.stringify(call.input)})`).join(' ');
  console.log(`✗ "${result.case.text}"\n    ${result.problem} · ${calls || 'no tool'}`);
}
const score = (results.length - failed.length) / Math.max(results.length, 1);
console.log(`\n${results.length - failed.length}/${results.length} correct (${(score * 100).toFixed(0)}%), target ${TARGET * 100}%`);
process.exit(score >= TARGET ? 0 : 1);
