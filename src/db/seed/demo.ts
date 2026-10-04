import type { DemoWeek } from '../../demo/week.js';

// Fictional demo content (step 2a.8). Your own goes in scripts/demo-week.local.ts.
const demo: DemoWeek = {
  seed: {
    user: { name: 'Noor', email: 'demo@voorbeeld.invalid', timezone: 'Europe/Amsterdam' },
    business: {
      name: 'Atelier Noord',
      sector: 'Grafisch ontwerp',
      description: 'Huisstijlen, verpakkingen en websites voor kleine merken.',
      audience: 'Kleine merken in food en interieur',
      offer: 'Huisstijl in vier weken, losse ontwerpklussen',
      goals: 'Twee nieuwe huisstijlklanten dit kwartaal',
    },
    clients: [
      { name: 'Koffiebranderij Bonen', contactName: 'Lisa', notes: 'Wil de nieuwe verpakking voor de kerst in de winkel.' },
      { name: 'Studio Linnen', contactName: 'Daan' },
      { name: 'Fietscafé De Ketting', contactName: 'Ilse' },
    ],
    projects: [
      {
        title: 'Verpakking Koffiebranderij Bonen',
        goal: 'Drie zakken in de nieuwe huisstijl',
        client: 'Koffiebranderij Bonen',
        priority: 1,
        isWeeklyFocus: true,
        tasks: [
          { title: 'Drukproef verpakking controleren', estimatedMinutes: 60, microSteps: ['Open de pdf van de drukker', 'Check kleuren tegen het staal', 'Mail Lisa de drie punten'] },
          { title: 'Etiket filterkoffie uitwerken', estimatedMinutes: 120 },
        ],
      },
      {
        title: 'Website Studio Linnen',
        client: 'Studio Linnen',
        priority: 2,
        tasks: [
          { title: 'Productfoto’s uitzoeken', estimatedMinutes: 30 },
          { title: 'Homepage-tekst schrijven', estimatedMinutes: 60 },
        ],
      },
      {
        title: 'Menukaart Fietscafé',
        client: 'Fietscafé De Ketting',
        priority: 3,
        tasks: [{ title: 'Menukaart aanpassen met nieuwe prijzen', estimatedMinutes: 30, status: 'parked' }],
      },
    ],
    looseTasks: [
      { title: 'Factuur september versturen', estimatedMinutes: 5 },
      { title: 'Btw-aangifte voorbereiden', estimatedMinutes: 60, dueDate: '2026-10-31' },
    ],
    ideas: ['Workshop huisstijl voor starters', 'Portfolio vernieuwen met de verpakkingen', 'Samenwerken met een fotograaf'],
  },
  windowStart: '09:30',
  days: [
    { done: ['Moodboard verpakking maken', 'Offerte Fietscafé sturen'], energy: 'normal' },
    { done: ['Eerste schetsen verpakking'], energy: 'high' },
    { done: ['Logo-varianten Studio Linnen', 'Mail aan Daan beantwoorden', 'Bonnetjes uploaden'], energy: 'high' },
    { done: [], energy: 'low' },
    { done: ['Verpakking naar de drukker', 'Factuur augustus nabellen'], energy: 'normal' },
  ],
  today: ['Kleurstaal opvragen bij de drukker'],
};

export default demo;
