import { Ticket } from '../state/types';
import { EvidenceGateResult, evaluateEvidenceGate } from './evidenceGate';

export type PostRunReadinessStatus = 'ready' | 'needs_human' | 'blocked' | 'not_ready' | 'unknown';
export type RunFailureKind = 'none' | 'auth' | 'model' | 'script' | 'git' | 'build' | 'test' | 'sonar' | 'timeout' | 'cancelled' | 'unknown';

export interface PostRunReadiness {
  evaluatedAt: string;
  ticketKey?: string;
  status: PostRunReadinessStatus;
  summary: string;
  nextAction?: string;
  evidenceGate?: {
    status: EvidenceGateResult['status'];
    summary: string;
    failing: number;
    warnings: number;
  };
  failureKind: RunFailureKind;
}

const HANDOFF_ACTIONS = new Set(['await_review', 'verify', 'deploy_monitor', 'done']);
const SUCCESS_RUN_STATUSES = new Set(['completed', 'waiting_for_review']);

export function evaluatePostRunReadiness(input: {
  run: any;
  ticketKey?: string;
  ticket?: Ticket;
  now?: Date;
}): PostRunReadiness {
  const now = input.now || new Date();
  const failureKind = classifyRunFailure(input.run);
  if (!input.ticketKey || !input.ticket) {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: SUCCESS_RUN_STATUSES.has(input.run?.status) ? 'unknown' : 'blocked',
      summary: SUCCESS_RUN_STATUSES.has(input.run?.status)
        ? 'Run completed, but no ticket state was available for readiness evaluation.'
        : `Run did not complete cleanly (${failureKind}).`,
      failureKind,
    };
  }

  const gate = evaluateEvidenceGate(input.ticketKey, input.ticket);
  const failing = gate.checks.filter(check => check.status === 'fail').length;
  const warnings = gate.checks.filter(check => check.status === 'warn').length;
  const gateSummary = {
    status: gate.status,
    summary: gate.summary,
    failing,
    warnings,
  };

  if (!SUCCESS_RUN_STATUSES.has(input.run?.status)) {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: 'blocked',
      summary: `Run ended as ${input.run?.status || 'unknown'} (${failureKind}); ticket gate is ${gate.status}.`,
      nextAction: input.ticket.next_action,
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  if (!HANDOFF_ACTIONS.has(input.ticket.next_action)) {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: 'not_ready',
      summary: `Run completed, but ticket next action is still ${input.ticket.next_action}.`,
      nextAction: input.ticket.next_action,
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  if (gate.status === 'fail') {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: 'blocked',
      summary: `Run completed, but evidence gate is failing: ${gate.summary}.`,
      nextAction: input.ticket.next_action,
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  if (gate.status === 'warn') {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: 'needs_human',
      summary: `Run completed and ticket is in handoff state, but evidence gate has warnings: ${gate.summary}.`,
      nextAction: input.ticket.next_action,
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  return {
    evaluatedAt: now.toISOString(),
    ticketKey: input.ticketKey,
    status: 'ready',
    summary: `Run completed and evidence gate is passing for ${input.ticket.next_action}.`,
    nextAction: input.ticket.next_action,
    evidenceGate: gateSummary,
    failureKind,
  };
}

export function classifyRunFailure(run: any): RunFailureKind {
  if (!run) { return 'unknown'; }
  if (SUCCESS_RUN_STATUSES.has(run.status)) { return 'none'; }
  if (run.status === 'cancelled') { return 'cancelled'; }
  const skill = String(run.skill || '').toLowerCase();
  const exitCode = Number(run.exitCode);
  const text = [
    run.failureReason,
    run.error,
    ...(Array.isArray(run.events) ? run.events.flatMap((event: any) => [event.label, event.detail]) : []),
  ].filter(Boolean).join('\n').toLowerCase();

  if (/cancelled|canceled|operator stopped|progress panel disposed/.test(text)) { return 'cancelled'; }
  if (/auth|credential|permission denied|unauthorized|forbidden|gcloud/.test(text)) { return 'auth'; }
  if (/model|quota|rate limit|context length/.test(text)) { return 'model'; }
  if (exitCode === 124 || /timeout|timed out|deadline/.test(text)) { return 'timeout'; }
  if (/script|invalid json|kronos script missing|python|claude cli|spawn|enoent|command not found/.test(text)) { return 'script'; }
  if (/\bgit\b|merge conflict|worktree|checkout|branch/.test(text)) { return 'git'; }
  if (/sonar|quality gate/.test(text)) { return 'sonar'; }
  if (/build|jenkins|maven|gradle|compile/.test(text)) { return 'build'; }
  if (/test|spec|assert|jest|pytest|junit/.test(text)) { return 'test'; }
  if (skill.includes('sonar')) { return 'sonar'; }
  if (skill.includes('build') || skill === 'fix_build') { return 'build'; }
  if (skill.includes('verify') || skill.includes('test')) { return 'test'; }
  return run.status === 'failed' || run.status === 'needs_human' ? 'unknown' : 'none';
}
