import { describe, expect, it } from 'vitest';
import { parseButtonId } from '../src/conversation/buttons.js';
import { coveredDates, slotsFor } from '../src/content/planner.js';
import { describeSlot, nextSlot } from '../src/content/posts.js';
import { checkGuardrails } from '../src/proactive/guardrails.js';
import { BufferClient, BufferError } from '../src/integrations/buffer/client.js';

describe('nextSlot: the next moment from the rhythm', () => {
  it('takes the next chosen weekday at the local time (Europe/Amsterdam)', () => {
    const monday = new Date('2026-10-12T07:00:00Z'); // 09:00
    expect(nextSlot([2, 4], '10:00', 'Europe/Amsterdam', monday)).toEqual(new Date('2026-10-13T08:00:00Z'));
    // Today still counts when there is a quarter of an hour left.
    expect(nextSlot([1], '09:30', 'Europe/Amsterdam', monday)).toEqual(new Date('2026-10-12T07:30:00Z'));
    expect(nextSlot([1], '09:10', 'Europe/Amsterdam', monday)).toEqual(new Date('2026-10-19T07:10:00Z'));
  });

  it('follows the clock change on 25 October', () => {
    const saturday = new Date('2026-10-24T12:00:00Z');
    // Sunday 10:00 is already winter time: UTC+1.
    expect(nextSlot([7], '10:00', 'Europe/Amsterdam', saturday)).toEqual(new Date('2026-10-25T09:00:00Z'));
  });

  it('works in Asia/Makassar', () => {
    const at = new Date('2026-10-12T07:00:00Z'); // Monday 15:00 WITA
    expect(nextSlot([1, 3], '08:00', 'Asia/Makassar', at)).toEqual(new Date('2026-10-14T00:00:00Z'));
    expect(describeSlot('Asia/Makassar', new Date('2026-10-14T00:00:00Z'))).toBe('woensdag 14 okt 08:00');
  });

  it('gives null without days: Buffer picks the slot', () => {
    expect(nextSlot([], '10:00', 'Europe/Amsterdam', new Date())).toBeNull();
  });
});

describe('approval buttons', () => {
  it('parses cp:{id}:ok|edit|skip', () => {
    expect(parseButtonId('cp:12:ok')).toEqual({ kind: 'post', postId: 12, action: 'ok' });
    expect(parseButtonId('cp:12:edit')).toEqual({ kind: 'post', postId: 12, action: 'edit' });
    expect(parseButtonId('cp:12:drop')).toBeUndefined();
  });
});

describe('BufferClient (GraphQL)', () => {
  const calls: Array<{ auth: string; query: string; variables: Record<string, unknown> }> = [];
  const respond = (handler: (query: string, variables: Record<string, unknown>) => unknown, status = 200) =>
    (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
      calls.push({ auth: (init.headers as Record<string, string>).authorization ?? '', query: body.query, variables: body.variables });
      return new Response(JSON.stringify(handler(body.query, body.variables)), { status });
    }) as unknown as typeof fetch;

  it('lists connected channels of every organization', async () => {
    calls.length = 0;
    const client = new BufferClient(
      'key-1',
      respond((query) =>
        query.includes('organizations')
          ? { data: { account: { organizations: [{ id: 'org1', name: 'Studio Rust' }] } } }
          : { data: { channels: [{ id: 'c1', name: 'hodr', displayName: 'studiorust', service: 'instagram', isDisconnected: false }, { id: 'c2', name: 'old', displayName: null, service: 'facebook', isDisconnected: true }] } },
      ),
    );
    expect(await client.listChannels()).toEqual([{ id: 'c1', name: 'studiorust', service: 'instagram', organization: 'Studio Rust' }]);
    expect(calls[0]?.auth).toBe('Bearer key-1');
    expect(calls[1]?.variables).toEqual({ org: 'org1' });
  });

  it('schedules a post at a fixed time, with Instagram metadata and an image', async () => {
    calls.length = 0;
    const client = new BufferClient('key-1', respond(() => ({ data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'p1', status: 'scheduled', dueAt: '2026-10-13T08:00:00.000Z', error: null } } } })));
    const post = await client.createPost({ channelId: 'c1', service: 'instagram', text: 'Hoi', dueAt: new Date('2026-10-13T08:00:00Z'), imageUrl: 'https://hyper-focus.pro/media/a.jpg' });
    expect(post).toEqual({ id: 'p1', status: 'scheduled', dueAt: '2026-10-13T08:00:00.000Z', error: null });
    expect(calls[0]?.variables).toEqual({
      input: {
        channelId: 'c1',
        text: 'Hoi',
        schedulingType: 'automatic',
        mode: 'customScheduled',
        dueAt: '2026-10-13T08:00:00.000Z',
        assets: [{ image: { url: 'https://hyper-focus.pro/media/a.jpg' } }],
        metadata: { instagram: { type: 'post', shouldShareToFeed: true } },
        source: 'hyperfocus',
      },
    });
  });

  it('uses the queue without a time, and turns error payloads into BufferError', async () => {
    calls.length = 0;
    const client = new BufferClient('key-1', respond(() => ({ data: { createPost: { __typename: 'LimitReachedError', message: 'Queue is full' } } })));
    const error = await client.createPost({ channelId: 'c1', service: 'linkedin', text: 'Hoi' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BufferError);
    expect(error).toMatchObject({ message: 'Queue is full', kind: 'limit' });
    expect(calls[0]?.variables).toMatchObject({ input: { mode: 'addToQueue' } });
    expect((calls[0]?.variables.input as Record<string, unknown>).dueAt).toBeUndefined();
  });

  it('reports a bad key as auth', async () => {
    const client = new BufferClient('bad', respond(() => ({ error: 'nope' }), 401));
    await expect(client.listChannels()).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('the afternoon bundle (step C2)', () => {
  it('covers tomorrow up to the next work day', () => {
    const at = (iso: string) => new Date(iso);
    expect(coveredDates([1, 2, 3, 4, 5], 'Europe/Amsterdam', at('2026-10-12T15:00:00Z'))).toEqual(['2026-10-13']);
    // Friday: the weekend and Monday.
    expect(coveredDates([1, 2, 3, 4, 5], 'Europe/Amsterdam', at('2026-10-16T15:00:00Z'))).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
    // Monday, Wednesday and Thursday work days, in Makassar.
    expect(coveredDates([1, 3, 4], 'Asia/Makassar', at('2026-10-12T09:00:00Z'))).toEqual(['2026-10-13', '2026-10-14']);
  });

  it('turns the rhythm into moments, and leaves queue channels out', () => {
    const channel = (id: number, days: number[], postTime: string) =>
      ({ id, userId: 1, clientId: 1, bufferChannelId: `c${id}`, service: 'instagram', name: 'x', days, postTime, createdAt: new Date(), updatedAt: new Date() });
    const slots = slotsFor([channel(1, [6, 1], '09:00:00'), channel(2, [], '10:00:00'), channel(3, [7], '20:00:00')], ['2026-10-17', '2026-10-18', '2026-10-19'], 'Europe/Amsterdam', new Date('2026-10-16T15:00:00Z'));
    expect(slots.map((s) => [s.channel.id, s.dueAt.toISOString()])).toEqual([
      [1, '2026-10-17T07:00:00.000Z'],
      [3, '2026-10-18T18:00:00.000Z'],
      [1, '2026-10-19T07:00:00.000Z'],
    ]);
  });

  it('lets the bundle through the daily limit, and still honours quiet hours and pause', () => {
    const base = {
      now: new Date('2026-10-12T15:00:00Z'),
      timezone: 'Europe/Amsterdam',
      settings: { pausedUntil: null, quietStart: '21:00', quietEnd: '08:00', maxProactivePerDay: 4 },
      sentToday: 4,
      lastProactiveAt: new Date('2026-10-12T14:50:00Z'),
      silentDays: 0,
      overwhelmedYesterday: false,
    };
    expect(checkGuardrails({ ...base, kind: 'content_bundle' })).toEqual({ send: true });
    expect(checkGuardrails({ ...base, kind: 'content_reminder', now: new Date('2026-10-12T20:00:00Z') })).toMatchObject({ send: false, reason: 'quiet_hours' });
    expect(checkGuardrails({ ...base, kind: 'content_bundle', settings: { ...base.settings, pausedUntil: new Date('2026-10-13T00:00:00Z') } })).toMatchObject({ send: false, reason: 'paused' });
  });

  it('parses "Alles goed"', () => {
    expect(parseButtonId('cpb:all')).toEqual({ kind: 'posts', action: 'all' });
  });
});
