// The form on the website (step 2b.3): POST /wachtlijst on the main host. Checks the address
// and the consent box, drops bots (a hidden field) and floods (5 per hour per address and
// per IP), then asks Brevo for the double opt-in mail. Mail addresses are never logged.
import express, { Router } from 'express';

export interface WaitlistConfig {
  /** The hostname of APP_BASE_URL. */
  host: string;
  /** Sends the confirmation mail; undefined while Brevo is not set up. */
  signup: ((email: string) => Promise<void>) | undefined;
  now?: () => Date;
}

export const WAITLIST_PAGES = { sent: '/wachtlijst/bijna', failed: '/wachtlijst/fout', confirmed: '/wachtlijst/bevestigd' } as const;
const PER_HOUR = 5;
const HOUR_MS = 3_600_000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function createWaitlistRouter(config: WaitlistConfig): Router {
  const router = Router();
  const now = config.now ?? (() => new Date());
  const recent = new Map<string, number[]>();
  /** True when this key was used too often in the last hour; counts this use. */
  const flooded = (key: string) => {
    const t = now().getTime();
    const hits = (recent.get(key) ?? []).filter((at) => t - at < HOUR_MS);
    hits.push(t);
    recent.set(key, hits);
    if (recent.size > 10_000) recent.clear();
    return hits.length > PER_HOUR;
  };

  router.post('/wachtlijst', express.urlencoded({ extended: false, limit: '2kb' }), async (req, res) => {
    if (req.hostname !== config.host) return void res.status(404).end();
    const body = req.body as { email?: unknown; toestemming?: unknown; website?: unknown };
    const email = String(body.email ?? '').trim().toLowerCase();
    // A filled hidden field is a bot: it gets the normal answer and nothing happens.
    if (String(body.website ?? '') !== '') return void res.redirect(303, WAITLIST_PAGES.sent);
    if (!EMAIL.test(email) || email.length > 254 || body.toestemming !== 'ja') return void res.redirect(303, WAITLIST_PAGES.failed);
    if (flooded(`ip:${req.ip ?? ''}`) || flooded(`mail:${email}`)) return void res.redirect(303, WAITLIST_PAGES.sent);
    if (!config.signup) {
      console.warn('Waiting list: Brevo is not set up (BREVO_API_KEY, BREVO_WAITLIST_LIST_ID, BREVO_DOI_TEMPLATE_ID)');
      return void res.redirect(303, WAITLIST_PAGES.failed);
    }
    try {
      await config.signup(email);
      res.redirect(303, WAITLIST_PAGES.sent);
    } catch (error) {
      console.error('Waiting list signup failed:', error instanceof Error ? error.message : error);
      res.redirect(303, WAITLIST_PAGES.failed);
    }
  });
  return router;
}
