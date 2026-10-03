// The dashboard assistant (step 2a.7): a braindump becomes a proposal of tasks, notes and
// ideas; nothing is saved until the user confirms. Saving runs the same tools as the
// Telegram router (add_task, log_note, add_idea), so the rules stay in one place.
// Rate limit per user with a 429, after the pattern in Publicato
// server/routes/intelligent-assistant.ts (counted in the database here).
import { and, count, eq, gte } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { fillPrompt, loadPrompt } from '../../ai/prompts.js';
import { ROUTER_TOOLS } from '../../conversation/assistant.js';
import { loadContext, renderContext } from '../../conversation/context.js';
import { runTool, toAnthropicTools, type ToolDefinition } from '../../conversation/tools.js';
import { CRISIS_REPLY, flagCrisis, looksLikeCrisis } from '../../conversation/wellbeing.js';
import { findClientByName } from '../../core/clients.js';
import { recordEvent } from '../../core/events.js';
import { getProject } from '../../core/projects.js';
import { events } from '../../db/schema/index.js';
import { ASSISTANT_NAME, KIKI_TEXTS } from '../../texts/kiki.nl.js';
import { handle, userContext, type DashboardRoutesConfig } from './common.js';

export const MAX_BRAINDUMP_CHARS = 6000;
export const MAX_ITEMS = 15;
/** Proposals per user per hour; saving is not limited. */
export const PLANS_PER_HOUR = 20;

const KINDS = { task: 'add_task', note: 'log_note', idea: 'add_idea' } as const;
type Kind = keyof typeof KINDS;

const toolInput = (name: string) => {
  const tool = ROUTER_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Missing router tool ${name}`);
  return tool.input as z.ZodObject;
};

/** One item: the input of the router tool, with its kind. */
const ITEM = z.discriminatedUnion('kind', [
  toolInput(KINDS.task).extend({ kind: z.literal('task') }),
  toolInput(KINDS.note).omit({ task_id: true }).extend({ kind: z.literal('note') }),
  toolInput(KINDS.idea).extend({ kind: z.literal('idea') }),
]);
type Item = z.infer<typeof ITEM>;

const proposeTool: ToolDefinition = {
  name: 'propose_items',
  description: 'Stel de items uit de braindump voor. Er wordt nog niets opgeslagen.',
  input: z.object({
    items: z.array(ITEM).max(MAX_ITEMS),
    reply: z.string().max(300).describe('Eén korte zin voor de gebruiker.'),
    wellbeing: z.boolean().optional().describe('Alleen true bij signalen van wanhoop of zelfbeschadiging.'),
  }),
  run: async () => ({ content: 'ok' }),
};

export function assistantRoutes(config: DashboardRoutesConfig): Router {
  const router = Router();

  router.get('/api/assistant', (_req, res) => {
    res.json({ name: ASSISTANT_NAME, available: Boolean(config.claude), maxChars: MAX_BRAINDUMP_CHARS });
  });

  router.post(
    '/api/assistant/plan',
    handle(async (req, res) => {
      const ctx = await userContext(config, res);
      const { text } = z.object({ text: z.string().trim().min(1).max(MAX_BRAINDUMP_CHARS) }).parse(req.body);
      if (!config.claude) return void res.status(503).json({ error: KIKI_TEXTS.off });

      if (looksLikeCrisis(text)) {
        await flagCrisis(ctx.db, ctx.userId, 'pattern');
        return void res.json({ reply: CRISIS_REPLY.text, items: [], crisis: true });
      }
      const [recent] = await ctx.db
        .select({ n: count() })
        .from(events)
        .where(and(eq(events.userId, ctx.userId), eq(events.name, 'assistant_planned'), gte(events.createdAt, new Date(ctx.now.getTime() - 3_600_000))));
      if ((recent?.n ?? 0) >= PLANS_PER_HOUR) return void res.status(429).set('Retry-After', '600').json({ error: KIKI_TEXTS.tooMany });

      const data = await loadContext(ctx.db, ctx.userId, ctx.now);
      const system = fillPrompt(loadPrompt('braindump'), {
        assistent: ASSISTANT_NAME,
        naam: ctx.name,
        bedrijf: data.businessName ?? 'eigen bedrijf',
        lokale_tijd: data.localTime,
        tijdzone: data.timezone,
        context: renderContext(data),
      });
      // The braindump goes in as the user's message, apart from the instructions.
      const result = await config.claude.callWithTools({
        userId: ctx.userId,
        purpose: 'braindump',
        tier: 'smart',
        system,
        messages: [{ role: 'user', content: text }],
        tools: toAnthropicTools([proposeTool]),
        forceTool: proposeTool.name,
        maxTokens: 8192,
      });
      await recordEvent(ctx.db, ctx.userId, 'assistant_planned', { chars: text.length }, ctx.now);

      const call = result.toolCalls.find((c) => c.name === proposeTool.name);
      const raw = (call?.input ?? {}) as { items?: unknown[]; reply?: unknown; wellbeing?: unknown };
      if (raw.wellbeing === true) {
        await flagCrisis(ctx.db, ctx.userId, 'claude');
        return void res.json({ reply: CRISIS_REPLY.text, items: [], crisis: true });
      }
      // Keep what is valid; drop the rest rather than fail the whole proposal.
      const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((item) => {
        const parsed = ITEM.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
      const shown = await Promise.all(items.slice(0, MAX_ITEMS).map((item) => describe(item)));
      res.json({ reply: items.length ? (typeof raw.reply === 'string' ? raw.reply : '') : KIKI_TEXTS.empty, items: shown });

      async function describe(item: Item) {
        const { project_id: projectId, client_name: clientName } = item as { project_id?: number; client_name?: string };
        const project = projectId !== undefined ? await getProject(ctx.db, ctx.userId, projectId) : undefined;
        const client = clientName ? await findClientByName(ctx.db, ctx.userId, clientName) : undefined;
        return { ...item, where: project?.title ?? client?.name ?? null };
      }
    }),
  );

  router.post(
    '/api/assistant/apply',
    handle(async (req, res) => {
      const ctx = await userContext(config, res);
      const { items } = z.object({ items: z.array(ITEM).min(1).max(MAX_ITEMS) }).parse(req.body);
      const results = [];
      for (const { kind, ...input } of items) {
        const outcome = await runTool(ROUTER_TOOLS, KINDS[kind as Kind], input, { ...ctx, source: 'web', claude: undefined, calendar: config.calendar });
        results.push({ kind, ok: !outcome.isError, ...(outcome.isError && { error: outcome.content }) });
      }
      const saved = results.filter((r) => r.ok).length;
      await recordEvent(ctx.db, ctx.userId, 'assistant_applied', { saved, failed: results.length - saved }, ctx.now);
      res.json({ saved, results });
    }),
  );

  return router;
}
