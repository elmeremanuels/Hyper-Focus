// Texts for work blocks, pitstops and the reward minute (steps 1.9 and 1.12), word for word
// from the brief and the plan of 3 October 2026. {taak} and {n} are filled in by the code.

export const BLOCK_TEXTS = {
  askDuration: 'Hoe lang ga je aan {taak}?',
  started: 'Top. {n} minuten voor {taak}. Ik meld me aan het eind.',
  end: 'Je {n} minuten zitten erop. Hoe ging het?',
  hyperfocus: 'Je bent al een uur bezig. Tijd voor water en even bewegen.',
  rewardsOff: 'Beloningen staan uit. Je werkblokken en pauzes lopen gewoon door.',
  // Step 1.12 (aanpasplan 3 oktober 2026): pitstop, return and the focus log, word for word.
  pitstopDone: '{n} minuten, {taak} af. Pitstop: {opdracht}. Telefoon blijft liggen. Om {tijd} zie ik je terug.',
  backOnTime: 'Terug op tijd. Opgeladen.',
  backLate: 'Welkom terug.',
  returnReminder: 'Pitstop voorbij. Terug naar je werk?',
  miniAppTitle: 'Vandaag gedaan',
  focusLogEmpty: 'Nog leeg. Je eerste blok staat er straks.',
  weekYield: 'Deze week: {v} focusvensters, {u} uur diep werk.',
  // Not in the brief or the plan (to review).
  pitstopBreak: '{n} minuten gewerkt. Pitstop: {opdracht}. Telefoon blijft liggen. Om {tijd} zie ik je terug.',
  weekOut: 'De deur uit: {lijst}.',
  weekBest: 'Beste venster: {dag} {tijd}, {n} minuten.',
  miniAppEnd: 'Je minuut zit erop. Terug naar je werk.',
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
  nextBlock: 'Volgende blok',
  takeBreak: 'Pauze nemen',
  rewardsOnAgain: 'Weer aanzetten',
  rewardsOffHelp: 'Beloningen uit',
  rewardsOnHelp: 'Beloningen aan',
  backToWork: 'Terug naar je werk',
} as const;

/** Pitstop missions: one per pause, never the same twice in a row (step 1.12: short). */
export const PAUSE_MISSIONS = {
  water: { minutes: 2, text: 'pak een glas water' },
  stretch: { minutes: 2, text: 'sta op en strek je uit' },
  toilet: { minutes: 3, text: 'loop even naar het toilet' },
  breathe: { minutes: 2, text: 'adem drie keer diep in bij het raam' },
} as const;

export type PauseMission = keyof typeof PAUSE_MISSIONS;

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z]+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
