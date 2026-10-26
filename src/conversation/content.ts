// The content module in the conversation (steps C1–C4): "post voor Studio Rust: …", the approval
// buttons, the answer to "Aanpassen", and the image: menu, own photo, own words.
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { findClientByName } from '../core/clients.js';
import { recordEvent } from '../core/events.js';
import { applyEdit, approveAll, approvalMessage, approvePost, contentEnabled, draftPosts, EDIT_MINUTES, editablePost, skipPost, type ContentContext } from '../content/posts.js';
import { attachPhoto, autoPropose, availableSources, IMAGE_SOURCES, nextImage, proposeImage, removeImage, type ImageSource, type ProposeResult } from '../content/images/propose.js';
import { clientChannels, clients, contentPosts } from '../db/schema/index.js';
import { CONTENT_TEXTS } from '../texts/content.nl.js';
import type { ButtonExtension } from './buttons.js';
import { clearState, getState, setState } from './state.js';
import { defineTool, type ToolDefinition } from './tools.js';
import type { ModeHandler } from './assistant.js';
import type { InboundMessage, OutboundMessage } from './types.js';

/** The approval message after an image change, with a note or the reason it failed. */
async function afterImage(ctx: ContentContext, postId: number, result: ProposeResult): Promise<OutboundMessage[]> {
  const message = await approvalMessage(ctx, postId);
  if (!result.ok) return [{ text: CONTENT_TEXTS.imageFailed(result.reason) }, message];
  return result.note ? [message, { text: result.note }] : [message];
}

async function sourcesFor(ctx: ContentContext, postId: number): Promise<{ available: ImageSource[]; preferred: ImageSource[] } | undefined> {
  const [row] = await ctx.db
    .select({ folder: clients.photoFolderUrl, memes: clients.memesAllowed, sources: clients.imageSources })
    .from(contentPosts)
    .innerJoin(clients, eq(clients.id, contentPosts.clientId))
    .where(and(eq(contentPosts.userId, ctx.userId), eq(contentPosts.id, postId)));
  if (!row) return undefined;
  const available = availableSources(ctx.content?.media, row);
  const preferred = row.sources.filter((s): s is ImageSource => available.includes(s as ImageSource));
  return { available, preferred };
}

/** The image menu: the sources that work for this client, own photo, own words, none. */
async function imageMenu(ctx: ContentContext, postId: number): Promise<OutboundMessage> {
  const sources = await sourcesFor(ctx, postId);
  if (!sources) return { text: CONTENT_TEXTS.notFound };
  const labels = CONTENT_TEXTS.sourceLabels;
  const options = [...sources.available, 'upload', 'describe', 'none'] as const;
  return { text: CONTENT_TEXTS.menuAsk, choices: options.map((o) => ({ id: `ci:${postId}:${o}`, title: labels[o] })) };
}

/** Which source the user's words point to; otherwise the client's first. */
export function sourceFromWords(text: string, available: ImageSource[], preferred: ImageSource[]): ImageSource | undefined {
  const t = text.toLowerCase();
  const pick = (s: ImageSource) => (available.includes(s) ? s : undefined);
  if (/\bmeme\b/.test(t)) return pick('meme');
  if (/pexels|stockfoto|stock foto/.test(t)) return pick('pexels');
  if (/tekstkaart|citaat|quote/.test(t)) return pick('textcard');
  if (/\bai\b|genereer|maak (een|zelf)|teken|illustratie/.test(t)) return pick('ai');
  if (/(uit )?(mijn|de) map|drive|eigen foto/.test(t)) return pick('drive');
  return preferred[0] ?? available[0];
}

/** "meme over maandag", "pexels: strand": the source and the wish for one post. */
async function describe(ctx: ContentContext, postId: number, text: string): Promise<OutboundMessage[]> {
  const sources = await sourcesFor(ctx, postId);
  if (!sources) return [{ text: CONTENT_TEXTS.notFound }];
  if (/zonder beeld|geen beeld/i.test(text)) {
    await removeImage(ctx, postId);
    return [{ text: CONTENT_TEXTS.imageRemoved }, await approvalMessage(ctx, postId)];
  }
  const source = sourceFromWords(text, sources.available, sources.preferred);
  if (!source) return afterImage(ctx, postId, { ok: false, reason: 'er is geen beeldbron beschikbaar' });
  const hint = text.replace(/^\s*(pexels|meme|ai|tekstkaart|map)\s*[:,-]\s*/i, '').trim();
  return afterImage(ctx, postId, await proposeImage(ctx, postId, source, hint));
}

export function contentButtons(): ButtonExtension {
  return async (button, ctx) => {
    if (button.kind === 'posts') return approveAll(ctx);
    if (button.kind === 'image') {
      const blocked = await editablePost(ctx, button.postId);
      if (blocked) return [blocked];
      const id = button.postId;
      switch (button.action) {
        case 'menu':
          return [await imageMenu(ctx, id)];
        case 'next':
          return afterImage(ctx, id, await nextImage(ctx, id));
        case 'none':
          await removeImage(ctx, id);
          return [await approvalMessage(ctx, id)];
        case 'upload':
        case 'describe':
          await setState(ctx.db, ctx.userId, 'post_image', { postId: id }, new Date(ctx.now.getTime() + EDIT_MINUTES * 60_000));
          return [{ text: button.action === 'upload' ? CONTENT_TEXTS.uploadAsk : CONTENT_TEXTS.describeAsk }];
        default:
          return afterImage(ctx, id, await proposeImage(ctx, id, button.action));
      }
    }
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

/** After "Eigen foto" or "Beschrijf zelf": typed or spoken words describe the image. */
export const postImageModeHandler: ModeHandler = async (message, state, ctx) => {
  const postId = Number(state.data.postId);
  if (!Number.isInteger(postId)) return undefined;
  await clearState(ctx.db, ctx.userId);
  return describe(ctx, postId, message.text);
};

/** The post a photo or image wish is about: the one in the image mode, else the newest waiting one. */
async function targetPost(ctx: ContentContext): Promise<number | undefined> {
  const state = await getState(ctx.db, ctx.userId, ctx.now);
  if (state.mode === 'post_image' && Number.isInteger(Number(state.data.postId))) return Number(state.data.postId);
  const [latest] = await ctx.db
    .select({ id: contentPosts.id })
    .from(contentPosts)
    .where(and(eq(contentPosts.userId, ctx.userId), inArray(contentPosts.status, ['pending_approval', 'failed']), gte(contentPosts.updatedAt, new Date(ctx.now.getTime() - 48 * 3_600_000))))
    .orderBy(desc(contentPosts.updatedAt))
    .limit(1);
  return latest?.id;
}

/**
 * A photo in Telegram. With "post voor X: …" as caption it starts a post with this photo;
 * otherwise it is the image of the post it is about, and its caption an edit instruction.
 */
export async function handlePhoto(
  message: Extract<InboundMessage, { kind: 'photo' }>,
  ctx: ContentContext,
  converse: (text: string) => Promise<OutboundMessage[]>,
): Promise<OutboundMessage[]> {
  if (!(await contentEnabled(ctx.db, ctx.userId))) return [{ text: 'Foto’s gebruik ik alleen als beeld bij een post. Zet de contentmodule aan in Instellingen.' }];
  const caption = message.caption?.trim();
  if (caption && /^(post|zet)\b[^:]{0,80}:/i.test(caption)) {
    const replies = await converse(caption);
    const fresh = await ctx.db
      .select({ id: contentPosts.id })
      .from(contentPosts)
      .where(and(eq(contentPosts.userId, ctx.userId), eq(contentPosts.status, 'pending_approval'), gte(contentPosts.createdAt, new Date(ctx.now.getTime() - 2 * 60_000))));
    if (fresh.length === 0) return [...replies, { text: CONTENT_TEXTS.photoUnused }];
    const out: OutboundMessage[] = [];
    for (const { id } of fresh) out.push(...(await afterImage(ctx, id, await attachPhoto(ctx, id, message.image))));
    return out;
  }
  const postId = await targetPost(ctx);
  if (!postId) return [{ text: CONTENT_TEXTS.noTarget }];
  await clearState(ctx.db, ctx.userId);
  return afterImage(ctx, postId, await attachPhoto(ctx, postId, message.image, caption));
}

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
    // Every post gets an image proposal from the client's sources (step C4).
    for (const id of ids) await autoPropose(ctx, id);
    const [first, ...rest] = await Promise.all(ids.map((id) => approvalMessage(ctx, id)));
    if (!first) return { content: 'Er is geen post gemaakt.', isError: true };
    return { content: 'Post klaargezet ter goedkeuring.', exclusive: true, reply: first, followUps: rest };
  },
});

const postImage = defineTool({
  name: 'post_image',
  description:
    'Gebruik als de gebruiker iets wil met het beeld van een post die op akkoord wacht: een ander beeld, een meme, een stockfoto, een tekstkaart, een AI-beeld, een foto uit de map, of zonder beeld. request is de wens in de woorden van de gebruiker. Leg zo’n wens nooit vast als taak, idee of notitie.',
  input: z.object({
    request: z.string().min(1).max(500),
    source: z.enum([...IMAGE_SOURCES, 'none']).optional(),
    post_id: z.number().int().optional(),
  }),
  async run(input, ctx) {
    const postId = input.post_id ?? (await targetPost(ctx));
    if (!postId) return { content: CONTENT_TEXTS.noPending, reply: { text: CONTENT_TEXTS.noPending }, exclusive: true };
    const blocked = await editablePost(ctx, postId);
    if (blocked) return { content: blocked.text, reply: blocked, exclusive: true };
    let replies: OutboundMessage[];
    if (input.source === 'none') {
      await removeImage(ctx, postId);
      replies = [await approvalMessage(ctx, postId)];
    } else if (input.source) {
      replies = await afterImage(ctx, postId, await proposeImage(ctx, postId, input.source, input.request));
    } else {
      replies = await describe(ctx, postId, input.request);
    }
    const [first, ...rest] = replies;
    return { content: 'Beeld bijgewerkt.', exclusive: true, reply: first ?? { text: CONTENT_TEXTS.notFound }, followUps: rest };
  },
});

export const CONTENT_TOOLS: ToolDefinition[] = [draftPost, postImage];
