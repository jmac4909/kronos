import { optionalTrimmedStringFromUnknown } from './records';

export function mergeRequestReviewStatusLabel(status: unknown, fallback = ''): string {
  const value = optionalTrimmedStringFromUnknown(status);
  return value ? value.replace(/_/g, ' ') : fallback;
}
