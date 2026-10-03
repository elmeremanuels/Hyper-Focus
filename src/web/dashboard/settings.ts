// Instellingen (step 2a.6): rhythm, work week, day times, quiet hours, rewards, calendar, tools,
// and export and delete (BOUWPLAN.md, 14).
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { connectUrl, disconnectCalendars } from '../../conversation/calendar.js';
import { recordEvent } from '../../core/events.js';
import { deleteUserData, exportUserData } from '../../core/privacy.js';
import { getSettings } from '../../core/settings.js';
import { listUserTools, removeUserTool, saveUserTool } from '../../core/user-tools.js';
import { rhythmProfiles, users, userSettings } from '../../db/schema/index.js';
import { PREF_WINDOWS, toMinutes } from '../../focus/window.js';
import { rhythmAccepted, setFocusPref } from '../../focus/windows.js';
import { lastWorkday, normalizeDays } from '../../focus/workweek.js';
import { listConnections } from '../../integrations/calendar/store.js';
import { catalogTool, labelFromLink, toolsFor, validateToolLink, WORK_LABELS, WORK_TYPES } from '../../tools/catalog.js';
import { clearedCookie } from '../auth/sessions.js';
import { handle, userContext, type DashboardRoutesConfig } from './common.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const WINDOW_LENGTHS = [45, 60, 90, 120] as const;
const hhmm = (value: string) => value.slice(0, 5);
const validZone = (zone: string) => DateTime.local().setZone(zone).isValid;

const settingsPatch = z
  .object({
    name: z.string().trim().min(1).max(100),
    timezone: z.string().refine(validZone),
    morningTime: time,
    middayEnabled: z.boolean(),
    wrapupTime: time,
    quietStart: time,
    quietEnd: time,
    rewardsEnabled: z.boolean(),
    meetingHeadsUp: z.boolean(),
    meetingFollowup: z.boolean(),
    workDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    workStart: time,
    workEnd: time,
  })
  .partial();

const rhythmPatch = z
  .object({
    pref: z.enum(['morning', 'afternoon', 'evening', 'unknown']),
    /** The user's own start time; null goes back to the time of the preference. */
    start: time.nullable(),
    minutes: z.number().refine((m) => (WINDOW_LENGTHS as readonly number[]).includes(m)),
  })
  .partial();

const toolInput = z.object({ toolKey: z.string().optional(), url: z.string().max(2048).optional() });

/** The confirmation word for deleting everything; typed by hand on purpose. */
export const DELETE_CONFIRMATION = 'verwijder';

export function settingsRoutes(config: DashboardRoutesConfig): Router {
  const router = Router();

  router.get(
    '/api/settings',
    handle(async (_req, res) => {
      const { db, userId } = await userContext(config, res);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return void res.status(404).json({ error: 'Niet gevonden' });
      const s = await getSettings(db, userId);
      const learned = (await rhythmAccepted(db, userId))
        ? (await db.select().from(rhythmProfiles).where(eq(rhythmProfiles.userId, userId))).map((r) => ({ weekday: r.weekday, start: hhmm(r.windowStart) })).sort((a, b) => a.weekday - b.weekday)
        : [];
      const tools = await listUserTools(db, userId);
      const connections = await listConnections(db, userId);
      res.set('Cache-Control', 'no-store').json({
        profile: { name: user.name, email: user.email, timezone: user.timezone, telegram: user.telegramChatId !== null },
        rhythm: {
          pref: user.focusPref,
          start: user.focusWindowStart ? hhmm(user.focusWindowStart) : null,
          prefStart: PREF_WINDOWS[user.focusPref ?? 'unknown'],
          prefStarts: PREF_WINDOWS,
          minutes: user.focusWindowMinutes,
          lengths: WINDOW_LENGTHS,
          learned,
        },
        workWeek: { days: normalizeDays(s.workDays), start: hhmm(s.workStart), end: hhmm(s.workEnd), reviewDay: lastWorkday(s.workDays) },
        day: { morningTime: hhmm(s.morningTime), middayEnabled: s.middayEnabled, wrapupTime: hhmm(s.wrapupTime) },
        quiet: { start: hhmm(s.quietStart), end: hhmm(s.quietEnd) },
        rewardsEnabled: s.rewardsEnabled,
        calendar: {
          available: Boolean(config.calendar && connectUrl(config.calendar, userId, new Date())),
          connections: connections.map((c) => ({ provider: c.provider, status: c.status, lastSyncedAt: c.lastSyncedAt })),
          meetingHeadsUp: s.meetingHeadsUp,
          meetingFollowup: s.meetingFollowup,
        },
        tools: WORK_TYPES.map((workType) => {
          const current = tools.find((t) => t.workType === workType);
          return {
            workType,
            label: WORK_LABELS[workType],
            current: current ? { key: current.toolKey, label: current.label, url: current.url } : null,
            options: toolsFor(workType).map((t) => ({ key: t.key, label: t.label, needsLink: t.defaultUrl === null })),
          };
        }),
      });
    }),
  );

  router.patch(
    '/api/settings',
    handle(async (req, res) => {
      const { db, userId, now } = await userContext(config, res);
      const { name, timezone, ...patch } = settingsPatch.parse(req.body);
      const current = await getSettings(db, userId);
      const workStart = patch.workStart ?? hhmm(current.workStart);
      const workEnd = patch.workEnd ?? hhmm(current.workEnd);
      if (toMinutes(workEnd) <= toMinutes(workStart)) return void res.status(400).json({ error: 'De werkdag eindigt na het begin' });

      if (name !== undefined || timezone !== undefined) {
        await db.update(users).set({ ...(name !== undefined && { name }), ...(timezone !== undefined && { timezone }) }).where(eq(users.id, userId));
      }
      if (Object.keys(patch).length) {
        await db
          .update(userSettings)
          .set({ ...patch, ...(patch.workDays && { workDays: normalizeDays(patch.workDays) }) })
          .where(eq(userSettings.userId, userId));
      }
      if (patch.rewardsEnabled !== undefined && patch.rewardsEnabled !== current.rewardsEnabled) {
        await recordEvent(db, userId, 'rewards_toggled', { enabled: patch.rewardsEnabled }, now);
      }
      if (patch.workDays || patch.workStart || patch.workEnd) {
        await recordEvent(db, userId, 'work_week_set', { days: patch.workDays, start: patch.workStart, end: patch.workEnd, via: 'web' }, now);
      }
      res.json({ ok: true });
    }),
  );

  router.post(
    '/api/settings/rhythm',
    handle(async (req, res) => {
      const { db, userId, now } = await userContext(config, res);
      const patch = rhythmPatch.parse(req.body);
      // A preference resets the start to its own time; a start given with it wins.
      if (patch.pref) await setFocusPref(db, userId, patch.pref, now);
      if (patch.start !== undefined || patch.minutes !== undefined) {
        const [user] = await db.select({ pref: users.focusPref }).from(users).where(eq(users.id, userId));
        await db
          .update(users)
          .set({
            ...(patch.start !== undefined && { focusWindowStart: patch.start ?? PREF_WINDOWS[user?.pref ?? 'unknown'] }),
            ...(patch.minutes !== undefined && { focusWindowMinutes: patch.minutes }),
          })
          .where(eq(users.id, userId));
      }
      res.json({ ok: true });
    }),
  );

  router.post(
    '/api/settings/calendar/connect',
    handle(async (_req, res) => {
      const { userId, now } = await userContext(config, res);
      const url = config.calendar ? connectUrl(config.calendar, userId, now) : undefined;
      if (!url) return void res.status(409).json({ error: 'Agenda staat niet aan' });
      res.json({ url });
    }),
  );

  router.post(
    '/api/settings/calendar/disconnect',
    handle(async (_req, res) => {
      const { db, userId } = await userContext(config, res);
      const removed = await disconnectCalendars(db, userId, config.calendar);
      res.json({ ok: true, removed: removed.map((c) => c.provider) });
    }),
  );

  router.put(
    '/api/settings/tools/:workType',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const workType = z.enum(WORK_TYPES).safeParse(req.params.workType);
      if (!workType.success) return void res.status(404).json({ error: 'Onbekend soort werk' });
      const input = toolInput.parse(req.body);
      const tool = input.toolKey ? catalogTool(input.toolKey) : undefined;
      if (input.toolKey && (!tool || !tool.workTypes.includes(workType.data))) return void res.status(400).json({ error: 'Deze tool hoort hier niet bij' });
      const link = input.url ? validateToolLink(input.url) : (tool?.defaultUrl ?? undefined);
      if (!link) return void res.status(400).json({ error: 'Plak een link die begint met https://' });
      const label = tool?.label ?? labelFromLink(link);
      await saveUserTool(db, userId, { workType: workType.data, toolKey: tool?.key ?? 'other', label, url: link });
      res.json({ label, url: link });
    }),
  );

  router.delete(
    '/api/settings/tools/:workType',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const workType = z.enum(WORK_TYPES).safeParse(req.params.workType);
      if (!workType.success) return void res.status(404).json({ error: 'Onbekend soort werk' });
      await removeUserTool(db, userId, workType.data);
      res.json({ ok: true });
    }),
  );

  router.get(
    '/api/export',
    handle(async (_req, res) => {
      const { db, userId, timezone, now } = await userContext(config, res);
      const data = await exportUserData(db, userId, now);
      if (!data) return void res.status(404).json({ error: 'Niet gevonden' });
      const day = DateTime.fromJSDate(now, { zone: timezone }).toISODate();
      res
        .set('Cache-Control', 'no-store')
        .attachment(`hyperfocus-gegevens-${day}.json`)
        .type('application/json')
        .send(JSON.stringify(data, null, 2));
    }),
  );

  router.post(
    '/api/account/delete',
    handle(async (req, res) => {
      const { db, userId } = await userContext(config, res);
      const { confirm } = z.object({ confirm: z.string() }).parse(req.body);
      if (confirm.trim().toLowerCase() !== DELETE_CONFIRMATION) return void res.status(400).json({ error: `Typ "${DELETE_CONFIRMATION}" om te bevestigen` });
      await deleteUserData(db, userId, config.calendar);
      console.log(`Deleted user ${userId} on request`);
      res.set('Set-Cookie', clearedCookie(config.dashboardBaseUrl.startsWith('https:'))).json({ ok: true });
    }),
  );

  return router;
}

