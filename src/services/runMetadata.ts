import { arrayFromUnknown, isRecord, trimmedStringFromUnknown } from './records';

export interface RunRecoveryActionMetadata {
  at: string;
  action: string;
  reason: string;
}

export interface RunEventMetadata {
  type?: string;
  label?: string;
  detail?: string;
  timestamp?: string;
}

export function runWarningStrings(value: unknown): string[] {
  return arrayFromUnknown(value).map(warningString).filter(Boolean);
}

export function appendRunWarnings(current: unknown, warnings: unknown[]): string[] {
  return [...runWarningStrings(current), ...warnings.map(warningString).filter(Boolean)];
}

export function runRecoveryActions(value: unknown): RunRecoveryActionMetadata[] {
  return arrayFromUnknown(value).flatMap(recoveryActionFromUnknown);
}

export function appendRunRecoveryActions(current: unknown, actions: RunRecoveryActionMetadata[]): RunRecoveryActionMetadata[] {
  return [...runRecoveryActions(current), ...actions.flatMap(recoveryActionFromUnknown)];
}

export function runEventRecords(value: unknown): RunEventMetadata[] {
  return arrayFromUnknown(value).flatMap(runEventFromUnknown);
}

export function appendRunEvents(current: unknown, events: RunEventMetadata[]): RunEventMetadata[] {
  return [...runEventRecords(current), ...events.flatMap(runEventFromUnknown)];
}

function warningString(value: unknown): string {
  return trimmedStringFromUnknown(value);
}

function recoveryActionFromUnknown(value: unknown): RunRecoveryActionMetadata[] {
  if (!isRecord(value)) { return []; }
  const at = trimmedStringFromUnknown(value['at']);
  const action = trimmedStringFromUnknown(value['action']);
  const reason = trimmedStringFromUnknown(value['reason']);
  return at && action && reason ? [{ at, action, reason }] : [];
}

function runEventFromUnknown(value: unknown): RunEventMetadata[] {
  if (!isRecord(value)) { return []; }
  const event: RunEventMetadata = {};
  for (const key of ['type', 'label', 'detail', 'timestamp'] as const) {
    const text = trimmedStringFromUnknown(value[key]);
    if (text) {
      event[key] = text;
    }
  }
  return event.type || event.label || event.detail || event.timestamp ? [event] : [];
}
