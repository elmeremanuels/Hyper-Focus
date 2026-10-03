// Texts for the day review (step 1.11), word for word from the brief of 3 October 2026.

export const REVIEW_TEXTS = {
  start: 'Tijd om de dag af te ronden.',
  task: 'Wat doen we met {taak}?',
  energy: 'Hoe was je energie vandaag?',
  stuck: 'Zit er morgen iets vast? Typ of spreek het in.',
  thanks: 'Dank je.',
  blocksDone: 'Vandaag {n} blokken afgerond.',
  oneBlockDone: 'Vandaag 1 blok afgerond.',
  ready: 'Morgen om {tijd} staat je focus klaar.',
  deferred: 'Deze schuift al een paar dagen door. Zullen we hem opknippen of parkeren?',
  energyWeek: 'Deze week: {lijst}.',
  // Not in the brief's table (to review).
  energySaved: 'Genoteerd. Morgen houd ik daar rekening mee.',
  keep: 'Prima, hij blijft staan.',
} as const;

export const REVIEW_BUTTONS = {
  tomorrow: 'Morgen',
  split: 'Opknippen',
  park: 'Parkeren',
  done: 'Klaar',
  rest: 'Alles morgen',
  low: 'Laag',
  normal: 'Gewoon',
  high: 'Hoog',
  close: 'Nee, klaar',
  keep: 'Laat staan',
} as const;

export const ENERGY_LABELS = { low: 'laag', normal: 'gewoon', high: 'hoog' } as const;
