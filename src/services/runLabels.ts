import { optionalTrimmedStringFromUnknown } from './records';

export function runStatusDisplayLabel(status: unknown, fallback = 'unknown'): string {
  const value = optionalTrimmedStringFromUnknown(status) || '';
  return value ? value.replace(/_/g, ' ') : fallback;
}
