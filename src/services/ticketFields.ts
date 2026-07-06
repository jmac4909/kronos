import { arrayFromUnknown, trimmedStringFromUnknown } from './records';

export function ticketStringField(record: object | null | undefined, key: string, fallback = ''): string {
  const value = record ? Reflect.get(record, key) : undefined;
  return value === undefined || value === null ? fallback : String(value);
}

export function ticketStringArray(value: unknown): string[] {
  return arrayFromUnknown(value).map(item => trimmedStringFromUnknown(item)).filter(Boolean);
}
