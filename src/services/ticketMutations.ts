import {
  KronosState,
  MergeRequest,
  Ticket,
  TicketAcceptanceCriterion,
  TicketEvidence,
  TicketEvidenceCheck,
  TicketEvidenceNote,
  TicketEnvironmentResult,
} from '../state/types';
import { STATE_FILE, readStateFile, validateStateFileShape, writeJsonFileAtomic } from './stateStore';
import { setAcceptanceCriteriaChecked } from './acceptanceCriteria';
import { decideEvidenceHandoff } from './evidenceGatePolicy';

export type EvidenceNoteKind = TicketEvidenceNote['kind'];
export type EvidenceResult = TicketEvidenceCheck['result'];
export type EvidenceConfidence = NonNullable<TicketEvidenceCheck['confidence']>;

export interface TicketEvidenceNoteInput {
  kind: EvidenceNoteKind;
  text: string;
  now?: Date;
}

export interface TicketEvidenceCheckInput {
  name: string;
  result: EvidenceResult;
  environment?: string;
  command?: string;
  summary?: string;
  artifactPath?: string;
  confidence: EvidenceConfidence;
  now?: Date;
}

export interface TicketEnvironmentResultInput {
  environment: string;
  status: TicketEnvironmentResult['status'];
  detail: string;
  artifactPath?: string;
  now?: Date;
}

export interface LinkMergeRequestInput {
  orphanKey: string;
  targetTicketKey: string;
  jiraBaseUrl?: string;
  allowReviewHandoffWithWarnings?: boolean;
}

export interface LinkMergeRequestPreview {
  orphanKey: string;
  targetTicketKey: string;
  ticket: Ticket;
  removesOrphan: boolean;
  reviewReady: boolean;
}

export function addTicketEvidenceNote(ticketKey: string, input: TicketEvidenceNoteInput): KronosState {
  return mutateState('add-ticket-evidence', state => {
    const ticket = requireTicket(state, ticketKey);
    const evidence = ensureEvidence(ticket);
    const at = isoNow(input.now);
    if (!Array.isArray(evidence.notes)) {
      evidence.notes = [];
    }
    evidence.notes.push({ at, kind: input.kind, text: input.text.trim() });
    if (input.kind === 'risk') {
      if (!Array.isArray(evidence.risk_notes)) {
        evidence.risk_notes = [];
      }
      evidence.risk_notes.push({ at, text: input.text.trim(), severity: 'medium' });
    }
    evidence.updated_at = at;
  });
}

export function addTicketEvidenceCheck(ticketKey: string, input: TicketEvidenceCheckInput): KronosState {
  return mutateState('add-evidence-check', state => {
    const ticket = requireTicket(state, ticketKey);
    const evidence = ensureEvidence(ticket);
    const at = isoNow(input.now);
    if (!Array.isArray(evidence.checks)) {
      evidence.checks = [];
    }
    evidence.checks.push({
      id: `check-${at.replace(/[^0-9]/g, '')}`,
      at,
      name: input.name.trim(),
      result: input.result,
      environment: optionalTrim(input.environment),
      command: optionalTrim(input.command),
      summary: optionalTrim(input.summary),
      artifact_path: optionalTrim(input.artifactPath),
      confidence: input.confidence,
    });
    evidence.updated_at = at;
  });
}

export function recordTicketEnvironmentResult(ticketKey: string, input: TicketEnvironmentResultInput): KronosState {
  return mutateState('record-environment-result', state => {
    const ticket = requireTicket(state, ticketKey);
    const evidence = ensureEvidence(ticket);
    const at = isoNow(input.now);
    if (!evidence.environment_results || typeof evidence.environment_results !== 'object' || Array.isArray(evidence.environment_results)) {
      evidence.environment_results = {};
    }
    evidence.environment_results[input.environment] = {
      environment: input.environment,
      status: input.status,
      checked_at: at,
      detail: input.detail.trim(),
      artifact_path: optionalTrim(input.artifactPath),
    };
    evidence.updated_at = at;
  });
}

export function replaceTicketAcceptanceCriteria(
  ticketKey: string,
  criteria: TicketAcceptanceCriterion[],
  now = new Date(),
): KronosState {
  return mutateState('extract-acceptance-criteria', state => {
    const ticket = requireTicket(state, ticketKey);
    const evidence = ensureEvidence(ticket);
    evidence.acceptance_criteria = criteria;
    evidence.updated_at = isoNow(now);
  });
}

export function updateTicketAcceptanceCriteria(
  ticketKey: string,
  checkedIds: string[],
  now = new Date(),
): KronosState {
  return mutateState('update-acceptance-criteria', state => {
    const ticket = requireTicket(state, ticketKey);
    const evidence = ensureEvidence(ticket);
    if (!Array.isArray(evidence.acceptance_criteria)) {
      throw new Error(`${ticketKey} has no acceptance criteria.`);
    }
    evidence.acceptance_criteria = setAcceptanceCriteriaChecked(evidence.acceptance_criteria, checkedIds);
    evidence.updated_at = isoNow(now);
  });
}

export function linkMergeRequestToTicket(input: LinkMergeRequestInput): KronosState {
  return mutateState('link-mr-to-ticket', state => {
    const preview = previewLinkMergeRequestToTicket(state, input);
    if (preview.reviewReady) {
      const handoffDecision = decideEvidenceHandoff(input.targetTicketKey, preview.ticket);
      if (!handoffDecision.allowed) {
        throw new Error(handoffDecision.message);
      }
      if (handoffDecision.requiresConfirmation && !input.allowReviewHandoffWithWarnings) {
        throw new Error(`${handoffDecision.message}. Pass allowReviewHandoffWithWarnings after explicit operator confirmation.`);
      }
    }
    state.tickets[input.targetTicketKey] = preview.ticket;

    if (input.orphanKey !== input.targetTicketKey) {
      delete state.tickets[input.orphanKey];
    }
  });
}

export function previewLinkMergeRequestToTicket(state: KronosState, input: LinkMergeRequestInput): LinkMergeRequestPreview {
  const orphan = state.tickets[input.orphanKey];
  if (!orphan) {
    throw new Error(`${input.orphanKey} no longer exists in state.json.`);
  }
  if (!orphan.mr) {
    throw new Error(`${input.orphanKey} has no merge request to link.`);
  }

  const target = state.tickets[input.targetTicketKey];
  const ticket = target
    ? cloneTicket(target)
    : {
        ...cloneTicket(orphan),
        jira_url: `${(input.jiraBaseUrl || 'https://bcbsma.atlassian.net').replace(/\/+$/, '')}/browse/${input.targetTicketKey}`,
      };
  attachMergeRequest(ticket, cloneTicket(orphan), orphan.mr);

  return {
    orphanKey: input.orphanKey,
    targetTicketKey: input.targetTicketKey,
    ticket,
    removesOrphan: input.orphanKey !== input.targetTicketKey,
    reviewReady: ['await_review', 'verify', 'deploy_monitor', 'done'].includes(ticket.next_action),
  };
}

function mutateState(action: string, mutate: (state: KronosState) => void): KronosState {
  const state = readStateFile();
  if (!state) {
    throw new Error('No readable Kronos state found.');
  }
  validateStateFileShape(state);
  mutate(state);
  validateStateFileShape(state);
  writeJsonFileAtomic(STATE_FILE, state, action);
  return state;
}

function cloneTicket(ticket: Ticket): Ticket {
  return JSON.parse(JSON.stringify(ticket));
}

function requireTicket(state: KronosState, ticketKey: string): Ticket {
  const ticket = state.tickets[ticketKey];
  if (!ticket) {
    throw new Error(`${ticketKey} no longer exists in state.json.`);
  }
  return ticket;
}

function ensureEvidence(ticket: Ticket): TicketEvidence {
  if (!ticket.evidence || typeof ticket.evidence !== 'object') {
    ticket.evidence = {};
  }
  return ticket.evidence;
}

function attachMergeRequest(target: Ticket, orphan: Ticket, mr: MergeRequest): void {
  target.mr = mr;
  if (target.next_action === 'implement' || target.next_action === 'in_progress') {
    target.next_action = 'await_review';
  }
  for (const project of orphan.projects || []) {
    if (!target.projects.includes(project)) {
      target.projects.push(project);
    }
  }
}

function optionalTrim(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function isoNow(now: Date | undefined): string {
  return (now || new Date()).toISOString();
}
