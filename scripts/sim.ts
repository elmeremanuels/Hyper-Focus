// Terminal chat through the same router as WhatsApp (BOUWPLAN.md, 15).
// Usage: npm run sim [-- --phone +31600000000]
// Uses the database when DATABASE_URL is set; otherwise runs with example tasks in memory.
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { getEnv } from '../src/config/env.js';
import { ConsoleChannel } from '../src/channels/console/channel.js';
import { createDbRouterDeps, createMemoryRouterDeps } from '../src/conversation/deps.js';
import { createRouter } from '../src/conversation/router.js';
import type { InboundMessage } from '../src/conversation/types.js';
import { connect, type DbConnection } from '../src/db/client.js';
import example from '../src/db/seed/example.js';

const { values } = parseArgs({
  options: { phone: { type: 'string', default: example.user.phoneE164 } },
});
const phone = values.phone;

const env = getEnv();
let connection: DbConnection | undefined;
if (env.DATABASE_URL) {
  connection = connect(env.DATABASE_URL);
}

const deps = connection
  ? createDbRouterDeps(connection.db)
  : createMemoryRouterDeps(example.user.name, [
      { id: 1, title: 'Factuur september versturen', estimatedMinutes: 5, projectTitle: 'Losse taken' },
      { id: 2, title: 'Offerte bakkerij afmaken', estimatedMinutes: 60, projectTitle: 'Website bakkerij' },
    ]);

const router = createRouter(deps);
const channel = new ConsoleChannel();

console.log(
  `Hyper&Focus simulator · ${phone} · ${connection ? 'database' : 'zonder database'}\n` +
    'Typ een bericht, een cijfer om op een knop te tikken, of "stop".',
);

const rl = readline.createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
rl.setPrompt('\nJij: ');
rl.prompt();

// Handle lines one at a time so replies stay in order, also with piped input.
let queue = Promise.resolve();
rl.on('line', (line) => {
  queue = queue.then(async () => {
    const input = line.trim();
    if (input === '') {
      rl.prompt();
      return;
    }
    if (input === 'stop') {
      rl.close();
      return;
    }

    const button = channel.buttonForInput(input);
    const message: InboundMessage = button
      ? { kind: 'button', from: phone, buttonId: button.id, title: button.title }
      : { kind: 'text', from: phone, text: input };
    if (!process.stdin.isTTY) {
      console.log(`\nJij: ${button ? `[${button.title}]` : input}`);
    }

    try {
      for (const reply of await router(message)) {
        await channel.send(phone, reply);
      }
    } catch (error) {
      console.error('Router error:', error);
    }
    rl.prompt();
  });
});

rl.on('close', () => {
  void queue.then(async () => {
    await connection?.close();
    console.log('\nTot later.');
  });
});
