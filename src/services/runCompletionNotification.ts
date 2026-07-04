import type { Ticket } from '../state/types';
import { isAttentionRunStatus, runAttentionLine } from './runAttention';
import { recordFromUnknown, recordString } from './records';

type RunCompletionNotificationKind = 'review_ready' | 'attention';
type RunCompletionNotificationSeverity = 'info' | 'warning';
type RunCompletionReviewTarget = 'mr' | 'ticket';

interface RunCompletionNotification {
  kind: RunCompletionNotificationKind;
  severity: RunCompletionNotificationSeverity;
  message: string;
  actions: string[];
  reviewTarget?: RunCompletionReviewTarget;
}

export function buildRunCompletionNotification(
  ticketKey: string,
  ticket: Ticket | undefined,
  run: unknown,
): RunCompletionNotification | null {
  const record = recordFromUnknown(run);
  const status = recordString(record, 'status');
  const skill = recordString(record, 'skill') || 'run';

  if (status === 'waiting_for_review') {
    const hasMr = Boolean(ticket?.mr);
    const reviewTarget = hasMr ? `MR !${ticket?.mr?.iid} ready for review` : 'ready for review';
    return {
      kind: 'review_ready',
      severity: 'info',
      message: `${ticketKey} ${skill} completed - ${reviewTarget}.`,
      actions: ['Open Review', 'Run Center'],
      reviewTarget: hasMr ? 'mr' : 'ticket',
    };
  }

  if (!isAttentionRunStatus(status)) {
    return null;
  }

  const detail = runAttentionLine(run, 180);
  const statusLabel = status.replace(/_/g, ' ');
  return {
    kind: 'attention',
    severity: 'warning',
    message: `${ticketKey} ${skill} ${statusLabel}${detail ? ` - ${detail}` : ''}.`,
    actions: ['Run Center'],
  };
}
