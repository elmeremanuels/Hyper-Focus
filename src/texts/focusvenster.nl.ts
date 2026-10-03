// Texts for the focus window and rhythm (step 1.12), word for word from the plan of
// 3 October 2026. {taak}, {start}, {eind} and friends are filled in by the code.

export const WINDOW_TEXTS = {
  askPref: 'Wanneer werk je meestal het best?',
  morningLine: 'Je focusvenster vandaag: {start}–{eind}. Daar zet ik {taak}.',
  headsUp: 'Over een kwartier je focusvenster. {taak} ligt klaar.',
  askDeep: 'Hoe lang ga je diep op {taak}?',
  quietCheck: 'Goed bezig. Ik laat je. Ik meld me om {einde}.',
  windowEnd: '{n} minuten diep werk. Hoe staat {taak} ervoor?',
  softLanding: 'Over 10 minuten {afspraak}. Schrijf in één zin op waar je bent.',
  missed: 'Venster liep anders. Zal ik {taak} naar {voorstel} zetten?',
  learned: 'Je beste uren liggen op {dagen} rond {tijd}. Zal ik je focusvenster daar zetten?',
  // Not in the plan's table (to review).
  prefSaved: 'Genoteerd. Vanaf morgen staat je focusvenster op {start}–{eind}.',
  moveAsk: 'Naar hoe laat? Stuur bijvoorbeeld "focus vandaag om 14:00".',
  moved: 'Venster staat op {dag} {start}–{eind}.',
  movedTask: 'Gezet. {taak}: {voorstel}.',
  notToday: 'Prima. Morgen weer een venster.',
  landingSaved: 'Staat genoteerd. Je ziet het bij de volgende start.',
  whereYouWere: 'Waar je was: {zin}',
  quietHours: 'je stille uren',
  learnedYes: 'Gedaan. Je focusvenster volgt nu je beste uren.',
  learnedKeep: 'Prima, het blijft zo.',
} as const;

export const WINDOW_BUTTONS = {
  morning: 'Ochtend',
  afternoon: 'Middag',
  evening: 'Avond',
  unknown: 'Weet ik niet',
  move: 'Schuif venster',
  startAt: 'Start om {tijd}',
  stopNow: 'Ik stop',
  done: 'Af',
  plus30: 'Nog 30 min',
  stop: 'Stoppen',
  skip: 'Sla over',
  yes: 'Ja',
  notToday: 'Vandaag niet',
  keep: 'Houd het zo',
  inHour: 'Over een uur',
  tomorrow: 'Morgen',
} as const;

export const WEEKDAY_NAMES = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'] as const;
