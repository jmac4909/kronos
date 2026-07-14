import { recordFromUnknown, recordString } from './records';

export interface TicketWorkspaceActionMessage {
  command: string;
  ticket: string;
}

export function normalizeActionPanelMessage(
  raw: unknown,
  allowed: ReadonlySet<string>,
): TicketWorkspaceActionMessage | null {
  const message = recordFromUnknown(raw);
  const command = message['command'];
  if (typeof command !== 'string' || !allowed.has(command)) { return null; }
  return {
    command,
    ticket: recordString(message, 'ticket'),
  };
}
