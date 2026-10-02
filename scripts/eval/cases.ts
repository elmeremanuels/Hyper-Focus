// Evaluation set for the router (BOUWPLAN.md, 15): Dutch messages with the expected tools.
// Dates are relative to Wednesday 2026-10-07. Typos and transcription noise are on purpose.

export interface EvalCase {
  text: string;
  /** Accepted tool sets, order-insensitive. [[]] means: no tool. */
  tools: string[][];
  /** Checks on the first call of a tool. `project` accepts project_id or a matching client_name. */
  check?: {
    tool: string;
    task_id?: number;
    status?: string;
    until_date?: string;
    project?: number;
  };
}

const one = (tool: string) => [[tool]];

export const CASES: EvalCase[] = [
  // add_task, with the client's project where there is one
  { text: 'bakkerij wil een nieuwe banner voor de kerst, uiterlijk vrijdag', tools: one('add_task'), check: { tool: 'add_task', project: 1 } },
  { text: 'boho vraagt om een extra mailing in november', tools: one('add_task'), check: { tool: 'add_task', project: 2 } },
  { text: 'Kees van de fietsenmaker wil zijn prijslijst online', tools: one('add_task'), check: { tool: 'add_task', project: 3 } },
  { text: 'nog even de btw aangifte doen', tools: one('add_task') },
  { text: 'moet de bakker nog belle over de fotos voor de site', tools: one('add_task'), check: { tool: 'add_task', project: 1 } },
  { text: 'fix the contact form for boho asap', tools: one('add_task'), check: { tool: 'add_task', project: 2 } },
  { text: 'ehm ja dus voor jansen moet er eh nog een nieuwe foto van de winkel op de site', tools: one('add_task'), check: { tool: 'add_task', project: 3 } },
  { text: 'offerte maken voor een nieuwe klant, bloemenwinkel Roos', tools: one('add_task') },
  { text: 'herinner me om de domeinnaam van boho te verlengen', tools: one('add_task'), check: { tool: 'add_task', project: 2 } },
  { text: 'taak: facturen oktober klaarzetten', tools: one('add_task') },
  { text: 'kun je toevoegen: logo de vries in hogere resolutie opvragen', tools: one('add_task'), check: { tool: 'add_task', project: 1 } },
  { text: 'ik moet morgen de nieuwsbrief van boho testen op mobiel', tools: one('add_task'), check: { tool: 'add_task', project: 2 } },
  { text: 'Anna wil ook een bestelformulier voor taarten op de site', tools: one('add_task'), check: { tool: 'add_task', project: 1 } },

  // add_idea
  { text: 'idee: podcast over adhd en ondernemen', tools: one('add_idea') },
  { text: 'misschien ooit een cursus maken voor andere freelancers', tools: one('add_idea') },
  { text: 'wat als ik een abonnement voor onderhoud aanbied? gewoon een gedachte', tools: one('add_idea') },
  { text: 'idea: instagram reels met tips voor bakkers', tools: one('add_idea') },
  { text: 'zou leuk zijn om ooit een eigen webshoptemplate te verkopen', tools: one('add_idea') },

  // set_task_status
  { text: 'offerte is de deur uit', tools: one('set_task_status'), check: { tool: 'set_task_status', task_id: 11, status: 'done' } },
  { text: 'factuur verstuurd', tools: one('set_task_status'), check: { tool: 'set_task_status', task_id: 15, status: 'done' } },
  { text: 'done met de onderwerpregels', tools: one('set_task_status'), check: { tool: 'set_task_status', task_id: 13, status: 'done' } },
  { text: 'openingstijden zijn bijgewerkt hoor', tools: one('set_task_status'), check: { tool: 'set_task_status', task_id: 14, status: 'done' } },
  { text: 'banner is af!!', tools: one('set_task_status'), check: { tool: 'set_task_status', task_id: 12, status: 'done' } },
  { text: 'klaar met de factuur van september', tools: one('set_task_status'), check: { tool: 'set_task_status', task_id: 15, status: 'done' } },
  { text: 'parkeer de banner maar', tools: one('set_task_status'), check: { tool: 'set_task_status', task_id: 12, status: 'parked' } },
  {
    text: 'de onderwerpregels laat ik los, boho doet het zelf',
    tools: [['set_task_status'], ['set_task_status', 'log_note']],
    check: { tool: 'set_task_status', task_id: 13, status: 'released' },
  },
  {
    text: 'ben nu met de banner bezig',
    tools: [['set_task_status'], ['start_session']],
    check: { tool: 'set_task_status', task_id: 12, status: 'in_progress' },
  },

  // set_suggestion_status
  { text: 'die proeverij knop heb ik gedaan', tools: one('set_suggestion_status') },

  // snooze
  { text: 'doe ik morgen', tools: one('snooze'), check: { tool: 'snooze', task_id: 12, until_date: '2026-10-08' } },
  { text: 'de factuur doe ik donderdag', tools: one('snooze'), check: { tool: 'snooze', task_id: 15, until_date: '2026-10-08' } },
  { text: 'openingstijden schuif ik naar maandag', tools: one('snooze'), check: { tool: 'snooze', task_id: 14, until_date: '2026-10-12' } },
  { text: 'nieuwsbrief boho pak ik vrijdag op', tools: one('snooze'), check: { tool: 'snooze', task_id: 13, until_date: '2026-10-09' } },

  // log_note
  { text: 'Anna van de bakkerij belde, de site moet nu vrijdag af', tools: one('log_note') },
  { text: 'boho belde: ze willen de nieuwsbrief in een andere kleur', tools: [['log_note'], ['log_note', 'add_task']] },
  { text: 'notitie bij de offerte: anna wil drie pakketten', tools: one('log_note') },
  { text: 'Kees zegt dat de winkel in december dicht is', tools: one('log_note') },

  // show_today and show_parking
  { text: 'wat stond er ook alweer', tools: one('show_today') },
  { text: 'wat moet ik vandaag doen?', tools: one('show_today') },
  { text: "what's on today", tools: one('show_today') },
  { text: 'laat mn lijstje zien', tools: one('show_today') },
  { text: 'wat staat er op de parkeerplaats', tools: one('show_parking') },
  { text: 'welke taken heb ik geparkeerd?', tools: one('show_parking') },

  // pause and update_settings
  { text: 'laat me vandaag met rust', tools: one('pause'), check: { tool: 'pause', until_date: '2026-10-08' } },
  { text: 'ik ben op vakantie tot maandag', tools: one('pause') },
  { text: 'morgen ben ik vrij, stuur dan niks', tools: one('pause') },
  { text: "stuur s ochtends pas om 9 uur", tools: one('update_settings') },
  { text: 'sessies van 45 minuten graag', tools: one('update_settings') },
  { text: 'geen middagbericht meer aub', tools: one('update_settings') },

  // overwhelm
  { text: 'ik trek het niet meer, alles loopt vast', tools: one('overwhelm') },
  { text: 'het is gewoon te veel allemaal vandaag', tools: one('overwhelm') },
  { text: 'ik verzuip in het werk', tools: one('overwhelm') },

  // no tool: greeting and thanks; crisis
  { text: 'hoi!', tools: [[]] },
  { text: 'dankje', tools: [[]] },
  { text: 'ik zie het echt niet meer zitten, ik wil er niet meer zijn', tools: one('crisis') },
  { text: 'waarom doe ik dit allemaal nog, niemand zou het merken als ik weg was', tools: one('crisis') },

  // break_down and start_session (step 1.4)
  { text: 'help me starten met de jaarplanning', tools: one('break_down') },
  { text: 'ik weet niet waar ik moet beginnen met de offerte', tools: one('break_down'), check: { tool: 'break_down', task_id: 11 } },
  { text: 'knip de banner op in kleine stapjes', tools: one('break_down'), check: { tool: 'break_down', task_id: 12 } },
  { text: 'start de offerte', tools: one('start_session'), check: { tool: 'start_session', task_id: 11 } },
  { text: 'ik ga nu aan de banner', tools: one('start_session'), check: { tool: 'start_session', task_id: 12 } },
  { text: 'zullen we beginnen met de factuur', tools: one('start_session'), check: { tool: 'start_session', task_id: 15 } },

  // more than one thing
  {
    text: 'factuur is verstuurd en zet op de lijst: offerte voor boho maken',
    tools: [['set_task_status', 'add_task']],
    check: { tool: 'add_task', project: 2 },
  },
];
