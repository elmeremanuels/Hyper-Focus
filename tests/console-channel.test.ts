import { describe, expect, it } from 'vitest';
import { ConsoleChannel } from '../src/channels/console/channel.js';

describe('ConsoleChannel', () => {
  it('prints text and numbered buttons, and maps numbers back to buttons', async () => {
    const lines: string[] = [];
    const channel = new ConsoleChannel((line) => lines.push(line));

    await channel.send('+31600000000', {
      text: 'Kies',
      buttons: [
        { id: 'f:show', title: 'Laat zien' },
        { id: 'help', title: 'Wat kan ik?' },
      ],
    });

    expect(lines.join('\n')).toContain('Hyper&Focus: Kies');
    expect(lines.join('\n')).toContain('[2] Wat kan ik?');
    expect(channel.buttonForInput('2')?.id).toBe('help');
    expect(channel.buttonForInput('3')).toBeUndefined();
    expect(channel.buttonForInput('hoi')).toBeUndefined();
  });

  it('forgets buttons after a message without buttons', async () => {
    const channel = new ConsoleChannel(() => undefined);
    await channel.send('x', { text: 'a', buttons: [{ id: 'f:show', title: 'Laat zien' }] });
    await channel.send('x', { text: 'b' });
    expect(channel.buttonForInput('1')).toBeUndefined();
  });
});
