// Channel-independent message shapes. Telegram, mail and the simulator all translate
// to and from these, so they share one router (BOUWPLAN.md, 9).

export interface Button {
  /** Button id, see BOUWPLAN.md 9.4. At most 64 bytes (Telegram callback_data). */
  id: string;
  /** At most 20 characters (40 for a link button). */
  title: string;
  /** A link button: opens this https URL instead of sending the id (step 1.10). */
  url?: string;
  /** A Telegram mini-app button (step 1.9); other channels show it as a link. */
  webApp?: string;
}

/** Where an inbound message came from; tasks and ideas keep it as their source. */
export type InboundSource = 'telegram' | 'voice' | 'email' | 'web';

export type InboundMessage =
  | { kind: 'text'; userId: number; text: string; source?: InboundSource }
  | { kind: 'button'; userId: number; buttonId: string; title: string; source?: InboundSource };

export interface OutboundMessage {
  text: string;
  /** Up to 9 buttons, shown three per row. Ignored when `choices` is set. */
  buttons?: Button[];
  /** Choice list: one button per row, up to 8 (BOUWPLAN.md, 9.2). */
  choices?: Button[];
  /** Explicit rows (up to 8 rows of at most 3), for lists with an action per line. */
  rows?: Button[][];
  /** Files sent with the message, such as an .ics file to put a session in a calendar. */
  attachments?: Attachment[];
}

export interface Attachment {
  filename: string;
  mimeType: string;
  /** Text content (an .ics file is text). */
  content: string;
}
