import { describeMergeRequestStatusChange } from './mergeRequestNotifications';
import type { MergeRequestStatusUpdate } from './ticketMutations';

type ReviewMonitorDecisionKind = 'deploy_monitor' | 'blocked' | 'notify' | 'none';

interface ReviewMonitorDecision {
  kind: ReviewMonitorDecisionKind;
  message?: string;
  severity?: 'info' | 'warning';
  url?: string;
}

export function decideReviewMonitorAction(ticketKey: string, update: MergeRequestStatusUpdate): ReviewMonitorDecision {
  if (update.mergedNow) {
    return { kind: 'deploy_monitor' };
  }
  const url = update.ticket.mr?.url;
  if (update.closedNow) {
    const decision: ReviewMonitorDecision = {
      kind: 'blocked',
      severity: 'warning',
      message: `${ticketKey} MR closed - ticket moved to blocked.`,
    };
    if (url) { decision.url = url; }
    return decision;
  }
  const notification = describeMergeRequestStatusChange(ticketKey, update);
  if (!notification) {
    return { kind: 'none' };
  }
  const decision: ReviewMonitorDecision = {
    kind: 'notify',
    severity: notification.severity,
    message: notification.message,
  };
  if (url) { decision.url = url; }
  return decision;
}
