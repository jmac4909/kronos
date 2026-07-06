import { toValidDate } from './dateValues';

export function formatWebviewDateTime(value: unknown, fallback = 'N/A'): string {
  return toValidDate(value)?.toLocaleString() || fallback;
}

export function formatWebviewDate(value: unknown, fallback = 'N/A'): string {
  return toValidDate(value)?.toLocaleDateString() || fallback;
}
