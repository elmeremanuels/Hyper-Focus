// Content module (step C1): Buffer channels per client and the posts that go to them.
import { boolean, index, integer, pgTable, smallint, text, time, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { id, timestamps, userId } from './common.js';
import { contentMediaSource, contentPostStatus } from './enums.js';
import { clients } from './work.js';

/** Up to three Buffer channels per client, each with its own rhythm. */
export const clientChannels = pgTable(
  'client_channels',
  {
    id: id(),
    userId: userId(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    bufferChannelId: text('buffer_channel_id').notNull(),
    /** Buffer's service name: instagram, linkedin, facebook … */
    service: text('service').notNull(),
    name: text('name').notNull(),
    /** ISO weekdays to post on; empty means Buffer's own queue. */
    days: smallint('days').array().notNull().default(sql`ARRAY[]::smallint[]`),
    /** Local time in the user's time zone. */
    postTime: time('post_time').notNull().default('10:00'),
    ...timestamps,
  },
  (table) => [uniqueIndex('client_channels_unique').on(table.clientId, table.bufferChannelId), index('client_channels_user_idx').on(table.userId)],
);

export const contentPosts = pgTable(
  'content_posts',
  {
    id: id(),
    userId: userId(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    channelId: integer('channel_id')
      .notNull()
      .references(() => clientChannels.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    mediaUrl: text('media_url'),
    mediaSource: contentMediaSource('media_source').notNull().default('none'),
    /** Why this post exists, shown with the approval ("Je rondde de website af"). */
    reason: text('reason'),
    /** Planned moment in UTC; null means Buffer's queue picks the slot. */
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: contentPostStatus('status').notNull().default('pending_approval'),
    bufferPostId: text('buffer_post_id'),
    error: text('error'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('content_posts_user_status_idx').on(table.userId, table.status)],
);

/** Image proposals for a post (step C4): every source tried, one of them chosen. */
export const contentPostImages = pgTable(
  'content_post_images',
  {
    id: id(),
    userId: userId(),
    postId: integer('post_id')
      .notNull()
      .references(() => contentPosts.id, { onDelete: 'cascade' }),
    source: contentMediaSource('source').notNull(),
    /** Our own copy under /media, once chosen or made; external for memes. */
    url: text('url'),
    /** Where it came from before it was copied, e.g. the Pexels file. */
    sourceUrl: text('source_url'),
    /** The search term, AI prompt or instruction that produced it. */
    prompt: text('prompt'),
    /** "Foto: Naam via Pexels", shown with the proposal. */
    credit: text('credit'),
    creditUrl: text('credit_url'),
    costCents: integer('cost_cents').notNull().default(0),
    chosen: boolean('chosen').notNull().default(false),
    /** Already shown to the user; "Ander voorstel" skips it. */
    shown: boolean('shown').notNull().default(false),
    ...timestamps,
  },
  (table) => [index('content_post_images_post_idx').on(table.postId)],
);
