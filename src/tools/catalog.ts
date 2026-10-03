// Tools per kind of work, with the start page a workplace button opens (step 1.10).
// Only URLs confirmed through official help pages or search results on 2026-10-03 are
// filled in; a tool without one asks the user to paste a link.

export const WORK_TYPES = ['invoicing', 'email', 'calendar', 'content', 'website', 'docs'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export interface CatalogTool {
  key: string;
  label: string;
  workTypes: WorkType[];
  /** Login or dashboard page; null when no verified URL exists (WordPress: your own site). */
  defaultUrl: string | null;
}

export const CATALOG: CatalogTool[] = [
  { key: 'moneybird', label: 'Moneybird', workTypes: ['invoicing'], defaultUrl: 'https://moneybird.com/login' },
  { key: 'eboekhouden', label: 'e-Boekhouden', workTypes: ['invoicing'], defaultUrl: 'https://secure20.e-boekhouden.nl/' },
  // No verified login URL found for Jortt.
  { key: 'jortt', label: 'Jortt', workTypes: ['invoicing'], defaultUrl: null },
  { key: 'exact', label: 'Exact Online', workTypes: ['invoicing'], defaultUrl: 'https://start.exactonline.nl/' },
  { key: 'gmail', label: 'Gmail', workTypes: ['email'], defaultUrl: 'https://mail.google.com/' },
  { key: 'outlook', label: 'Outlook', workTypes: ['email'], defaultUrl: 'https://outlook.com/' },
  { key: 'google_calendar', label: 'Google Agenda', workTypes: ['calendar'], defaultUrl: 'https://calendar.google.com/' },
  { key: 'outlook_calendar', label: 'Outlook', workTypes: ['calendar'], defaultUrl: 'https://outlook.com/' },
  { key: 'apple_calendar', label: 'Apple Agenda', workTypes: ['calendar'], defaultUrl: 'https://www.icloud.com/calendar/' },
  { key: 'buffer', label: 'Buffer', workTypes: ['content'], defaultUrl: 'https://publish.buffer.com/' },
  { key: 'linkedin', label: 'LinkedIn', workTypes: ['content'], defaultUrl: 'https://www.linkedin.com/feed/' },
  { key: 'canva', label: 'Canva', workTypes: ['content'], defaultUrl: 'https://www.canva.com/' },
  // WordPress lives on your own domain (…/wp-admin): always ask for the link.
  { key: 'wordpress', label: 'WordPress', workTypes: ['website'], defaultUrl: null },
  { key: 'webflow', label: 'Webflow', workTypes: ['website'], defaultUrl: 'https://webflow.com/dashboard' },
  { key: 'shopify', label: 'Shopify', workTypes: ['website'], defaultUrl: 'https://admin.shopify.com/' },
  { key: 'google_drive', label: 'Google Drive', workTypes: ['docs'], defaultUrl: 'https://drive.google.com/' },
  { key: 'notion', label: 'Notion', workTypes: ['docs'], defaultUrl: 'https://www.notion.so/' },
];

/** The question per kind of work, in the order the bot asks them. */
export const QUESTIONS: Record<WorkType, string> = {
  invoicing: 'Waar maak je facturen en offertes?',
  email: 'Welke mail gebruik je voor werk?',
  calendar: 'Welke agenda gebruik je?',
  content: 'Waar maak of plan je posts?',
  website: 'Waarin beheer je je website?',
  docs: 'Waar staan je documenten?',
};

/** Short Dutch name of the kind of work, for lists and the weekly question. */
export const WORK_LABELS: Record<WorkType, string> = {
  invoicing: 'Facturen',
  email: 'Mail',
  calendar: 'Agenda',
  content: 'Posts',
  website: 'Website',
  docs: 'Documenten',
};

export function toolsFor(workType: WorkType): CatalogTool[] {
  return CATALOG.filter((tool) => tool.workTypes.includes(workType));
}

export function catalogTool(key: string): CatalogTool | undefined {
  return CATALOG.find((tool) => tool.key === key);
}

/** The action on the button: "nieuwe factuur", "offerte", "mail" … */
export function actionFor(workType: WorkType, taskTitle: string): string {
  const title = taskTitle.toLowerCase();
  switch (workType) {
    case 'invoicing':
      return /offerte/.test(title) ? 'offerte' : 'nieuwe factuur';
    case 'email':
      return 'mail';
    case 'calendar':
      return 'agenda';
    case 'content':
      return 'post';
    case 'website':
      return 'pagina';
    case 'docs':
      return 'document';
  }
}

export const LINK_REJECTED = 'Die link kan ik niet gebruiken. Plak een link die begint met https://.';
export const MAX_LINK_LENGTH = 2048;

/** Only https, at most 2,048 characters, a valid hostname. Returns the link unchanged. */
export function validateToolLink(input: string): string | undefined {
  const link = input.trim();
  if (link.length === 0 || link.length > MAX_LINK_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined;
  const host = url.hostname;
  const labels = host.split('.');
  const validLabel = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;
  if (labels.length < 2 || !labels.every((label) => validLabel.test(label)) || /^\d+$/.test(labels.at(-1) ?? '')) return undefined;
  return link;
}

/** "app.voorbeeld.nl" → "voorbeeld.nl", for a pasted link without a catalogue tool. */
export function labelFromLink(link: string): string {
  const host = new URL(link).hostname.replace(/^www\./, '');
  const parts = host.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : host;
}
