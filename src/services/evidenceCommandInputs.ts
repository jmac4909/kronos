import type { TicketEnvironmentResult, TicketEvidenceCheck, TicketEvidenceNote } from '../state/types';
import type { TicketEvidenceCheckInput } from './ticketMutations';

export interface EvidenceCommandOption<T extends string = string> {
  label: T;
  description?: string;
}

export type EvidenceNoteKind = TicketEvidenceNote['kind'];
export type EvidenceCheckResult = TicketEvidenceCheck['result'];
export type EvidenceCheckConfidence = NonNullable<TicketEvidenceCheck['confidence']>;
export type EvidenceEnvironmentResultStatus = TicketEnvironmentResult['status'];
export type EvidenceCheckEnvironment = 'local' | 'develop' | 'test' | 'prod' | 'n/a';
export type EvidenceEnvironment = Exclude<EvidenceCheckEnvironment, 'n/a'>;

export const EVIDENCE_NOTE_KIND_OPTIONS: EvidenceCommandOption<EvidenceNoteKind>[] = [
  { label: 'note', description: 'General implementation or review note' },
  { label: 'test', description: 'Verification command, result, or environment proof' },
  { label: 'risk', description: 'Known risk, gap, or follow-up to preserve' },
  { label: 'decision', description: 'Architecture or product decision made during work' },
];

export const EVIDENCE_CHECK_RESULT_OPTIONS: EvidenceCommandOption<EvidenceCheckResult>[] = [
  { label: 'pass', description: 'Check passed' },
  { label: 'warn', description: 'Check has caveats or partial coverage' },
  { label: 'fail', description: 'Check failed and should block handoff' },
  { label: 'unknown', description: 'Result is inconclusive' },
];

export const EVIDENCE_CHECK_ENVIRONMENT_OPTIONS: EvidenceCommandOption<EvidenceCheckEnvironment>[] = [
  { label: 'local' },
  { label: 'develop' },
  { label: 'test' },
  { label: 'prod' },
  { label: 'n/a' },
];

export const EVIDENCE_CHECK_CONFIDENCE_OPTIONS: EvidenceCommandOption<EvidenceCheckConfidence>[] = [
  { label: 'high', description: 'Directly proves the behavior' },
  { label: 'medium', description: 'Useful but partial coverage' },
  { label: 'low', description: 'Weak or indirect signal' },
];

export const EVIDENCE_ENVIRONMENT_OPTIONS: EvidenceCommandOption<EvidenceEnvironment>[] = [
  { label: 'local' },
  { label: 'develop' },
  { label: 'test' },
  { label: 'prod' },
];

export const EVIDENCE_ENVIRONMENT_RESULT_OPTIONS: EvidenceCommandOption<EvidenceEnvironmentResultStatus>[] = [
  { label: 'pass', description: 'Environment check passed' },
  { label: 'warn', description: 'Environment check has caveats' },
  { label: 'fail', description: 'Environment check failed' },
  { label: 'unknown', description: 'Environment state is unknown' },
];

export interface EvidenceCheckPromptInput {
  name: string;
  result: EvidenceCheckResult;
  environment: EvidenceCheckEnvironment;
  command: string;
  summary: string;
  artifactPath: string;
  confidence: EvidenceCheckConfidence;
}

export interface EvidenceEnvironmentResultPromptInput {
  environment: EvidenceEnvironment;
  status: EvidenceEnvironmentResultStatus;
  detail: string;
  artifactPath: string;
}

export function buildTicketEvidenceCheckInput(input: EvidenceCheckPromptInput): TicketEvidenceCheckInput {
  const evidenceCheck: TicketEvidenceCheckInput = {
    name: input.name.trim(),
    result: input.result,
    command: input.command,
    summary: input.summary,
    artifactPath: input.artifactPath,
    confidence: input.confidence,
  };
  if (input.environment !== 'n/a') { evidenceCheck.environment = input.environment; }
  return evidenceCheck;
}

export function buildTicketEnvironmentResultInput(input: EvidenceEnvironmentResultPromptInput): {
  environment: EvidenceEnvironment;
  status: EvidenceEnvironmentResultStatus;
  detail: string;
  artifactPath: string;
} {
  return {
    environment: input.environment,
    status: input.status,
    detail: input.detail.trim(),
    artifactPath: input.artifactPath,
  };
}
