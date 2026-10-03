// Shared bits of the dashboard API (fase 2a): the session check, the user's context, JSON only.
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ButtonContext } from '../../conversation/buttons.js';
import { getProfile } from '../../core/profile.js';
import type { Database } from '../../db/client.js';
import type { CalendarService } from '../../integrations/calendar/service.js';
import { LOGIN_TEXTS } from '../../texts/dashboard.nl.js';

export interface DashboardRoutesConfig {
  db: Database;
  dashboardBaseUrl: string;
  /** For the connect link and revoking access; the calendar settings show "not available" without it. */
  calendar?: CalendarService | undefined;
  now?: () => Date;
}

/** The context the conversation code expects, for the logged-in user. */
export async function userContext(config: DashboardRoutesConfig, res: Response): Promise<ButtonContext & { name: string }> {
  const userId = Number(res.locals.userId);
  const profile = await getProfile(config.db, userId);
  if (!profile) throw new Error('Unknown user');
  return { db: config.db, userId, timezone: profile.timezone, now: (config.now ?? (() => new Date()))(), name: profile.name };
}

/**
 * Changes only as JSON: a cross-site form cannot send that without a CORS preflight. A DELETE
 * always needs a preflight, so it may come without a body.
 */
export function jsonOnly(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'GET' && req.method !== 'DELETE' && !req.is('application/json')) return void res.status(415).json({ error: 'JSON verwacht' });
  next();
}

export const notLoggedIn = { error: LOGIN_TEXTS.notLoggedIn };

/** Wraps an async handler so errors reach Express; a bad body is a 400. */
export const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    void fn(req, res).catch((err: unknown) => {
      if (err instanceof ZodError) return void res.status(400).json({ error: 'Ongeldige invoer' });
      next(err);
    });
