// Harvested from Publicato-personal server/services/openai.ts (client setup only).
// Changed: everything except transcription removed, including the AI-assistant
// instruction block and the hardcoded model; the model comes from TRANSCRIBE_MODEL.
import OpenAI, { toFile } from 'openai';

export interface TranscribeConfig {
  apiKey: string | undefined;
  model: string | undefined;
}

export class Transcriber {
  private client: OpenAI | null = null;

  constructor(private readonly config: TranscribeConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.model);
  }

  /** Transcribes an audio file. The caller deletes the audio right after (BOUWPLAN.md, 14). */
  async transcribe(audio: Buffer, filename: string, mimeType: string): Promise<string> {
    const model = this.config.model;
    if (!model) {
      throw new Error('TRANSCRIBE_MODEL is not configured');
    }

    const file = await toFile(audio, filename, { type: mimeType });
    const result = await this.getClient().audio.transcriptions.create({
      file,
      model,
      language: 'nl',
    });
    return result.text;
  }

  private getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }
    if (!this.config.apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    this.client = new OpenAI({ apiKey: this.config.apiKey });
    return this.client;
  }
}
