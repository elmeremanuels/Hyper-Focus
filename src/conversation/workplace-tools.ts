// Router tools to manage workplace links (step 1.10): list_tools, set_tool, remove_tool.
import { z } from 'zod';
import { removeUserTool, saveUserTool } from '../core/user-tools.js';
import { catalogTool, LINK_REJECTED, labelFromLink, toolsFor, validateToolLink, WORK_LABELS, WORK_TYPES } from '../tools/catalog.js';
import { defineTool, type ToolDefinition } from './tools.js';
import { toolsOverview } from './workplace.js';

const listTools = defineTool({
  name: 'list_tools',
  description: 'Toon de tools van de gebruiker per soort werk, met knoppen om te wijzigen ("mijn tools").',
  input: z.object({}),
  async run(_input, ctx) {
    return { content: 'Tools getoond.', reply: await toolsOverview(ctx) };
  },
});

const setTool = defineTool({
  name: 'set_tool',
  description:
    'Stel de tool in voor een soort werk ("ik factureer in Moneybird"). Geef tool_key uit de catalogus, of url als de gebruiker een link plakt.',
  input: z.object({
    work_type: z.enum(WORK_TYPES),
    tool_key: z.string().optional().describe('Bijv. moneybird, eboekhouden, jortt, exact, gmail, outlook, google_calendar, buffer, linkedin, canva, wordpress, webflow, shopify, google_drive, notion.'),
    url: z.string().optional().describe('Een https-link die de gebruiker plakte.'),
  }),
  async run(input, ctx) {
    const tool = input.tool_key ? catalogTool(input.tool_key) : undefined;
    const link = input.url ? validateToolLink(input.url) : (tool?.defaultUrl ?? undefined);
    if (input.url && !link) return { content: 'Link geweigerd.', reply: { text: LINK_REJECTED } };
    if (tool && !tool.workTypes.includes(input.work_type)) {
      return { content: `${tool.label} hoort niet bij ${input.work_type}. Kies uit: ${toolsFor(input.work_type).map((t) => t.key).join(', ')}.`, isError: true };
    }
    if (!link) {
      return { content: 'Geen link bekend voor deze tool.', reply: { text: 'Plak de link van het scherm waar je begint, dan zet ik hem klaar.' } };
    }
    const label = tool?.label ?? labelFromLink(link);
    await saveUserTool(ctx.db, ctx.userId, { workType: input.work_type, toolKey: tool?.key ?? 'other', label, url: link });
    return { content: `${WORK_LABELS[input.work_type]}: ${label} ingesteld. Bevestig kort.` };
  },
});

const removeTool = defineTool({
  name: 'remove_tool',
  description: 'Verwijder de tool voor een soort werk.',
  input: z.object({ work_type: z.enum(WORK_TYPES) }),
  async run(input, ctx) {
    const removed = await removeUserTool(ctx.db, ctx.userId, input.work_type);
    return { content: removed ? 'Verwijderd. Bevestig kort.' : 'Er stond geen tool voor dit soort werk.' };
  },
});

export const WORKPLACE_TOOLS: ToolDefinition[] = [listTools, setTool, removeTool];
