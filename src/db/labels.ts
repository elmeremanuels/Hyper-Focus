// Dutch UI labels for the English enum values (BOUWPLAN.md, 8).

export const taskStatusLabels = {
  open: 'open',
  in_progress: 'mee bezig',
  parked: 'geparkeerd',
  done: 'gedaan',
  released: 'losgelaten',
} as const;

export const suggestionStatusLabels = {
  new: 'nieuw',
  in_progress: 'mee bezig',
  done: 'gedaan',
  parked: 'geparkeerd',
  skipped: 'overgeslagen',
  not_relevant: 'niet relevant',
} as const;

export const lensLabels = {
  destep: 'DESTEP',
  audience: 'Doelgroep',
  competitor: 'Concurrent',
  funnel: 'Funnel',
} as const;
