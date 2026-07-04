export type BuildStatusKind = 'pass' | 'fail' | 'other';

const PASSING_BUILD_STATUSES = new Set(['SUCCESS', 'PASSED', 'OK']);
const FAILING_BUILD_STATUSES = new Set(['FAILURE', 'FAILED', 'ERROR']);

export function normalizedBuildStatus(status: unknown): string {
  return String(status ?? '').trim().toUpperCase();
}

export function buildStatusKind(status: unknown): BuildStatusKind {
  const normalized = normalizedBuildStatus(status);
  if (PASSING_BUILD_STATUSES.has(normalized)) { return 'pass'; }
  if (FAILING_BUILD_STATUSES.has(normalized)) { return 'fail'; }
  return 'other';
}

export function isPassingBuildStatus(status: unknown): boolean {
  return buildStatusKind(status) === 'pass';
}

export function isFailingBuildStatus(status: unknown): boolean {
  return buildStatusKind(status) === 'fail';
}
