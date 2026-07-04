export type RankedSeverity = 'critical' | 'high' | 'warning' | 'medium' | 'info' | 'low';

export function severityRank(severity: RankedSeverity): number {
  if (severity === 'critical' || severity === 'high') { return 3; }
  if (severity === 'warning' || severity === 'medium') { return 2; }
  return 1;
}
