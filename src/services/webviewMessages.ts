import { recordFromUnknown, recordString } from './records';

export interface BoardWebviewMessage {
  command: string;
  ticket: string;
  project: string;
}

export interface ActionPanelMessage {
  command: string;
  ticket: string;
  runId: string;
  planId: string;
  itemId: string;
  recoveryAction: string;
}

export interface RunCenterActionRequest {
  command: string;
  runId: string;
}

export function normalizeWebviewCommand(raw: unknown, allowed: ReadonlySet<string>): string | null {
  const command = recordFromUnknown(raw)['command'];
  if (typeof command !== 'string' || !allowed.has(command)) { return null; }
  return command;
}

export function normalizeBoardMessage(raw: unknown, allowed: ReadonlySet<string>): BoardWebviewMessage | null {
  const command = normalizeWebviewCommand(raw, allowed);
  if (!command) { return null; }
  const message = recordFromUnknown(raw);
  return {
    command,
    ticket: untrimmedString(message, 'ticket'),
    project: untrimmedString(message, 'project'),
  };
}

export function normalizeActionPanelMessage(raw: unknown, allowed: ReadonlySet<string>): ActionPanelMessage | null {
  const command = normalizeWebviewCommand(raw, allowed);
  if (!command) { return null; }
  const message = recordFromUnknown(raw);
  return {
    command,
    ticket: recordString(message, 'ticket'),
    runId: recordString(message, 'runId'),
    planId: recordString(message, 'planId'),
    itemId: recordString(message, 'itemId'),
    recoveryAction: recordString(message, 'recoveryAction'),
  };
}

export function normalizeRunCenterMessage(
  raw: unknown,
  allowed: ReadonlySet<string>,
  runlessCommands: ReadonlySet<string>
): RunCenterActionRequest | null {
  const command = normalizeWebviewCommand(raw, allowed);
  if (!command) { return null; }
  if (runlessCommands.has(command)) {
    return { command, runId: '' };
  }
  const message = recordFromUnknown(raw);
  const runId = untrimmedString(message, 'runId');
  if (runId.trim().length === 0) { return null; }
  return { command, runId };
}

function untrimmedString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}
