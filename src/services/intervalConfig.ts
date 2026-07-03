export type PositiveNumberInputResult =
  | { kind: 'empty' }
  | { kind: 'invalid'; raw: string }
  | { kind: 'value'; value: number };

const MAX_TIMER_DELAY_MS = 2147483647;
const MAX_TIMER_DELAY_SECONDS = Math.floor(MAX_TIMER_DELAY_MS / 1000);

export function positiveConfigNumber(value: unknown, fallback: number): number {
  const safeFallback = typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : safeFallback;
}

export function configIntervalMs(value: unknown, fallbackMs: number, minMs = 1): number {
  return clampNumber(
    positiveConfigNumber(value, fallbackMs),
    positiveConfigNumber(minMs, 1),
    MAX_TIMER_DELAY_MS,
  );
}

export function configIntervalSeconds(value: unknown, fallbackSec: number, minSec = 1): number {
  return clampNumber(
    positiveConfigNumber(value, fallbackSec),
    positiveConfigNumber(minSec, 1),
    MAX_TIMER_DELAY_SECONDS,
  );
}

export function configIntervalSecondsMs(value: unknown, fallbackSec: number, minSec = 1): number {
  return configIntervalSeconds(value, fallbackSec, minSec) * 1000;
}

export function parsePositiveNumberInput(value: string | undefined): PositiveNumberInputResult {
  if (value === undefined || !value.trim()) {
    return { kind: 'empty' };
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { kind: 'invalid', raw: value };
  }
  return { kind: 'value', value: parsed };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
