import { toValidDate } from './dateValues';

export function formatDateTimeLabel(value: unknown, fallback = 'N/A'): string {
  return toValidDate(value)?.toLocaleString() || fallback;
}

export function formatDateLabel(value: unknown, fallback = 'N/A'): string {
  return toValidDate(value)?.toLocaleDateString() || fallback;
}

export function formatTimeLabel(value: unknown, fallback = 'Unknown'): string {
  return toValidDate(value)?.toLocaleTimeString() || fallback;
}
