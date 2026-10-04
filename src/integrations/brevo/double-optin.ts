// The waiting list (step 2b.3): Brevo sends the confirmation mail and only adds the contact to
// the list after the click (double opt-in). Hyper&Focus stores nothing itself.
// POST https://api.brevo.com/v3/contacts/doubleOptinConfirmation with the api-key header.

export const BREVO_DOI_URL = 'https://api.brevo.com/v3/contacts/doubleOptinConfirmation';

export interface DoubleOptinConfig {
  apiKey: string;
  listId: number;
  /** A Brevo template with the {{ doubleoptin }} link. */
  templateId: number;
  /** Where the confirm link lands: the "bevestigd" page of the site. */
  redirectionUrl: string;
}

export class BrevoError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Brevo double opt-in failed (${status}): ${detail}`);
    this.name = 'BrevoError';
  }
}

export async function requestDoubleOptin(config: DoubleOptinConfig, email: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(BREVO_DOI_URL, {
    method: 'POST',
    headers: { 'api-key': config.apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      email,
      includeListIds: [config.listId],
      templateId: config.templateId,
      redirectionUrl: config.redirectionUrl,
    }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: unknown };
    throw new BrevoError(response.status, typeof payload.message === 'string' ? payload.message : 'Unknown error');
  }
}
