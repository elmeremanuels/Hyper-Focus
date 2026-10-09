import type { Button, OutboundMessage } from '../../conversation/types.js';

/**
 * Development output: prints outgoing messages to the console (BOUWPLAN.md, 15).
 * Buttons are numbered so the simulator can press them by number.
 */
export class ConsoleChannel {
  private lastButtons: Button[] = [];

  constructor(private readonly write: (line: string) => void = (line) => console.log(line)) {}

  async send(message: OutboundMessage): Promise<void> {
    this.write(`\nHyper&Focus: ${message.text}`);
    this.lastButtons = message.rows?.flat() ?? message.choices ?? message.buttons ?? [];
    if (this.lastButtons.length > 0) {
      this.write(
        this.lastButtons
          .map((button, index) => `  [${index + 1}] ${button.title}${button.url ? ` → ${button.url}` : ''}`)
          .join('\n'),
      );
    }
    for (const file of message.attachments ?? []) this.write(`  [bijlage] ${file.filename}`);
  }

  /** The button for a typed number such as "1", if the last message had one. */
  buttonForInput(input: string): Button | undefined {
    const match = /^\s*(\d)\s*$/.exec(input);
    return match ? this.lastButtons[Number(match[1]) - 1] : undefined;
  }
}
