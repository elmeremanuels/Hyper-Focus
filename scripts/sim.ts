// Terminal chat through the same router as Telegram and mail (BOUWPLAN.md, 15).
// Usage: npm run sim [-- --email sam@voorbeeld.invalid]
// Uses the database when DATABASE_URL is set; otherwise runs with example tasks in memory.
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { getEnv } from '../src/config/env.js';
import { ConsoleChannel } from '../src/channels/console/channel.js';
import { createAssistantRouter } from '../src/conversation/assistant.js';
import { createMemoryRouterDeps } from '../src/conversation/deps.js';
import { createRouter } from '../src/conversation/router.js';
import type { InboundMessage } from '../src/conversation/types.js';
import { createDbUserStore } from '../src/core/users.js';
import { connect, type DbConnection } from '../src/db/client.js';
import example from '../src/db/seed/example.js';
import { buildClaude } from '../src/wiring.js';

const { values } = parseArgs({
  options: { email: { type: 'string', default: example.user.email } },
});
const email = values.email;

const env = getEnv();
let connection: DbConnection | undefined;
let userId = 1;
if (env.DATABASE_URL) {
  connection = connect(env.DATABASE_URL);
  const user = await createDbUserStore(connection.db).findByEmail(email);
  if (!user) {
    console.error(`No user with mail address ${email}. Run npm run db:seed first.`);
    await connection.close();
    process.exit(1);
  }
  userId = user.id;
}

// With a database the simulator runs the real assistant (Claude when ANTHROPIC_API_KEY is set);
// without one, the keyword router with example tasks.
const claude = connection ? buildClaude(env, connection.db) : undefined;
const router = connection
  ? createAssistantRouter({ db: connection.db, claude })
  : createRouter(
      createMemoryRouterDeps(example.user.name, [
        { id: 1, title: 'Factuur september versturen', estimatedMinutes: 5, projectTitle: 'Losse taken' },
        { id: 2, title: 'Offerte bakkerij afmaken', estimatedMinutes: 60, projectTitle: 'Website bakkerij' },
      ]),
    );
const channel = new ConsoleChannel();

console.log(
  `Hyper&Focus simulator · ${email} · ${connection ? 'database' : 'zonder database'}` +
    `${connection ? (claude ? ' · Claude' : ' · zonder Claude') : ''}\n` +
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
      ? { kind: 'button', userId, buttonId: button.id, title: button.title, source: 'telegram' }
      : { kind: 'text', userId, text: input, source: 'telegram' };
    if (!process.stdin.isTTY) {
      console.log(`\nJij: ${button ? `[${button.title}]` : input}`);
    }

    try {
      for (const reply of await router(message)) {
        await channel.send(reply);
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
