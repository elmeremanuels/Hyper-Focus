// The dashboard talks to hyperfocus-web on the same host; the session cookie goes along.
export class NotLoggedIn extends Error {}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (response.status === 401) throw new NotLoggedIn();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const toLogin = () => window.location.assign('/login');

export interface Me {
  name: string;
  timezone: string;
}

export interface Battery {
  state: 'charging' | 'ready' | 'focus' | 'pitstop' | 'idle';
  segments: number;
  dimmed: boolean;
  windowStartsAt: string | null;
  windowEndsAt: string | null;
  task: { id: number; title: string } | null;
  elapsedMinutes: number | null;
  label: string;
}

export interface TodayTask {
  id: number;
  title: string;
  minutes: number | null;
  project: string;
  client: string | null;
  status: string;
  quickWin: boolean;
  inWindow: boolean;
  step: string | null;
  link: { title: string; url: string } | null;
}

export interface Today {
  date: string;
  dayLabel: string;
  name: string;
  window: { start: string; end: string; status: string; taskId: number | null } | null;
  focus: TodayTask[];
  log: Array<{ time: string; minutes: number; title: string; result: string | null; inWindow: boolean }>;
  activeBlock: { phase: 'block' | 'pause'; taskId: number | null; endsAt: string } | null;
}

export const post = <T = { ok: true }>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T = { ok: true }>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export interface ProjectTask {
  id: number;
  title: string;
  minutes: number | null;
  dueDate: string | null;
  status: string;
}

export interface Project {
  id: number;
  title: string;
  clientId: number | null;
  client: string | null;
  deadline: string | null;
  priority: 1 | 2 | 3;
  isWeeklyFocus: boolean;
  status: 'active' | 'parked';
  loose: boolean;
  tasks: ProjectTask[];
}

export interface Client {
  id: number;
  name: string;
  contactName: string | null;
  notes: string | null;
  status: 'active' | 'paused';
  projects: number;
}

export interface Projects {
  projects: Project[];
  clients: Client[];
}

export const ESTIMATES = [5, 15, 30, 60, 120] as const;

export interface Parking {
  parked: Array<{ id: number; title: string; project: string; client: string | null; minutes: number | null }>;
  ideas: Array<{ id: number; text: string; date: string }>;
  canPromote: boolean;
}

export type FocusPref = 'morning' | 'afternoon' | 'evening' | 'unknown';

export interface Settings {
  profile: { name: string; email: string | null; timezone: string; telegram: boolean };
  rhythm: { pref: FocusPref | null; start: string | null; prefStart: string; prefStarts: Record<FocusPref, string>; minutes: number; lengths: number[]; learned: Array<{ weekday: number; start: string }> };
  workWeek: { days: number[]; start: string; end: string; reviewDay: number };
  day: { morningTime: string; middayEnabled: boolean; wrapupTime: string };
  quiet: { start: string; end: string };
  rewardsEnabled: boolean;
  calendar: { available: boolean; connections: Array<{ provider: string; status: string; lastSyncedAt: string | null }>; meetingHeadsUp: boolean; meetingFollowup: boolean };
  tools: Array<{ workType: string; label: string; current: { key: string; label: string; url: string } | null; options: Array<{ key: string; label: string; needsLink: boolean }> }>;
}

export const put = <T = { ok: true }>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T = { ok: true }>(path: string) => api<T>(path, { method: 'DELETE' });

export type KikiItem =
  | { kind: 'task'; title: string; estimated_minutes: number; project_id?: number; client_name?: string; due_date?: string; notes?: string; work_type?: string; where?: string | null }
  | { kind: 'note'; note: string; project_id?: number; client_name?: string; due_date?: string; where?: string | null }
  | { kind: 'idea'; text: string; where?: string | null };

export interface KikiPlan {
  reply: string;
  items: KikiItem[];
  crisis?: boolean;
}

export interface KikiInfo {
  name: string;
  available: boolean;
  maxChars: number;
}
