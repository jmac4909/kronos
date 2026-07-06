export function mergeRequestReviewStatusLabel(status: unknown, fallback = ''): string {
  return typeof status === 'string' && status
    ? status.replace(/_/g, ' ')
    : fallback;
}
