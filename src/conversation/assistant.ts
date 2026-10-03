// The conversation router from step 1.2 (BOUWPLAN.md, 10.1): buttons without AI, then
// the active mode, then Claude (fast model) with tools and context.
import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeClient } from '../ai/claude.js';
import { fillPrompt, loadPrompt } from '../ai/prompts.js';
import { getProfile, type UserProfile } from '../core/profile.js';
import type { Database } from '../db/client.js';
import { handleButton, HELP_MESSAGE, type ButtonContext, type ButtonExtension } from './buttons.js';
import { loadContext, renderContext } from './context.js';
import type { Router } from './router.js';
import { getState, type ConversationMode, type ConversationStateRow } from './state.js';
import { sessionButtons, sessionModeHandler, SESSION_TOOLS, type SessionData } from './session.js';
import { CORE_TOOLS, runTool, toAnthropicTools, type ToolDefinition, type ToolOutcome } from './tools.js';
import type { Button, InboundMessage, InboundSource, OutboundMessage } from './types.js';
import { focusView, parkingMessage, SHOW_TODAY } from './views.js';

/** Handles a message while a mode is active. Returns undefined to pass it on to Claude. */
export type ModeHandler = (
  message: Extract<InboundMessage, { kind: 'text' }>,
  state: ConversationStateRow,
  ctx: ButtonContext,
) => Promise<OutboundMessage[] | undefined>;

export interface AssistantDeps {
  db: Database;
  /** Without Claude, only buttons and the fixed words below work. */
  claude: Pick<ClaudeClient, 'callWithTools'> | undefined;
  tools?: ToolDefinition[];
  buttonExtensions?: ButtonExtension[];
  modeHandlers?: Partial<Record<ConversationMode, ModeHandler>>;
  now?: () => Date;
  log?: Pick<Console, 'error' | 'warn'>;
}

/** All tools the router offers Claude. */
export const ROUTER_TOOLS: ToolDefinition[] = [...CORE_TOOLS, ...SESSION_TOOLS];

/** Tool rounds per message; after that the reply goes out as it is. */
export const MAX_TOOL_ROUNDS = 3;

export const TEXTS = {
  unknownUser: 'Je account ken ik nog niet.',
  error: 'Er ging iets mis aan mijn kant. Probeer het zo nog eens.',
  noAi: 'Vrije tekst lees ik nu niet. Tik op een knop of stuur "vandaag".',
  empty: 'Dat begreep ik niet helemaal. Wil je het anders zeggen?',
  saved: 'Staat erin.',
} as const;

// Fixed words that never need an AI call (the Telegram commands map to these).
const FIXED: Record<string, 'today' | 'parking' | 'help'> = {
  vandaag: 'today',
  focus: 'today',
  parkeerplaats: 'parking',
  help: 'help',
};

export function createAssistantRouter(deps: AssistantDeps): Router {
  const tools = deps.tools ?? ROUTER_TOOLS;
  const buttonExtensions = [sessionButtons(), ...(deps.buttonExtensions ?? [])];
  const modeHandlers: Partial<Record<ConversationMode, ModeHandler>> = {
    session: (message, state, ctx) => sessionModeHandler(message.text, state.data as SessionData, ctx),
    ...deps.modeHandlers,
  };
  const anthropicTools = toAnthropicTools(tools);
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console;

  return async (message) => {
    const profile = await getProfile(deps.db, message.userId);
    if (!profile) return [{ text: TEXTS.unknownUser }];
    const ctx: ButtonContext = {
      db: deps.db,
      userId: profile.id,
      timezone: profile.timezone,
      now: now(),
      claude: deps.claude,
    };

    if (message.kind === 'button') {
      return handleButton(message.buttonId, ctx, buttonExtensions);
    }

    const state = await getState(deps.db, profile.id, ctx.now);
    if (state.mode !== 'idle') {
      const handler = modeHandlers[state.mode];
      let handled: OutboundMessage[] | undefined;
      try {
        handled = handler ? await handler(message, state, ctx) : undefined;
      } catch (error) {
        log.error(`Mode ${state.mode} failed:`, error);
      }
      if (handled) return handled;
    }

    const fixed = FIXED[message.text.trim().toLowerCase().replace(/^\//, '')];
    if (fixed === 'today') return [await focusView(deps.db, profile.id, profile.timezone, ctx.now)];
    if (fixed === 'parking') return [await parkingMessage(deps.db, profile.id)];
    if (fixed === 'help') return [HELP_MESSAGE];

    if (!deps.claude) return [{ text: TEXTS.noAi, buttons: [SHOW_TODAY] }];

    try {
      return await converse(deps.claude, profile, message.text, message.source ?? 'telegram', ctx);
    } catch (error) {
      log.error('Assistant failed:', error);
      return [{ text: TEXTS.error, buttons: [SHOW_TODAY] }];
    }
  };

  async function converse(
    claude: Pick<ClaudeClient, 'callWithTools'>,
    profile: UserProfile,
    text: string,
    source: InboundSource,
    ctx: ButtonContext,
  ): Promise<OutboundMessage[]> {
    const system = await systemPrompt(deps.db, profile, ctx.now);
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: text }];
    const outcomes: ToolOutcome[] = [];
    let reply = '';

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await claude.callWithTools({
        userId: profile.id,
        purpose: 'router',
        tier: 'fast',
        system,
        messages,
        tools: anthropicTools,
        maxTokens: 4096,
      });
      reply = result.text.trim();
      if (result.toolCalls.length === 0 || round === MAX_TOOL_ROUNDS) break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      const roundOutcomes: ToolOutcome[] = [];
      for (const call of result.toolCalls) {
        const outcome = await safeRunTool(call, { ...ctx, source });
        outcomes.push(outcome);
        roundOutcomes.push(outcome);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: outcome.content,
          ...(outcome.isError && { is_error: true }),
        });
      }
      // Fixed replies end the turn; Claude does not need to see the result.
      if (outcomes.some((outcome) => outcome.exclusive)) break;
      if (roundOutcomes.every((outcome) => outcome.reply && !outcome.isError)) break;
      messages.push({ role: 'assistant', content: result.message.content }, { role: 'user', content: results });
    }

    return compose(reply, outcomes);
  }

  async function safeRunTool(call: Anthropic.ToolUseBlock, ctx: ButtonContext & { source: InboundSource }) {
    try {
      return await runTool(tools, call.name, call.input, ctx);
    } catch (error) {
      log.error(`Tool ${call.name} failed:`, error);
      return { content: 'Dit lukte niet door een fout. Zeg dat het niet gelukt is.', isError: true };
    }
  }
}

/** Claude's text first with the buttons from the tools, then any fixed replies. */
export function compose(text: string, outcomes: ToolOutcome[]): OutboundMessage[] {
  const exclusive = outcomes.find((outcome) => outcome.exclusive && outcome.reply);
  if (exclusive?.reply) return [exclusive.reply];

  const replies = outcomes.flatMap((outcome) => (outcome.reply ? [outcome.reply] : []));
  const buttons = dedupe(outcomes.flatMap((outcome) => (outcome.reply ? [] : (outcome.buttons ?? [])))).slice(0, 9);
  const withoutReply = outcomes.some((outcome) => !outcome.reply);

  if (replies.length > 0 && !withoutReply) return replies;
  const first: OutboundMessage = {
    text: text || (outcomes.length > 0 ? TEXTS.saved : TEXTS.empty),
    ...(buttons.length > 0 && { buttons }),
  };
  return [first, ...replies];
}

function dedupe(buttons: Button[]): Button[] {
  const seen = new Set<string>();
  return buttons.filter((button) => !seen.has(button.id) && seen.add(button.id));
}

export async function systemPrompt(db: Database, profile: UserProfile, now: Date): Promise<string> {
  const data = await loadContext(db, profile.id, now);
  return buildSystemPrompt(profile.name, data.businessName, data.localTime, data.timezone, renderContext(data));
}

export function buildSystemPrompt(
  name: string,
  business: string | null,
  localTime: string,
  timezone: string,
  context: string,
): string {
  const values = {
    naam: name,
    bedrijf: business ?? 'eigen bedrijf',
    lokale_tijd: localTime,
    tijdzone: timezone,
    context,
  };
  return `${fillPrompt(loadPrompt('systeem'), values)}\n\n${fillPrompt(loadPrompt('router'), values)}`;
}
