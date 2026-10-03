import { describe, expect, it } from 'vitest';
import { renderMessageMail } from '../src/channels/email/templates/message.js';
import { toInlineKeyboard } from '../src/channels/telegram/keyboard.js';
import { actionFor, CATALOG, labelFromLink, validateToolLink, WORK_TYPES } from '../src/tools/catalog.js';

describe('tool links', () => {
  it('accepts https links on a valid host, unchanged', () => {
    const link = 'https://moneybird.com/123456/sales_invoices/new?x=1';
    expect(validateToolLink(link)).toBe(link);
    expect(validateToolLink('  https://app.voorbeeld.nl/factuur  ')).toBe('https://app.voorbeeld.nl/factuur');
  });

  it.each([
    'http://moneybird.com/login',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'file:///etc/passwd',
    'https://localhost/x',
    'https://192.168.1.1/x',
    'https://-bad-.nl/x',
    'https://user:pass@voorbeeld.nl/',
    `https://voorbeeld.nl/${'a'.repeat(2048)}`,
    'geen link',
  ])('rejects %s', (link) => {
    expect(validateToolLink(link)).toBeUndefined();
  });

  it('derives a label from the domain', () => {
    expect(labelFromLink('https://app.facturen.voorbeeld.nl/nieuw')).toBe('voorbeeld.nl');
    expect(labelFromLink('https://www.jortt.nl/')).toBe('jortt.nl');
  });

  it('names the action after the kind of work', () => {
    expect(actionFor('invoicing', 'Factuur september versturen')).toBe('nieuwe factuur');
    expect(actionFor('invoicing', 'Offerte maken voor Roos')).toBe('offerte');
    expect(actionFor('content', 'Post plannen')).toBe('post');
  });

  it('has only https defaults, and every kind of work has tools', () => {
    for (const tool of CATALOG) if (tool.defaultUrl) expect(validateToolLink(tool.defaultUrl)).toBe(tool.defaultUrl);
    for (const wt of WORK_TYPES) expect(CATALOG.some((tool) => tool.workTypes.includes(wt))).toBe(true);
  });
});

describe('link buttons', () => {
  const message = {
    text: 'Staat erin.',
    buttons: [
      { id: 't:1:start', title: 'Nu starten' },
      { id: 'link:1', title: 'Open Moneybird → nieuwe factuur', url: 'https://moneybird.com/login' },
    ],
  };

  it('become URL buttons in Telegram, with room for a longer title', () => {
    expect(toInlineKeyboard(message)?.inline_keyboard[0]).toEqual([
      { text: 'Nu starten', callback_data: 't:1:start' },
      { text: 'Open Moneybird → nieuwe factuur', url: 'https://moneybird.com/login' },
    ]);
  });

  it('become a plain link in mail, escaped', () => {
    const { text, html } = renderMessageMail(
      { text: 'x', buttons: [{ id: 'link:1', title: 'Open <b>Tool</b>', url: 'https://voorbeeld.nl/a?b=1&c=2' }] },
      undefined,
    );
    expect(text).toContain('Open <b>Tool</b>: https://voorbeeld.nl/a?b=1&c=2');
    expect(html).toContain('href="https://voorbeeld.nl/a?b=1&amp;c=2"');
    expect(html).toContain('Open &lt;b&gt;Tool&lt;/b&gt;');
  });

  it('supports explicit rows', () => {
    const rows = [[{ id: 'tl:invoicing:edit', title: 'Wijzig facturen' }, { id: 'tl:invoicing:del', title: 'Verwijder' }]];
    expect(toInlineKeyboard({ text: 'x', rows })?.inline_keyboard).toEqual([
      [
        { text: 'Wijzig facturen', callback_data: 'tl:invoicing:edit' },
        { text: 'Verwijder', callback_data: 'tl:invoicing:del' },
      ],
    ]);
  });
});
