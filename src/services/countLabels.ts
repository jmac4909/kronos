import { optionalFiniteNumberFromUnknown } from './records';

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function nonZeroCountLabel(count: unknown, singular: string, plural = `${singular}s`): string {
  const parsed = optionalFiniteNumberFromUnknown(count);
  const safeCount = parsed !== undefined && parsed > 0 ? Math.floor(parsed) : 0;
  return safeCount === 0 ? '' : countLabel(safeCount, singular, plural);
}
