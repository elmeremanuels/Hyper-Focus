// Texts of the content module (step C1). Dutch, as everything the user sees.

export const SERVICE_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  twitter: 'X',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  pinterest: 'Pinterest',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  googlebusiness: 'Google Bedrijfsprofiel',
};
export const serviceLabel = (service: string) => SERVICE_LABELS[service] ?? service;

export const POST_STATUS_LABELS = {
  draft: 'concept',
  pending_approval: 'wacht op akkoord',
  approved: 'goedgekeurd',
  scheduled: 'ingepland',
  sent: 'verstuurd',
  failed: 'mislukt',
  skipped: 'overgeslagen',
} as const;

export const CONTENT_TEXTS = {
  header: (client: string, channel: string, service: string) => `Post voor ${client} · ${channel} (${serviceLabel(service)})`,
  when: (moment: string) => `Gepland: ${moment}`,
  queue: 'Gepland: volgende vrije plek in Buffer',
  ok: 'Goed',
  edit: 'Aanpassen',
  skip: 'Overslaan',
  retry: 'Opnieuw',
  scheduled: (moment: string, channel: string) => `Ingepland: ${moment} op ${channel}.`,
  scheduledQueue: (channel: string) => `Ingepland op ${channel}, op de volgende vrije plek in Buffer.`,
  skipped: 'Overgeslagen. Deze post gaat niet live.',
  already: (status: string) => `Deze post is al ${status}.`,
  notFound: 'Deze post bestaat niet meer.',
  failed: (message: string) => `Buffer weigerde de post: ${message}`,
  noBuffer: (client: string) => `Buffer is niet gekoppeld voor ${client}. Koppel het op de klantkaart in het dashboard.`,
  editAsk: 'Wat moet er anders? Typ of spreek het in. Je kunt ook de nieuwe tekst sturen.',
  editFailed: 'Het herschrijven lukte niet. Stuur de nieuwe tekst zelf, dan neem ik die over.',
} as const;
