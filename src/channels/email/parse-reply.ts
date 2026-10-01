// Pulls the new text out of a mail reply, and recognizes forwarded mail (BOUWPLAN.md, 9.3).
// Covers the quote styles of Gmail, Outlook and Apple Mail in Dutch and English.

const QUOTE_INTRO = /^(On|Op|Am|Le)\s.+/i;
const QUOTE_INTRO_END = /(wrote|schreef|geschreven|het volgende)[^\n]*:\s*$/i;
const ORIGINAL_MESSAGE = /^-{2,}\s*(Original Message|Oorspronkelijk bericht|Origineel bericht)\s*-{2,}/i;
const OUTLOOK_RULE = /^_{10,}\s*$/;
const HEADER_FROM = /^\*?(From|Van):\*?\s/i;
const HEADER_NEXT = /^\*?(Sent|Verzonden|Date|Datum|To|Aan|Subject|Onderwerp):\*?\s/i;
const SIGNATURE = /^(-- ?|—)$/;
const MOBILE_FOOTER = /^(Sent from my|Verzonden (vanaf|met|vanuit) (mijn )?|Get Outlook for|Outlook voor)/i;

const FORWARD_SUBJECT = /^\s*(fwd?|fw|doorst|wg|tr)\s*:/i;
const FORWARD_MARKER =
  /^(-{3,}\s*(Forwarded message|Doorgestuurd bericht|Doorgestuurde e-mail)\s*-{3,}|Begin (forwarded message|doorgestuurd bericht):)/im;

export function extractReply(text: string): string {
  const lines = normalize(text).split('\n');
  const kept: string[] = [];

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    const next = lines[index + 1]?.trim() ?? '';

    if (line.startsWith('>')) break;
    if (QUOTE_INTRO.test(line) && (QUOTE_INTRO_END.test(line) || QUOTE_INTRO_END.test(`${line} ${next}`))) break;
    if (ORIGINAL_MESSAGE.test(line) || OUTLOOK_RULE.test(line)) break;
    if (HEADER_FROM.test(line) && lines.slice(index + 1, index + 5).some((l) => HEADER_NEXT.test(l.trim()))) break;
    if (SIGNATURE.test(line) || MOBILE_FOOTER.test(line)) break;

    kept.push(raw);
  }

  return kept.join('\n').trim();
}

export interface ForwardedMail {
  /** What the user wrote above the forwarded part. */
  note: string;
  originalFrom: string | undefined;
  originalSubject: string | undefined;
  /** First 2,000 characters of the forwarded part. */
  excerpt: string;
}

export function detectForward(subject: string, text: string): ForwardedMail | undefined {
  const body = normalize(text);
  const marker = FORWARD_MARKER.exec(body);
  if (!marker && !FORWARD_SUBJECT.test(subject)) return undefined;

  const start = marker ? marker.index : 0;
  const note = marker ? extractReply(body.slice(0, start)) : '';
  const forwarded = marker ? body.slice(start + marker[0].length) : body;

  return {
    note,
    originalFrom: /^\*?(From|Van):\*?\s*(.+)$/im.exec(forwarded)?.[2]?.trim(),
    originalSubject:
      /^\*?(Subject|Onderwerp):\*?\s*(.+)$/im.exec(forwarded)?.[2]?.trim() ??
      subject.replace(FORWARD_SUBJECT, '').trim(),
    excerpt: forwarded.trim().slice(0, 2000),
  };
}

function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
}
