// Compares Claude's tool calls with an evaluation case.
import type Anthropic from '@anthropic-ai/sdk';
import type { EvalCase } from './cases.js';
import { CLIENT_PROJECTS } from './context.js';

export function judge(evalCase: EvalCase, calls: Anthropic.ToolUseBlock[]): { problem?: string } {
  const chosen = [...new Set(calls.map((call) => call.name))].sort().join(',');
  const accepted = evalCase.tools.map((set) => [...set].sort().join(','));
  if (!accepted.includes(chosen)) return { problem: `tools ${chosen || '(none)'}` };

  const check = evalCase.check;
  if (!check) return {};
  const input = calls.find((call) => call.name === check.tool)?.input as Record<string, unknown> | undefined;
  if (!input) return { problem: `no ${check.tool}` };
  for (const key of ['task_id', 'status', 'until_date'] as const) {
    if (check[key] !== undefined && input[key] !== check[key]) {
      return { problem: `${key} ${String(input[key])}, expected ${check[key]}` };
    }
  }
  if (check.project !== undefined) {
    const byClient = typeof input.client_name === 'string' ? projectForClient(input.client_name) : undefined;
    if (input.project_id !== check.project && byClient !== check.project) {
      return { problem: `project ${String(input.project_id ?? input.client_name)}, expected ${check.project}` };
    }
  }
  return {};
}

function projectForClient(name: string): number | undefined {
  const needle = name.toLowerCase();
  const match = Object.entries(CLIENT_PROJECTS).find(([client]) =>
    client.toLowerCase().split(' ').some((word) => word.length > 3 && needle.includes(word)),
  );
  return match?.[1];
}
