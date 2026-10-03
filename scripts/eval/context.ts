// Fixed context for the evaluation set: the example seed on Wednesday 7 October 2026, 10:30.
// The eval never touches the database, so these ids only have to be consistent here.
import type { ContextData, ContextTask } from '../../src/conversation/context.js';

export const EVAL_NOW = new Date('2026-10-07T08:30:00Z');

const task = (
  id: number,
  title: string,
  projectTitle: string,
  clientName: string | null,
  estimatedMinutes: number,
  status = 'open',
): ContextTask => ({ id, title, projectTitle, clientName, estimatedMinutes, dueDate: null, status });

const offerte = task(11, 'Offerte bakkerij afmaken', 'Website bakkerij', 'Bakkerij De Vries', 60, 'in_progress');
const banner = task(12, 'Banner voor de feestdagen', 'Website bakkerij', 'Bakkerij De Vries', 30);
const onderwerp = task(13, 'Onderwerpregels nieuwsbrief kiezen', 'Nieuwsbrief Boho', 'Boho Interieur', 15);
const openingstijden = task(14, 'Openingstijden op de site bijwerken', 'Onderhoud Fietsenmaker Jansen', 'Fietsenmaker Jansen', 5);
const factuur = task(15, 'Factuur september versturen', 'Losse taken', null, 5);

/** Client name → the project a task for that client belongs to. */
export const CLIENT_PROJECTS: Record<string, number> = {
  'Bakkerij De Vries': 1,
  'Boho Interieur': 2,
  'Fietsenmaker Jansen': 3,
};

export const EVAL_CONTEXT: ContextData = {
  name: 'Sam',
  businessName: 'Studio Voorbeeld',
  timezone: 'Europe/Amsterdam',
  localTime: 'woensdag 7 oktober 2026, 10:30',
  today: '2026-10-07',
  settings: { morningTime: '08:30', wrapupTime: '16:00', sessionMinutes: 25, pausedUntil: null },
  focus: [offerte, onderwerp, factuur],
  openTasks: [offerte, banner, onderwerp, openingstijden, factuur],
  projects: [
    { id: 1, title: 'Website bakkerij', clientName: 'Bakkerij De Vries' },
    { id: 2, title: 'Nieuwsbrief Boho', clientName: 'Boho Interieur' },
    { id: 3, title: 'Onderhoud Fietsenmaker Jansen', clientName: 'Fietsenmaker Jansen' },
    { id: 4, title: 'Losse taken', clientName: null },
  ],
  clients: ['Bakkerij De Vries (Anna)', 'Boho Interieur (Mo)', 'Fietsenmaker Jansen (Kees)'],
  suggestions: [{ id: 3, title: 'Knop "Kom proeven" op de homepage van de bakkerij', status: 'in_progress' }],
  session: null,
  recentMessages: [
    { direction: 'out', body: 'Vandaag, in deze volgorde:\n1. Offerte bakkerij afmaken · 60 min\n2. Onderwerpregels nieuwsbrief kiezen · 15 min\n3. Factuur september versturen · 5 min\nWaar begin je mee?' },
    { direction: 'in', body: 'de offerte loopt al, die pak ik vanmiddag verder' },
    { direction: 'out', body: 'Prima. Zullen we nu de banner voor de feestdagen doen? Dat is 30 minuten.' },
  ],
};
