export type RankedSeverity = 'critical' | 'high' | 'warning' | 'medium' | 'info' | 'low';
export type SeveritySummary = Record<'critical' | 'warning' | 'info', number> & { total: number };

export function severityRank(severity: RankedSeverity): number {
  if (severity === 'critical' || severity === 'high') { return 3; }
  if (severity === 'warning' || severity === 'medium') { return 2; }
  return 1;
}

export function severitySummary(items: Array<{ severity: RankedSeverity }>): SeveritySummary {
  const summary: SeveritySummary = { critical: 0, warning: 0, info: 0, total: items.length };
  for (const item of items) {
    const rank = severityRank(item.severity);
    if (rank >= 3) {
      summary.critical += 1;
    } else if (rank === 2) {
      summary.warning += 1;
    } else {
      summary.info += 1;
    }
  }
  return summary;
}
