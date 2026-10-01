import type { Button, OutboundChannel, OutboundMessage } from '../../conversation/types.js';

/**
 * Development channel: prints outgoing messages to the console (BOUWPLAN.md, 15).
 * Buttons are numbered so the simulator can press them by number.
 */
export class ConsoleChannel implements OutboundChannel {
  private lastButtons: Button[] = [];

  constructor(private readonly write: (line: string) => void = (line) => console.log(line)) {}

  async send(_to: string, message: OutboundMessage): Promise<void> {
    this.write(`\nHyper&Focus: ${message.text}`);
    this.lastButtons = message.buttons ?? [];
    if (this.lastButtons.length > 0) {
      this.write(this.lastButtons.map((button, index) => `  [${index + 1}] ${button.title}`).join('\n'));
    }
  }

  /** The button for a typed number such as "1", if the last message had one. */
  buttonForInput(input: string): Button | undefined {
    const match = /^\s*(\d)\s*$/.exec(input);
    return match ? this.lastButtons[Number(match[1]) - 1] : undefined;
  }
}
