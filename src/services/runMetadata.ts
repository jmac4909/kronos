import { arrayFromUnknown, isRecord, trimmedStringFromUnknown } from './records';

export interface RunRecoveryActionMetadata {
  at: string;
  action: string;
  reason: string;
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
