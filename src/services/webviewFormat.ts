import { formatDateLabel, formatDateTimeLabel } from './dateLabels';

export function formatWebviewDateTime(value: unknown, fallback = 'N/A'): string {
  return formatDateTimeLabel(value, fallback);
}

export function formatWebviewDate(value: unknown, fallback = 'N/A'): string {
  return formatDateLabel(value, fallback);
}
