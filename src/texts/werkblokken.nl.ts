// Texts for work blocks, pauses and rewards (step 1.9), word for word from the brief of
// 3 October 2026. Change them here; {taak} and {n} are filled in by the code.

export const BLOCK_TEXTS = {
  askDuration: 'Hoe lang ga je aan {taak}?',
  started: 'Top. {n} minuten voor {taak}. Ik meld me aan het eind.',
  end: 'Je {n} minuten zitten erop. Hoe ging het?',
  backOnTime: 'Welkom terug. Je plant kreeg een extra druppel.',
  backLate: 'Welkom terug.',
  returnReminder: 'Terug naar je blok?',
  hyperfocus: 'Je bent al een uur bezig. Tijd voor water en even bewegen.',
  rewardsOff: 'Beloningen staan uit. Je werkblokken en pauzes lopen gewoon door.',
  gardenWeek: 'Je tuin groeide deze week met {n} blaadjes.',
  miniAppEnd: 'Je minuut zit erop. Terug naar je werk.',
  // Not in the brief's table; kept short (to review).
  firstStep: 'Eerste stap: {stap}.',
  extended: 'Prima, nog 15 minuten.',
  extendedBy: 'Prima, nog {n} minuten.',
  stopped: 'Gestopt.',
  rewardsOn: 'Beloningen staan weer aan.',
} as const;

export const BLOCK_BUTTONS = {
  stop: 'Stoppen',
  done: 'Afgerond',
  plus15: 'Nog 15 min',
  back: 'Ik ben terug',
  reward: 'Je minuut',
  nextBlock: 'Volgende blok starten',
  takeBreak: 'Pauze nemen',
  rewardsOnAgain: 'Weer aanzetten',
  rewardsOffHelp: 'Beloningen uit',
  rewardsOnHelp: 'Beloningen aan',
} as const;

/** Pause missions: one per pause, never the same twice in a row. */
export const PAUSE_MISSIONS = {
  water: { minutes: 2, text: 'Mooi gewerkt. Pak een glas water. Je telefoon blijft liggen. Over 2 minuten zie ik je terug.' },
  stretch: { minutes: 2, text: 'Mooi gewerkt. Sta even op en strek je uit. Je telefoon blijft liggen. Over 2 minuten zie ik je terug.' },
  toilet: { minutes: 3, text: 'Mooi gewerkt. Even naar het toilet. Je telefoon blijft liggen. Over 3 minuten zie ik je terug.' },
  breathe: {
    minutes: 2,
    text: 'Mooi gewerkt. Loop naar het raam en adem drie keer diep in en uit. Je telefoon blijft liggen. Over 2 minuten zie ik je terug.',
  },
} as const;

export type PauseMission = keyof typeof PAUSE_MISSIONS;

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z]+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
