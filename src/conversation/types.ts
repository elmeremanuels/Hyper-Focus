// Channel-independent message shapes. WhatsApp (step 1.1) and the simulator both
// translate to and from these, so they share one router.

export interface Button {
  /** Button id, see BOUWPLAN.md 9.5. */
  id: string;
  /** Max 20 characters (WhatsApp limit). */
  title: string;
}

export type InboundMessage =
  | { kind: 'text'; from: string; text: string }
  | { kind: 'button'; from: string; buttonId: string; title: string };

export interface OutboundMessage {
  text: string;
  /** Max 3 buttons (WhatsApp limit). */
  buttons?: Button[];
}

export interface OutboundChannel {
  send(to: string, message: OutboundMessage): Promise<void>;
}
