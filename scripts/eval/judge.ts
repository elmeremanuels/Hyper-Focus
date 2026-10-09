// Compares Claude's tool calls with an evaluation case.
import type Anthropic from '@anthropic-ai/sdk';
import type { EvalCase } from './cases.js';
import { roundToPreset } from '../../src/conversation/blocks.js';
import { CLIENT_PROJECTS } from './context.js';

export function judge(evalCase: EvalCase, calls: Anthropic.ToolUseBlock[]): { problem?: string } {
  const chosen = [...new Set(calls.map((call) => call.name))].sort().join(',');
  const accepted = evalCase.tools.map((set) => [...set].sort().join(','));
  if (!accepted.includes(chosen)) return { problem: `tools ${chosen || '(none)'}` };

  const check = evalCase.check;
  if (!check) return {};
  const input = calls.find((call) => call.name === check.tool)?.input as Record<string, unknown> | undefined;
  // The check is about one accepted tool set; another accepted set skips it.
  if (!input) return chosen.split(',').includes(check.tool) ? { problem: `no ${check.tool}` } : {};
  for (const key of ['task_id', 'status', 'until_date'] as const) {
    if (check[key] !== undefined && input[key] !== check[key]) {
      return { problem: `${key} ${String(input[key])}, expected ${check[key]}` };
    }
  }
  if (check.work_type !== undefined) {
    const actual = (input.work_type as string | undefined) ?? null;
    if (actual !== check.work_type) return { problem: `work_type ${String(actual)}, expected ${String(check.work_type)}` };
  }
  if (check.minutes !== undefined) {
    const actual = typeof input.minutes === 'number' ? roundToPreset(input.minutes) : undefined;
    if (actual !== check.minutes) return { problem: `minutes ${String(input.minutes)}, expected ${check.minutes}` };
  }
  if (check.enabled !== undefined && input.enabled !== check.enabled) {
    return { problem: `enabled ${String(input.enabled)}, expected ${String(check.enabled)}` };
  }
  for (const [key, expected] of Object.entries(check.fields ?? {})) {
    if (input[key] !== expected) return { problem: `${key} ${String(input[key])}, expected ${String(expected)}` };
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
