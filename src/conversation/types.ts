// Channel-independent message shapes. WhatsApp (step 1.1) and the simulator both
// translate to and from these, so they share one router.

export interface Button {
  /** Button id, see BOUWPLAN.md 9.5. */
  id: string;
  /** Max 20 characters (WhatsApp limit). */
  title: string;
}

export interface ListRow {
  /** Row id, same convention as button ids. */
  id: string;
  /** Max 24 characters (WhatsApp limit). */
  title: string;
  /** Max 72 characters. */
  description?: string;
}

export interface ListMenu {
  /** Label of the button that opens the list, max 20 characters. */
  button: string;
  /** Max 10 rows (WhatsApp limit). */
  rows: ListRow[];
}

export type InboundMessage =
  | { kind: 'text'; from: string; text: string }
  | { kind: 'button'; from: string; buttonId: string; title: string };

export interface OutboundMessage {
  text: string;
  /** Max 3 buttons (WhatsApp limit). Ignored when `list` is set. */
  buttons?: Button[];
  list?: ListMenu;
}

export interface OutboundChannel {
  send(to: string, message: OutboundMessage): Promise<void>;
}
