// The dashboard assistant (step 2a.7). The name is a working name: change it here only.
export const ASSISTANT_NAME = 'Kiki';

export const KIKI_TEXTS = {
  off: `${ASSISTANT_NAME} staat nog niet aan.`,
  tooMany: 'Even rustig aan. Over een paar minuten kan het weer.',
  empty: 'Ik vond niets om op te slaan. Wil je het anders opschrijven?',
  failed: 'Dat lukte niet aan mijn kant. Probeer het zo nog eens.',
} as const;
