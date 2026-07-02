export const ACTIVE_RUN_STATUSES = new Set(['queued', 'preflight', 'running', 'paused']);

export interface RunStatusLike {
  status?: unknown;
  endedAt?: unknown;
  exitCode?: unknown;
  events?: unknown;
}

export function runStatus(value: RunStatusLike | unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return ''; }
  const status = Reflect.get(value, 'status');
  return typeof status === 'string' ? status : '';
}

export function isActiveRunStatus(status: unknown): boolean {
  return typeof status === 'string' && ACTIVE_RUN_STATUSES.has(status);
}

export function isActiveRun(run: RunStatusLike | unknown): boolean {
  return isActiveRunStatus(runStatus(run)) && !hasTerminalRunSignal(run);
}

export function activeRunSummary(runs: Array<RunStatusLike | unknown>): string {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const status = runStatus(run);
    if (!isActiveRun(run)) { continue; }
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return ['running', 'preflight', 'queued', 'paused']
    .filter(status => counts.has(status))
    .map(status => `${counts.get(status)} ${status}`)
    .join(', ');
}

export function hasTerminalRunSignal(run: RunStatusLike | unknown): boolean {
  if (!isRecord(run)) { return false; }
  if (hasDateLikeValue(run.endedAt)) { return true; }
  if (run.exitCode !== undefined && run.exitCode !== null && Number.isFinite(Number(run.exitCode))) { return true; }

  const events = Array.isArray(run.events)
    ? run.events.filter(isRecord)
    : [];
  const lastEvent = events[events.length - 1];
  if (!lastEvent) { return false; }
  const eventType = stringValue(lastEvent.type);
  const label = stringValue(lastEvent.label);
  return eventType === 'done'
    || label.startsWith('Session complete')
    || label.startsWith('Session exited with code')
    || label === 'Session cancelled';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasDateLikeValue(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') { return false; }
  return Number.isFinite(new Date(value).getTime());
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
