import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, compose } from '../src/conversation/assistant.js';
import { parseButtonId } from '../src/conversation/buttons.js';
import { MAX_CONTEXT_CHARS, renderContext } from '../src/conversation/context.js';
import { buttonTitle, CORE_TOOLS, toAnthropicTools } from '../src/conversation/tools.js';
import { CASES } from '../scripts/eval/cases.js';
import { EVAL_CONTEXT } from '../scripts/eval/context.js';
import { judge } from '../scripts/eval/judge.js';

describe('button ids', () => {
  it.each([
    ['t:12:done', { kind: 'task', taskId: 12, action: 'done' }],
    ['t:3:unpark', { kind: 'task', taskId: 3, action: 'unpark' }],
    ['s:4:not_relevant', { kind: 'suggestion', suggestionId: 4, action: 'not_relevant' }],
    ['f:dayoff', { kind: 'focus', action: 'dayoff' }],
    ['sess:9:plus10', { kind: 'session', taskId: 9, action: 'plus10' }],
    ['wr:project:7', { kind: 'review', step: 'project', value: '7' }],
    ['mv:5:2', { kind: 'move', taskId: 5, projectId: 2 }],
    ['help', { kind: 'help' }],
  ])('parses %s', (id, expected) => {
    expect(parseButtonId(id)).toEqual(expected);
  });

  it.each(['t:abc:done', 't:1:explode', 'f:show:x', '', 'x'.repeat(80)])('rejects %s', (id) => {
    expect(parseButtonId(id)).toBeUndefined();
  });
});

describe('tools', () => {
  it('exposes a JSON schema per tool without $schema', () => {
    const tools = toAnthropicTools(CORE_TOOLS);
    expect(tools.map((tool) => tool.name)).toContain('add_task');
    for (const tool of tools) {
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema).not.toHaveProperty('$schema');
    }
  });

  it('keeps button titles short', () => {
    expect(buttonTitle('Onderhoud Fietsenmaker Jansen')).toHaveLength(20);
    expect(buttonTitle('Nieuwsbrief Boho')).toBe('Nieuwsbrief Boho');
  });
});

describe('context and prompt', () => {
  it('renders the context within budget, dropping the oldest messages first', () => {
    const long = Array.from({ length: 12 }, (_, i) => ({ direction: 'in' as const, body: `bericht ${i} ${'x'.repeat(2000)}` }));
    const clients = Array.from({ length: 400 }, (_, i) => `Klant nummer ${i} BV`); // about 9,000 characters
    const text = renderContext({ ...EVAL_CONTEXT, clients, recentMessages: long });
    expect(text.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(text).toContain('bericht 11');
    expect(text).not.toContain('bericht 0 ');
  });

  it('fills every placeholder of the system prompt', () => {
    const prompt = buildSystemPrompt('Sam', 'Studio Voorbeeld', 'woensdag', 'Europe/Amsterdam', renderContext(EVAL_CONTEXT));
    expect(prompt).toContain('assistent van Sam');
    expect(prompt).toContain('#11 Offerte bakkerij afmaken');
    expect(prompt).not.toMatch(/\{[a-z_]+\}/);
  });
});

describe('compose', () => {
  it('uses Claude text with the buttons from tools', () => {
    const [reply] = compose('Staat erin.', [
      { content: 'ok', buttons: [{ id: 't:1:start', title: 'Nu starten' }] },
      { content: 'ok', buttons: [{ id: 't:1:start', title: 'Nu starten' }] },
    ]);
    expect(reply).toEqual({ text: 'Staat erin.', buttons: [{ id: 't:1:start', title: 'Nu starten' }] });
  });

  it('sends only the fixed reply for list tools', () => {
    expect(compose('Hier is je lijst', [{ content: 'ok', reply: { text: 'Vandaag…' } }])).toEqual([{ text: 'Vandaag…' }]);
  });

  it('lets an exclusive reply win', () => {
    const replies = compose('Ik heb een taak gemaakt', [
      { content: 'ok', buttons: [{ id: 't:1:start', title: 'Start' }] },
      { content: 'stil', exclusive: true, reply: { text: 'Dank dat je het zegt.' } },
    ]);
    expect(replies).toEqual([{ text: 'Dank dat je het zegt.' }]);
  });
});

describe('eval judge', () => {
  const call = (name: string, input: object): Anthropic.ToolUseBlock =>
    ({ type: 'tool_use', id: name, name, input }) as Anthropic.ToolUseBlock;

  it('has at least 50 cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(50);
  });

  it('accepts a client name for the expected project', () => {
    const evalCase = CASES[1]!;
    expect(judge(evalCase, [call('add_task', { title: 'Mailing', client_name: 'Boho' })])).toEqual({});
    expect(judge(evalCase, [call('add_task', { title: 'Mailing', project_id: 1 })]).problem).toMatch(/project/);
  });

  it('checks tool set, task and date', () => {
    const snooze = CASES.find((c) => c.text === 'doe ik morgen')!;
    expect(judge(snooze, [call('snooze', { task_id: 12, until_date: '2026-10-08' })])).toEqual({});
    expect(judge(snooze, [call('snooze', { task_id: 12, until_date: '2026-10-09' })]).problem).toMatch(/until_date/);
    expect(judge(snooze, []).problem).toMatch(/none/);
  });

  it('checks the block length after rounding', () => {
    const block = CASES.find((c) => c.text.startsWith('even 40 min'))!;
    expect(judge(block, [call('start_session', { task_id: 11, minutes: 40 })])).toEqual({});
    expect(judge(block, [call('start_session', { task_id: 11, minutes: 45 })])).toEqual({});
    expect(judge(block, [call('start_session', { task_id: 11 })]).problem).toMatch(/minutes/);
  });
});
