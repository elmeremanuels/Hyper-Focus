// Screenshots of the dashboard for the website (step 2b.2): npm run site:shots
// Recreates the demo account (fictional, src/db/seed/demo.ts) with the clock at 11:15 today,
// so the window, the focus log and the battery show. Writes JPEGs to site/public/img.
// Needs DATABASE_URL, a built dashboard (npm run build) and Playwright with Chromium; set
// PLAYWRIGHT_MODULE and PLAYWRIGHT_CHROMIUM when they are not in the default places.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createApp } from '../src/app.js';
import { getEnv } from '../src/config/env.js';
import { connect } from '../src/db/client.js';
import demo from '../src/db/seed/demo.js';
import { removeDemo, seedDemoWeek } from '../src/demo/week.js';
import { localDate, localTimeOnDate } from '../src/lib/time.js';
import { createSession } from '../src/web/auth/sessions.js';

interface Page {
  goto(url: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  getByText(text: string, options: { exact: boolean }): { locator(selector: string): { first(): { click(): Promise<void> } } };
  locator(selector: string): { first(): { fill(value: string): Promise<void> } };
  screenshot(options: { path: string; type: 'jpeg'; quality: number }): Promise<unknown>;
  on(event: 'pageerror', handler: (error: Error) => void): void;
}

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright') as {
  chromium: { launch(options: { executablePath?: string }): Promise<{ newContext(options: object): Promise<{ addCookies(c: object[]): Promise<void>; newPage(): Promise<Page>; close(): Promise<void> }>; close(): Promise<void> }> };
};

const OUT = resolve('site/public/img');
const HOST = '127.0.0.1';
const env = getEnv();
const connection = connect(env.DATABASE_URL);
const db = connection.db;
const timezone = demo.seed.user.timezone ?? 'Europe/Amsterdam';
const clock = localTimeOnDate(timezone, localDate(timezone, new Date()), '11:15');
const now = () => clock;

// A fixed proposal for the assistant, so no API key is needed.
const claude = {
  callWithTools: async () => {
    const input = {
      reply: 'Ik zie twee taken, een notitie en een idee.',
      items: [
        { kind: 'task', title: 'Offerte etiketten sturen aan Lisa', estimated_minutes: 30, client_name: 'Koffiebranderij Bonen' },
        { kind: 'task', title: 'Homepage-foto’s kiezen met Daan', estimated_minutes: 15, client_name: 'Studio Linnen' },
        { kind: 'note', note: 'Ilse wil de menukaart ook als poster.', client_name: 'Fietscafé De Ketting' },
        { kind: 'idea', text: 'Een mini-cursus huisstijl voor starters' },
      ],
    };
    const call = { type: 'tool_use', id: 'shot', name: 'propose_items', input };
    return { text: '', toolCalls: [call], stopReason: 'tool_use', message: { content: [call] } } as never;
  },
};

await removeDemo(db, demo.seed.user.email);
const { userId } = await seedDemoWeek(db, demo, clock);
const { token } = await createSession(db, userId, clock);
const app = createApp({
  dashboardApi: { db, botToken: undefined, now },
  dashboard: { db, dashboardBaseUrl: `http://${HOST}`, claude, now },
  dashboardWeb: { dir: resolve('dist/web'), host: HOST },
  reward: { db, botToken: undefined },
});
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
const base = `http://${HOST}:${port}`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM === '' ? {} : { executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' });
const errors: string[] = [];
async function shoot(name: string, viewport: { width: number; height: number }, scale: number, steps: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
  await context.addCookies([{ name: 'hf_session', value: token, domain: HOST, path: '/' }]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await steps(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 });
  await context.close();
  console.log(`site/public/img/${name}.jpg`);
}
const click = (page: Page, text: string) => page.getByText(text, { exact: true }).locator('visible=true').first().click();

try {
  const desktop = { width: 1280, height: 800 };
  await shoot('vandaag', desktop, 1.5, (page) => page.goto(`${base}/`).then(() => page.waitForTimeout(1200)));
  await shoot('projecten', desktop, 1.5, (page) => page.goto(`${base}/projecten`).then(() => page.waitForTimeout(1200)));
  await shoot('braindump', { width: 390, height: 844 }, 2, async (page) => {
    await page.goto(`${base}/projecten`);
    await page.waitForTimeout(1200);
    await click(page, 'Braindump');
    await page.locator('textarea:visible').first().fill('etiketten offerte naar lisa. foto’s homepage met daan. ilse: menukaart ook als poster. ooit mini-cursus');
    await click(page, 'Ordenen');
    await page.waitForTimeout(800);
  });
} finally {
  await browser.close();
  server.close();
  await removeDemo(db, demo.seed.user.email);
  await connection.close();
}
if (errors.length) {
  console.error('Errors on the page:', errors);
  process.exitCode = 1;
}
