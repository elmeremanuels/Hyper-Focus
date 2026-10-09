// Simple router for step 0.5. Step 1.2 replaces the text branch with Claude and tools
// and adds the full button handling (BOUWPLAN.md, 10.1).
import type { Button, InboundMessage, OutboundMessage } from './types.js';

export interface OpenTask {
  id: number;
  title: string;
  estimatedMinutes: number | null;
  projectTitle: string;
}

export interface RouterDeps {
  /** The user's name, or undefined for an unknown user. */
  findUserName(userId: number): Promise<string | undefined>;
  /** Up to `limit` open tasks, most important first. */
  listOpenTasks(userId: number, limit: number): Promise<OpenTask[]>;
}

export type Router = (message: InboundMessage) => Promise<OutboundMessage[]>;

const SHOW_TODAY: Button = { id: 'f:show', title: 'Laat zien' };
const HELP: Button = { id: 'help', title: 'Wat kan ik?' };

const TODAY_WORDS = /\b(vandaag|focus|taken|wat staat er)\b/i;
const HELP_WORDS = /\b(help|hulp|wat kan)\b/i;
const GREETING_WORDS = /^\s*(hoi|hallo|hey|goedemorgen|goedemiddag|goedenavond)\b/i;

export function createRouter(deps: RouterDeps): Router {
  const showToday = async (userId: number): Promise<OutboundMessage> => {
    const tasks = await deps.listOpenTasks(userId, 3);
    if (tasks.length === 0) {
      return { text: 'Er staat niets open. Stuur me een taak, dan zet ik hem klaar.' };
    }
    const lines = tasks.map((task, index) => {
      const minutes = task.estimatedMinutes ? ` · ${task.estimatedMinutes} min` : '';
      return `${index + 1}. ${task.title}${minutes}`;
    });
    return {
      text: `Vandaag, in deze volgorde:\n${lines.join('\n')}\nWaar begin je mee?`,
      buttons: tasks.map((task, index) => ({
        id: `t:${task.id}:start`,
        title: `Start ${index + 1}`,
      })),
    };
  };

  const help: OutboundMessage = {
    text: 'Stuur "vandaag" voor je focus. Tik op Start om met een taak te beginnen.',
    buttons: [SHOW_TODAY],
  };

  return async (message) => {
    const name = await deps.findUserName(message.userId);
    if (name === undefined) {
      return [{ text: 'Je account ken ik nog niet.' }];
    }

    if (message.kind === 'button') {
      if (message.buttonId === SHOW_TODAY.id) return [await showToday(message.userId)];
      if (message.buttonId === HELP.id) return [help];
      const start = /^t:(\d+):start$/.exec(message.buttonId);
      if (start) {
        return [{ text: 'Top, succes. Stuur "vandaag" als je verder wilt.' }];
      }
      return [{ text: 'Die knop ken ik nog niet.', buttons: [HELP] }];
    }

    const text = message.text.trim();
    if (TODAY_WORDS.test(text)) return [await showToday(message.userId)];
    if (HELP_WORDS.test(text)) return [help];
    if (GREETING_WORDS.test(text)) {
      return [
        { text: `Hoi ${name}. Zal ik je focus voor vandaag laten zien?`, buttons: [SHOW_TODAY, HELP] },
      ];
    }
    return [
      {
        text: 'Losse berichten vastleggen kan ik nog niet. Wil je je focus zien?',
        buttons: [SHOW_TODAY, HELP],
      },
    ];
  };
}
