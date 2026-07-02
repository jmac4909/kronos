import { Ticket } from '../state/types';
import { EvidenceGateCheck, EvidenceGateResult, evaluateEvidenceGate } from './evidenceGate';

export interface EvidenceHandoffDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  gate: EvidenceGateResult;
  blockingChecks: EvidenceGateCheck[];
  warningChecks: EvidenceGateCheck[];
  message: string;
}

export function decideEvidenceHandoff(ticketKey: string, ticket: Ticket): EvidenceHandoffDecision {
  const gate = evaluateEvidenceGate(ticketKey, ticket);
  const blockingChecks = gate.checks.filter(check => check.status === 'fail');
  const warningChecks = gate.checks.filter(check => check.status === 'warn');
  const allowed = blockingChecks.length === 0;
  const requiresConfirmation = allowed && warningChecks.length > 0;

  return {
    allowed,
    requiresConfirmation,
    gate,
    blockingChecks,
    warningChecks,
    message: buildDecisionMessage(ticketKey, gate, blockingChecks, warningChecks),
  };
}

function buildDecisionMessage(
  ticketKey: string,
  gate: EvidenceGateResult,
  blockingChecks: EvidenceGateCheck[],
  warningChecks: EvidenceGateCheck[],
): string {
  if (blockingChecks.length > 0) {
    return `${ticketKey} is not ready for review handoff: ${blockingChecks.map(check => check.title).join('; ')}`;
  }
  if (warningChecks.length > 0) {
    return `${ticketKey} has review handoff warnings: ${warningChecks.map(check => check.title).join('; ')}`;
  }
  return `${ticketKey} passed evidence gate: ${gate.summary}`;
}
