import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createMailProcessor } from '../src/channels/email/processor.js';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { getState } from '../src/conversation/state.js';
import { runTool, CORE_TOOLS } from '../src/conversation/tools.js';
import { createDbMessageStore } from '../src/core/messages.js';
import { createDbUserStore } from '../src/core/users.js';
import { dailyFocus, ideas, projects, scheduledNudges, tasks, users } from '../src/db/schema/index.js';
import { planDay } from '../src/proactive/planner.js';
import { sendDueNudges } from '../src/proactive/sender.js';
import { scriptedClaude } from './helpers/claude.js';
import { fakeDelivery } from './helpers/delivery.js';
import { fixture } from './helpers/fixtures.js';
import { adminUrl, useTestDatabase } from './helpers/testdb.js';

// The weekly review falls at the end of the last work day: Friday 17:00 in Amsterdam (step 1.12).
const FRIDAY_END = new Date('2026-10-09T15:00:00Z');
const MONDAY_MAIL = new Date('2026-10-12T06:00:30Z'); // just after 08:00

describe.skipIf(!adminUrl)('ideas, weekly review and weekly mail (integration)', () => {
  const t = useTestDatabase();
  const db = () => t.connection.db;
  const tool = (name: string, input: object) =>
    runTool(CORE_TOOLS, name, input, { db: db(), userId: t.userId, timezone: 'Europe/Amsterdam', now: FRIDAY_END, source: 'telegram' });

  it('never puts ideas in the focus', async () => {
    await tool('add_idea', { text: 'Workshop websites voor bakkers' });
    await tool('add_idea', { text: 'Podcast met klanten' });
    await planDay(db(), t.userId, 'Europe/Amsterdam', new Date('2026-10-08T22:06:00Z'));
    const [focus] = await db().select().from(dailyFocus).where(eq(dailyFocus.localDate, '2026-10-09'));
    const titles = await Promise.all(
      (focus?.taskIds ?? []).map(async (id) => (await db().select().from(tasks).where(eq(tasks.id, id)))[0]?.title),
    );
    expect(titles.length).toBeGreaterThan(0);
    for (const idea of await db().select().from(ideas)) expect(titles).not.toContain(idea.text);
    expect(await db().select().from(tasks).where(eq(tasks.title, 'Podcast met klanten'))).toHaveLength(0);
  });

  it('runs the weekly review in three taps', async () => {
    const reviews = await db()
      .select()
      .from(scheduledNudges)
      .where(and(eq(scheduledNudges.userId, t.userId), eq(scheduledNudges.kind, 'weekly_review')));
    expect(reviews.map((n) => [n.scheduledForUtc.toISOString(), n.payload.part])).toEqual([['2026-10-09T15:00:00.000Z', 'review']]);

    await db().update(users).set({ telegramChatId: 99 }).where(eq(users.id, t.userId));
    const { delivery, telegram } = fakeDelivery(createDbMessageStore(db()));
    // The day review at 16:00 comes first; the weekly review at the end of the work day.
    await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()) }, new Date('2026-10-09T14:00:30Z'));
    await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()) }, new Date('2026-10-09T15:00:30Z'));
    const opening = telegram.sent().at(-1)?.body;
    expect(opening?.text).toMatch(/^Weekreview, drie tikken\..*\nWat ging goed\?/s);

    const router = createAssistantRouter({ db: db(), claude: scriptedClaude([]), now: () => FRIDAY_END });
    const tap = (id: string) => router({ kind: 'button', userId: t.userId, buttonId: id, title: id });

    const [step2] = await tap('wr:good:focus'); // tap 1
    expect(step2?.text).toBe('Mooi. Welk project krijgt volgende week voorrang?');
    const boho = step2?.choices?.find((c) => c.title === 'Nieuwsbrief Boho');
    expect(boho).toBeDefined();

    const [step3] = await tap(boho!.id); // tap 2
    expect(step3?.text).toBe('Nieuwsbrief Boho krijgt voorrang. In je ideeënbak staan 3 ideeën. Eén promoveren tot project, of laten staan?');
    const focusProjects = await db().select().from(projects).where(eq(projects.isWeeklyFocus, true));
    expect(focusProjects.map((p) => p.title)).toEqual(['Nieuwsbrief Boho']);

    const podcast = step3?.choices?.find((c) => c.title.startsWith('Podcast met'));
    const [done] = await tap(podcast!.id); // tap 3
    expect(done?.text).toBe('"Podcast met klanten" is nu een project. De weekreview is klaar. Fijne week.');
    const [idea] = await db().select().from(ideas).where(eq(ideas.text, 'Podcast met klanten'));
    expect(idea?.status).toBe('promoted');
    expect((await getState(db(), t.userId, FRIDAY_END)).mode).toBe('idle');
  });

  it('accepts a few words at the first step', async () => {
    const claude = scriptedClaude([]);
    const router = createAssistantRouter({ db: db(), claude, now: () => FRIDAY_END });
    await router({ kind: 'text', userId: t.userId, text: 'weekreview' });
    const [next] = await router({ kind: 'text', userId: t.userId, text: 'de offerte is eindelijk de deur uit' });
    expect(next?.text).toBe('Dank je. Welk project krijgt volgende week voorrang?');
    expect(claude.callWithTools).not.toHaveBeenCalled();
  });

  it('sends the Monday overview by mail only', async () => {
    await planDay(db(), t.userId, 'Europe/Amsterdam', new Date('2026-10-11T22:06:00Z'));
    const { delivery, telegram, brevo } = fakeDelivery(createDbMessageStore(db()));
    const before = telegram.sent().length;
    await sendDueNudges({ db: db(), delivery, users: createDbUserStore(db()) }, MONDAY_MAIL);

    const mail = brevo.sent.at(-1)?.body;
    expect(mail?.subject).toBe('Je week bij Hyper&Focus');
    expect(mail?.textContent).toContain('Deze week krijgt Nieuwsbrief Boho voorrang.');
    expect(telegram.sent()).toHaveLength(before);
  });

  it('turns a forwarded mail into a task under the right client', async () => {
    const claude = scriptedClaude([
      { tools: [{ name: 'add_task', input: { title: 'Banner maken voor vrijdag', estimated_minutes: 30, client_name: 'Bakkerij De Vries', due_date: '2026-10-03' } }] },
      { text: 'Staat erin bij Bakkerij De Vries, deadline vrijdag.' },
    ]);
    const store = createDbMessageStore(db());
    const { delivery, brevo } = fakeDelivery(store);
    const process = createMailProcessor({
      users: createDbUserStore(db()),
      messages: store,
      delivery,
      router: createAssistantRouter({ db: db(), claude }),
      allowedSenders: ['sam@voorbeeld.invalid'],
      log: { info: () => undefined, warn: () => undefined, error: console.error },
    });

    expect(await process(fixture('mail', 'forward'))).toBe('processed');
    const sentToClaude = String(claude.callWithTools.mock.calls[0]![0].messages[0]!.content);
    expect(sentToClaude).toContain('Doorgestuurde mail van Anna <anna@bakkerij.invalid>');

    const [task] = await db().select().from(tasks).where(eq(tasks.title, 'Banner maken voor vrijdag'));
    const [project] = await db().select().from(projects).where(eq(projects.id, task!.projectId));
    expect(project?.title).toBe('Website bakkerij');
    expect(task?.source).toBe('email');
    expect(brevo.sent.at(-1)?.body.textContent).toContain('Staat erin bij Bakkerij De Vries');
  });
});
