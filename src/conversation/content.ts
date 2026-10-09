// The content module in the conversation (step C1): "post voor Studio Rust: …", the approval
// buttons and the answer to "Aanpassen".
import { z } from 'zod';
import { findClientByName } from '../core/clients.js';
import { recordEvent } from '../core/events.js';
import { applyEdit, approveAll, approvePost, contentEnabled, draftPosts, EDIT_MINUTES, editablePost, approvalMessage, skipPost } from '../content/posts.js';
import { clientChannels, clients } from '../db/schema/index.js';
import { and, eq } from 'drizzle-orm';
import { CONTENT_TEXTS } from '../texts/content.nl.js';
import type { ButtonExtension } from './buttons.js';
import { clearState, setState } from './state.js';
import { defineTool, type ToolDefinition } from './tools.js';
import type { ModeHandler } from './assistant.js';

export function contentButtons(): ButtonExtension {
  return async (button, ctx) => {
    if (button.kind === 'posts') return approveAll(ctx);
    if (button.kind !== 'post') return undefined;
    if (button.action === 'ok') {
      const reply = await approvePost(ctx, button.postId);
      await recordEvent(ctx.db, ctx.userId, 'post_approved', { postId: button.postId });
      return [reply];
    }
    if (button.action === 'skip') return [await skipPost(ctx, button.postId)];
    const blocked = await editablePost(ctx, button.postId);
    if (blocked) return [blocked];
    await setState(ctx.db, ctx.userId, 'post_edit', { postId: button.postId }, new Date(ctx.now.getTime() + EDIT_MINUTES * 60_000));
    return [{ text: CONTENT_TEXTS.editAsk }];
  };
}

/** The next message after "Aanpassen" is the wish (or the new text). */
export const postEditModeHandler: ModeHandler = async (message, state, ctx) => {
  const postId = Number(state.data.postId);
  if (!Number.isInteger(postId)) return undefined;
  await clearState(ctx.db, ctx.userId);
  return [await applyEdit(ctx, postId, message.text)];
};

const draftPost = defineTool({
  name: 'draft_post',
  description:
    'Zet een social-mediapost klaar ter goedkeuring, alleen als de gebruiker uitdrukkelijk een post wil voor een klant of eigen merk ("post voor Studio Rust: …"). Neem de tekst letterlijk over; herschrijf alleen als daarom gevraagd wordt. channel is optioneel: een dienst (instagram, linkedin) of kanaalnaam.',
  input: z.object({
    client_name: z.string().min(1).max(200),
    text: z.string().min(5).max(3000),
    channel: z.string().max(100).optional(),
  }),
  async run(input, ctx) {
    if (!(await contentEnabled(ctx.db, ctx.userId))) {
      return { content: 'De contentmodule staat uit. Zeg dat die aan kan in Instellingen op het dashboard.' };
    }
    const client = await findClientByName(ctx.db, ctx.userId, input.client_name);
    if (!client) return { content: `Klant "${input.client_name}" niet gevonden. Vraag welke klant het is.`, isError: true };
    const [row] = await ctx.db.select({ socials: clients.socialsEnabled }).from(clients).where(eq(clients.id, client.id));
    const channels = row?.socials
      ? await ctx.db.select().from(clientChannels).where(and(eq(clientChannels.userId, ctx.userId), eq(clientChannels.clientId, client.id)))
      : [];
    if (channels.length === 0) {
      return { content: `Bij ${client.name} zijn nog geen kanalen gekoppeld. Zeg dat dat op de klantkaart in het dashboard kan.` };
    }
    const wanted = input.channel?.toLowerCase();
    const chosen = wanted ? channels.filter((c) => c.service === wanted || c.name.toLowerCase().includes(wanted)) : channels;
    if (chosen.length === 0) {
      return { content: `${client.name} heeft geen kanaal "${input.channel}". Gekoppeld: ${channels.map((c) => `${c.name} (${c.service})`).join(', ')}.`, isError: true };
    }
    const ids = await draftPosts(ctx, { clientId: client.id, text: input.text, channelIds: chosen.map((c) => c.id) });
    const [first, ...rest] = await Promise.all(ids.map((id) => approvalMessage(ctx, id)));
    if (!first) return { content: 'Er is geen post gemaakt.', isError: true };
    return { content: 'Post klaargezet ter goedkeuring.', exclusive: true, reply: first, followUps: rest };
  },
});

export const CONTENT_TOOLS: ToolDefinition[] = [draftPost];
