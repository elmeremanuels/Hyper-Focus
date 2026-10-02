// Harvested from Publicato-personal server/services/anthropic.ts.
// Changed: SDK upgraded, the AI-assistant instruction block and hardcoded models removed,
// models come from CLAUDE_MODEL_FAST / CLAUDE_MODEL_SMART, a tool-use helper is added,
// and every call reports its token usage (for the ai_usage table, step 0.4).
import Anthropic from '@anthropic-ai/sdk';

export type ModelTier = 'fast' | 'smart';

export interface ClaudeConfig {
  apiKey: string | undefined;
  modelFast: string | undefined;
  modelSmart: string | undefined;
}

export interface AiUsageRecord {
  userId?: number;
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type UsageRecorder = (record: AiUsageRecord) => Promise<void> | void;

export interface GenerateOptions {
  /** The user the call is for; recorded in ai_usage. */
  userId?: number;
  purpose: string;
  tier: ModelTier;
  system?: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
}

export interface ToolCallOptions extends GenerateOptions {
  tools: Anthropic.Tool[];
  /** Forces one tool; default lets Claude choose. */
  forceTool?: string;
}

export interface ToolCallResult {
  text: string;
  toolCalls: Anthropic.ToolUseBlock[];
  stopReason: Anthropic.Message['stop_reason'];
  message: Anthropic.Message;
}

export class ClaudeClient {
  private readonly client: Anthropic;

  constructor(
    private readonly config: ClaudeConfig,
    private readonly recordUsage: UsageRecorder = () => undefined,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic({ apiKey: config.apiKey });
  }

  resolveModel(tier: ModelTier): string {
    const model = tier === 'fast' ? this.config.modelFast : this.config.modelSmart;
    if (!model) {
      const variable = tier === 'fast' ? 'CLAUDE_MODEL_FAST' : 'CLAUDE_MODEL_SMART';
      throw new Error(`${variable} is not configured`);
    }
    return model;
  }

  /** Plain text generation. */
  async generate(options: GenerateOptions): Promise<string> {
    const message = await this.create(options);
    return extractText(message);
  }

  /** Tool use with a fixed schema, for everything that touches the database. */
  async callWithTools(options: ToolCallOptions): Promise<ToolCallResult> {
    const message = await this.create(options, options.tools, options.forceTool);
    return {
      text: extractText(message),
      toolCalls: message.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      ),
      stopReason: message.stop_reason,
      message,
    };
  }

  private async create(
    options: GenerateOptions,
    tools?: Anthropic.Tool[],
    forceTool?: string,
  ): Promise<Anthropic.Message> {
    const model = this.resolveModel(options.tier);
    const message = await this.client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      messages: options.messages,
      ...(options.system !== undefined && { system: options.system }),
      ...(tools !== undefined && {
        tools,
        tool_choice: forceTool ? { type: 'tool' as const, name: forceTool } : { type: 'auto' as const },
      }),
    });

    await this.recordUsage({
      ...(options.userId !== undefined && { userId: options.userId }),
      purpose: options.purpose,
      model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    });

    return message;
  }
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}
