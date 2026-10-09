import type { SeedData } from './types.js';

// Fictional example data: one business with three clients.
const example: SeedData = {
  user: {
    name: 'Sam',
    email: 'sam@voorbeeld.invalid',
    timezone: 'Europe/Amsterdam',
  },
  business: {
    name: 'Studio Voorbeeld',
    website: 'https://voorbeeld.invalid',
    sector: 'Online marketing',
    description: 'Websites en nieuwsbrieven voor lokale ondernemers.',
    audience: 'Zelfstandige winkels en ambachtsbedrijven in de regio',
    offer: 'Website in twee weken, maandelijkse nieuwsbrief',
    competitors: [
      { name: 'Webbureau Noord', url: 'https://webbureau-noord.invalid' },
      { name: 'Klikklaar', url: 'https://klikklaar.invalid' },
    ],
    goals: 'Drie nieuwe vaste klanten dit kwartaal',
  },
  clients: [
    { name: 'Bakkerij De Vries', contactName: 'Anna', notes: 'Wil de site voor de feestdagen live.' },
    { name: 'Boho Interieur', contactName: 'Mo' },
    { name: 'Fietsenmaker Jansen', contactName: 'Kees' },
  ],
  projects: [
    {
      title: 'Website bakkerij',
      goal: 'Nieuwe site met bestelformulier',
      client: 'Bakkerij De Vries',
      priority: 1,
      isWeeklyFocus: true,
      tasks: [
        {
          title: 'Offerte bakkerij afmaken',
          estimatedMinutes: 60,
          status: 'in_progress',
          microSteps: [
            'Open het offertebestand en schrijf de eerste alinea',
            'Zet de drie pakketten met prijs erin',
            'Stuur de offerte naar Anna',
          ],
        },
        { title: 'Banner voor de feestdagen', estimatedMinutes: 30 },
      ],
    },
    {
      title: 'Nieuwsbrief Boho',
      client: 'Boho Interieur',
      priority: 2,
      tasks: [{ title: 'Onderwerpregels nieuwsbrief kiezen', estimatedMinutes: 15 }],
    },
    {
      title: 'Onderhoud Fietsenmaker Jansen',
      client: 'Fietsenmaker Jansen',
      priority: 3,
      tasks: [{ title: 'Openingstijden op de site bijwerken', estimatedMinutes: 5 }],
    },
  ],
  looseTasks: [{ title: 'Factuur september versturen', estimatedMinutes: 5 }],
  ideas: ['Podcast over ondernemen met een ADHD-brein'],
};

export default example;
