import type { MergeRequestStatusNotification } from './mergeRequestNotifications';
import { describeMergeRequestStatusChange } from './mergeRequestNotifications';
import type { MergeRequestStatusUpdate } from './ticketMutations';

export type ReviewMonitorDecisionKind = 'deploy_monitor' | 'blocked' | 'notify' | 'none';

export interface ReviewMonitorDecision {
  kind: ReviewMonitorDecisionKind;
  message?: string;
  severity?: MergeRequestStatusNotification['severity'];
}

export function decideReviewMonitorAction(ticketKey: string, update: MergeRequestStatusUpdate): ReviewMonitorDecision {
  if (update.mergedNow) {
    return { kind: 'deploy_monitor' };
  }
  if (update.closedNow) {
    return {
      kind: 'blocked',
      severity: 'warning',
      message: `${ticketKey} MR closed - ticket moved to blocked.`,
    };
  }
  const notification = describeMergeRequestStatusChange(ticketKey, update);
  if (!notification) {
    return { kind: 'none' };
  }
  return {
    kind: 'notify',
    severity: notification.severity,
    message: notification.message,
  };
}
