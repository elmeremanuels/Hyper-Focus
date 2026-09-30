// Shape of seed data. `example.ts` holds fictional data; your own data goes in
// `eigen-data.local.ts` (git-ignored) with a default export of this type.

export interface SeedTask {
  title: string;
  estimatedMinutes?: 5 | 15 | 30 | 60 | 120;
  dueDate?: string;
  status?: 'open' | 'in_progress' | 'parked' | 'done' | 'released';
  microSteps?: string[];
}

export interface SeedProject {
  title: string;
  goal?: string;
  client?: string;
  priority?: 1 | 2 | 3;
  deadline?: string;
  isWeeklyFocus?: boolean;
  tasks?: SeedTask[];
}

export interface SeedData {
  user: {
    name: string;
    phoneE164: string;
    email?: string;
    timezone?: string;
  };
  business: {
    name: string;
    website?: string;
    sector?: string;
    description?: string;
    audience?: string;
    offer?: string;
    competitors?: Array<{ name: string; url?: string }>;
    goals?: string;
  };
  clients: Array<{ name: string; contactName?: string; notes?: string }>;
  projects: SeedProject[];
  /** Tasks for the automatic "Losse taken" project. */
  looseTasks?: SeedTask[];
  ideas?: string[];
}
