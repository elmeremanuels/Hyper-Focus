// Harvested from Publicato-personal server/services/whatsappService.ts.
// Changed: config is injected (Graph version from env), template language is `nl`,
// inbound handling moved to the webhook, and interactive buttons and lists added
// (BOUWPLAN.md, 9.4). Media download follows with voice messages in step 1.6.
import type { Button, ListMenu } from '../../conversation/types.js';
import { buttonsPayload, listPayload } from './interactive.js';

export interface WhatsAppConfig {
  graphVersion: string;
  accessToken: string;
  phoneNumberId: string;
}

export interface WhatsAppSendResult {
  id: string | undefined;
  status: string | undefined;
}

export const TEMPLATE_LANGUAGE = 'nl';

type FetchLike = typeof fetch;

interface GraphMessageResponse {
  messages?: Array<{ id?: string; message_status?: string }>;
  error?: { message?: string };
}

export class WhatsAppClient {
  constructor(
    private readonly config: WhatsAppConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async sendText(to: string, body: string): Promise<WhatsAppSendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });
  }

  async sendButtons(to: string, text: string, buttons: Button[]): Promise<WhatsAppSendResult> {
    return this.post(buttonsPayload(to, text, buttons));
  }

  async sendList(to: string, text: string, list: ListMenu): Promise<WhatsAppSendResult> {
    return this.post(listPayload(to, text, list));
  }

  async sendTemplate(
    to: string,
    templateName: string,
    variables: string[] = [],
  ): Promise<WhatsAppSendResult> {
    const components =
      variables.length > 0
        ? [
            {
              type: 'body',
              parameters: variables.map((text) => ({ type: 'text', text })),
            },
          ]
        : [];

    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: TEMPLATE_LANGUAGE },
        components,
      },
    });
  }

  private async post(body: Record<string, unknown>): Promise<WhatsAppSendResult> {
    const { graphVersion, phoneNumberId, accessToken } = this.config;
    const response = await this.fetchImpl(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      },
    );

    const payload = (await response.json()) as GraphMessageResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `WhatsApp request failed (${response.status})`);
    }

    const message = payload.messages?.[0];
    return { id: message?.id, status: message?.message_status };
  }
}
