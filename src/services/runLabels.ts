export function runStatusDisplayLabel(status: unknown, fallback = 'unknown'): string {
  const value = typeof status === 'string' ? status.trim() : '';
  return value ? value.replace(/_/g, ' ') : fallback;
}
