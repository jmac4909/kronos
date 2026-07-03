import { Ticket } from '../state/types';
import { evidenceRecordCount } from './evidenceData';
import { EvidenceGateResult, evaluateEvidenceGate } from './evidenceGate';

export type QueueRemovalDecisionKind =
  | 'allow'
  | 'block_failing_gate'
  | 'block_missing_evidence'
  | 'confirm_failing_gate'
  | 'confirm_missing_evidence';

export interface QueueRemovalDecision {
  kind: QueueRemovalDecisionKind;
  allowed: boolean;
  requiresConfirmation: boolean;
  gate?: EvidenceGateResult;
  failingSummary?: string;
  message?: string;
}

export function decideQueueRemoval(ticketKey: string, ticket: Ticket | undefined, interactive: boolean): QueueRemovalDecision {
  if (!ticket) {
    return { kind: 'allow', allowed: true, requiresConfirmation: false };
  }

  const gate = evaluateEvidenceGate(ticketKey, ticket);
  if (gate.status === 'fail') {
    const failingSummary = gate.checks
      .filter(check => check.status === 'fail')
      .map(check => check.title)
      .join('; ');
    return {
      kind: interactive ? 'confirm_failing_gate' : 'block_failing_gate',
      allowed: false,
      requiresConfirmation: interactive,
      gate,
      failingSummary,
      message: interactive
        ? `${ticketKey} has failing evidence gate checks: ${failingSummary}`
        : `${ticketKey} stayed in queue because its evidence gate is failing: ${failingSummary}`,
    };
  }

  if (evidenceRecordCount(ticket) === 0) {
    return {
      kind: interactive ? 'confirm_missing_evidence' : 'block_missing_evidence',
      allowed: false,
      requiresConfirmation: interactive,
      gate,
      message: interactive
        ? `${ticketKey} has no evidence records. Removing it from the queue will make the work harder to audit.`
        : `${ticketKey} stayed in queue because it has no evidence records.`,
    };
  }

  return { kind: 'allow', allowed: true, requiresConfirmation: false, gate };
}
