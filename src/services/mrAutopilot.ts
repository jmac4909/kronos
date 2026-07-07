import type { KronosState as KronosStateSnapshot, Project, QueueState, Ticket } from '../state/types';
import { isFailingBuildStatus, isPassingBuildStatus } from './buildStatus';
import { countLabel } from './countLabels';
import { evaluateEvidenceGates } from './evidenceGate';
import { recordString } from './records';
import { runLikeRecordsFromUnknown } from './runRecords';
import { isFreshActiveRun } from './runStatus';
import { ticketStringArray } from './ticketFields';

export type MrAutopilotCandidateStatus = 'ready' | 'watching' | 'attention' | 'blocked' | 'done';
export type MrAutopilotPassStepStatus = 'ready' | 'blocked' | 'watching' | 'done';
export type MrAutopilotRecommendedAction = 'poll' | 'startTicket' | 'evidenceGate' | 'runCenter' | 'humanReview';

export interface MrAutopilotPassStep {
  label: string;
  detail: string;
  status: MrAutopilotPassStepStatus;
  count: number;
}

export interface MrAutopilotCandidate {
  ticketKey: string;
  title: string;
  detail: string;
  status: MrAutopilotCandidateStatus;
  projectNames: string[];
  mrIid?: number | undefined;
  reviewStatus?: string | undefined;
  evidenceStatus?: string | undefined;
  buildStatus?: string | undefined;
  runId?: string | undefined;
  pollEligible: boolean;
  blockers: string[];
  preflight: string[];
  lastSignalAt?: string | undefined;
  recommendedAction: MrAutopilotRecommendedAction;
}

export interface MrAutopilotPlan {
  status: 'idle' | 'ready' | 'attention' | 'blocked';
  summary: string;
  nextStep: string;
  pollEligibleCount: number;
  mutationBlockedCount: number;
  safePass: string[];
  recommendedPass: MrAutopilotPassStep[];
  candidates: MrAutopilotCandidate[];
}

export interface MrAutopilotPlanInput {
  state: KronosStateSnapshot | null;
  queue: QueueState | null;
  runs: unknown[];
}

export function buildMrAutopilotPlan(input: MrAutopilotPlanInput): MrAutopilotPlan {
  const tickets = input.state?.tickets || {};
  const gates = new Map(evaluateEvidenceGates(tickets).map(gate => [gate.ticketKey, gate]));
  const runs = runLikeRecordsFromUnknown(input.runs);
  const activeRunByTicket = new Map<string, string>();
  for (const run of runs.filter(run => isFreshActiveRun(run))) {
    const ticketKey = recordString(run, 'ticket');
    const runId = recordString(run, 'id');
    if (ticketKey && runId && !activeRunByTicket.has(ticketKey)) {
      activeRunByTicket.set(ticketKey, runId);
    }
  }
  const queuedTickets = new Set((input.queue?.items || []).map(item => item.ticket).filter((ticket): ticket is string => Boolean(ticket)));
  const candidates = Object.entries(tickets)
    .filter(([, ticket]) => Boolean(ticket.mr))
    .map(([ticketKey, ticket]) => buildMrAutopilotCandidate(ticketKey, ticket, {
      evidenceStatus: gates.get(ticketKey)?.status,
      queued: queuedTickets.has(ticketKey),
      runId: activeRunByTicket.get(ticketKey),
      projects: input.state?.projects || {},
    }))
    .sort(sortCandidates);
  const attention = candidates.filter(candidate => candidate.status === 'attention').length;
  const blocked = candidates.filter(candidate => candidate.status === 'blocked').length;
  const ready = candidates.filter(candidate => candidate.status === 'ready').length;
  const watching = candidates.filter(candidate => candidate.status === 'watching').length;
  const pollEligibleCount = candidates.filter(candidate => candidate.pollEligible).length;
  const mutationBlockedCount = candidates.filter(candidate => candidate.blockers.length > 0).length;
  const recommendedPass = buildRecommendedPass(candidates);
  const status = attention > 0 ? 'attention' : blocked > 0 ? 'blocked' : ready > 0 ? 'ready' : candidates.length > 0 ? 'idle' : 'blocked';
  const nextStep = nextAutopilotStep(candidates, pollEligibleCount, mutationBlockedCount);
  const safePass = [
    `Poll ${countLabel(pollEligibleCount, 'eligible MR')} using project ID plus MR IID.`,
    'Refresh ticket MR review state, comments, discussion counts, branch metadata, and build state.',
    `Classify ${countLabel(attention + blocked, 'blocker')} before dispatching implementation work.`,
    'Start implementation or fix work only from an explicit operator action on a specific ticket.',
  ];
  return {
    status,
    summary: candidates.length === 0
      ? 'No linked merge requests are present in Kronos state.'
      : `${countLabel(ready, 'ready MR')}, ${countLabel(watching, 'watched MR')}, ${countLabel(attention, 'attention item')}, ${countLabel(blocked, 'blocked MR')} from ${countLabel(candidates.length, 'linked MR')}.`,
    nextStep,
    pollEligibleCount,
    mutationBlockedCount,
    safePass,
    recommendedPass,
    candidates,
  };
}

function buildMrAutopilotCandidate(
  ticketKey: string,
  ticket: Ticket,
  context: { evidenceStatus?: string | undefined; queued: boolean; runId?: string | undefined; projects: Record<string, Project> },
): MrAutopilotCandidate {
  const mr = ticket.mr;
  const projectNames = ticketStringArray(ticket.projects);
  const reviewStatus = mr?.review_status || 'pending_review';
  const buildStatus = ticket.build?.status;
  const evidenceStatus = context.evidenceStatus || 'unknown';
  const unresolved = Number(mr?.unresolved_discussion_count || 0);
  const title = `${ticketKey} ${ticket.summary || mr?.title || 'merge request'}`.trim();
  const lastSignalAt = latestSignalAt(ticket);
  if (!mr) {
    return {
      ticketKey,
      title,
      detail: 'Ticket has no linked MR.',
      status: 'blocked',
      projectNames,
      evidenceStatus,
      buildStatus,
      pollEligible: false,
      blockers: ['Ticket has no linked MR.'],
      preflight: candidatePreflight(projectNames, context.projects, mr, evidenceStatus, buildStatus),
      lastSignalAt,
      recommendedAction: 'humanReview',
    };
  }
  const blockers = mr.state === 'opened' ? pollBlockers(ticket, context.projects) : [];
  const preflight = candidatePreflight(projectNames, context.projects, mr, evidenceStatus, buildStatus);
  if (mr.state === 'closed') {
    return {
      ticketKey,
      title,
      detail: 'MR is closed; choose whether to reopen, supersede, or archive the ticket.',
      status: 'blocked',
      projectNames,
      mrIid: mr.iid,
      reviewStatus,
      evidenceStatus,
      buildStatus,
      pollEligible: false,
      blockers: ['MR is closed.'],
      preflight,
      lastSignalAt,
      recommendedAction: 'humanReview',
    };
  }
  if (blockers.length > 0) {
    return {
      ticketKey,
      title,
      detail: blockers.join(' '),
      status: 'blocked',
      projectNames,
      mrIid: mr.iid,
      reviewStatus,
      evidenceStatus,
      buildStatus,
      pollEligible: false,
      blockers,
      preflight,
      lastSignalAt,
      recommendedAction: 'humanReview',
    };
  }
  if (mr.state === 'merged') {
    return {
      ticketKey,
      title,
      detail: 'MR is merged; confirm evidence and archive completed run records.',
      status: evidenceStatus === 'fail' ? 'attention' : 'done',
      projectNames,
      mrIid: mr.iid,
      reviewStatus,
      evidenceStatus,
      buildStatus,
      pollEligible: false,
      blockers: [],
      preflight,
      lastSignalAt,
      recommendedAction: evidenceStatus === 'fail' ? 'evidenceGate' : 'poll',
    };
  }
  if (context.runId) {
    return {
      ticketKey,
      title,
      detail: 'An active Kronos run is already working this ticket.',
      status: 'watching',
      projectNames,
      mrIid: mr.iid,
      reviewStatus,
      evidenceStatus,
      buildStatus,
      runId: context.runId,
      pollEligible: true,
      blockers: [],
      preflight,
      lastSignalAt,
      recommendedAction: 'runCenter',
    };
  }
  if (reviewStatus === 'changes_requested' || unresolved > 0 || isFailingBuildStatus(buildStatus || '') || evidenceStatus === 'fail') {
    const details = [
      reviewStatus === 'changes_requested' ? 'changes requested' : '',
      unresolved > 0 ? `${countLabel(unresolved, 'unresolved discussion')}` : '',
      isFailingBuildStatus(buildStatus || '') ? `build ${buildStatus}` : '',
      evidenceStatus === 'fail' ? 'evidence gate failing' : '',
    ].filter(Boolean).join(', ');
    return {
      ticketKey,
      title,
      detail: details || 'Review attention required.',
      status: 'attention',
      projectNames,
      mrIid: mr.iid,
      reviewStatus,
      evidenceStatus,
      buildStatus,
      pollEligible: true,
      blockers: [],
      preflight,
      lastSignalAt,
      recommendedAction: evidenceStatus === 'fail' ? 'evidenceGate' : 'startTicket',
    };
  }
  if (reviewStatus === 'approved' && isPassingBuildStatus(buildStatus || '') && evidenceStatus !== 'fail') {
    return {
      ticketKey,
      title,
      detail: context.queued ? 'Approved and queued for follow-up.' : 'Approved with passing build; verify evidence and merge state.',
      status: 'ready',
      projectNames,
      mrIid: mr.iid,
      reviewStatus,
      evidenceStatus,
      buildStatus,
      pollEligible: true,
      blockers: [],
      preflight,
      lastSignalAt,
      recommendedAction: evidenceStatus === 'warn' ? 'evidenceGate' : 'poll',
    };
  }
  return {
    ticketKey,
    title,
    detail: context.queued ? 'MR is linked and queued; poll before dispatching more work.' : 'MR is linked; watch review and build signals.',
    status: 'ready',
    projectNames,
    mrIid: mr.iid,
    reviewStatus,
    evidenceStatus,
    buildStatus,
    pollEligible: true,
    blockers: [],
    preflight,
    lastSignalAt,
    recommendedAction: 'poll',
  };
}

function buildRecommendedPass(candidates: MrAutopilotCandidate[]): MrAutopilotPassStep[] {
  const pollEligible = candidates.filter(candidate => candidate.pollEligible).length;
  const blocked = candidates.filter(candidate => candidate.blockers.length > 0).length;
  const attention = candidates.filter(candidate => candidate.status === 'attention').length;
  const evidence = candidates.filter(candidate => candidate.recommendedAction === 'evidenceGate').length;
  const fixable = candidates.filter(candidate => candidate.recommendedAction === 'startTicket').length;
  const active = candidates.filter(candidate => candidate.recommendedAction === 'runCenter').length;
  return [
    {
      label: 'Poll Review State',
      count: pollEligible,
      status: pollEligible > 0 ? 'ready' : blocked > 0 ? 'blocked' : 'done',
      detail: pollEligible > 0
        ? `Refresh ${countLabel(pollEligible, 'MR')} with project ID and IID before reading comments or builds.`
        : blocked > 0 ? 'Add missing project/MR identifiers before polling.' : 'No open MRs need polling.',
    },
    {
      label: 'Classify Blockers',
      count: attention + blocked,
      status: attention + blocked > 0 ? 'blocked' : 'done',
      detail: attention + blocked > 0
        ? `Resolve ${countLabel(attention + blocked, 'review/build/evidence blocker')} before broad dispatch.`
        : 'No blocking review, build, or evidence signals found.',
    },
    {
      label: 'Gate Evidence',
      count: evidence,
      status: evidence > 0 ? 'ready' : 'done',
      detail: evidence > 0
        ? `Open evidence gate for ${countLabel(evidence, 'ticket')} before merge or fix dispatch.`
        : 'No failing or warning evidence gates require action.',
    },
    {
      label: 'Dispatch Fix Work',
      count: fixable,
      status: fixable > 0 ? 'ready' : active > 0 ? 'watching' : 'done',
      detail: fixable > 0
        ? `Start explicit fix work for ${countLabel(fixable, 'ticket')} after polling is current.`
        : active > 0 ? `${countLabel(active, 'ticket')} already has active Kronos work.` : 'No fix dispatch is recommended.',
    },
  ];
}

function nextAutopilotStep(candidates: MrAutopilotCandidate[], pollEligibleCount: number, mutationBlockedCount: number): string {
  if (candidates.length === 0) { return 'Link merge requests to tickets before running Autopilot.'; }
  if (mutationBlockedCount > 0) { return 'Resolve missing project or MR identifiers, then run a safe polling pass.'; }
  if (pollEligibleCount > 0) { return 'Run Safe Pass to refresh open MR, review, discussion, branch, and build signals.'; }
  const evidenceTicket = candidates.find(candidate => candidate.recommendedAction === 'evidenceGate');
  if (evidenceTicket) { return `Open the evidence gate for ${evidenceTicket.ticketKey}.`; }
  const fixTicket = candidates.find(candidate => candidate.recommendedAction === 'startTicket');
  if (fixTicket) { return `Start an explicit fix pass for ${fixTicket.ticketKey}.`; }
  const activeTicket = candidates.find(candidate => candidate.recommendedAction === 'runCenter');
  if (activeTicket) { return `Watch active run ${activeTicket.runId || ''} for ${activeTicket.ticketKey}.`.trim(); }
  return 'Continue watching linked MRs; no mutation is recommended.';
}

function pollBlockers(ticket: Ticket, projects: Record<string, Project>): string[] {
  const mr = ticket.mr;
  const projectNames = ticketStringArray(ticket.projects);
  const blockers: string[] = [];
  if (!mr?.iid) { blockers.push('Missing MR IID.'); }
  if (projectNames.length === 0) {
    blockers.push('Ticket has no project link.');
    return blockers;
  }
  const missingProjects = projectNames.filter(projectName => !projects[projectName]);
  if (missingProjects.length > 0) {
    blockers.push(`Unknown project ${missingProjects.join(', ')}.`);
  }
  const projectsWithGitlabIds = projectNames.filter(projectName => Boolean(projects[projectName]?.config?.gitlab_project_id));
  if (projectsWithGitlabIds.length === 0) {
    blockers.push('No linked project has gitlab_project_id.');
  }
  return blockers;
}

function candidatePreflight(projectNames: string[], projects: Record<string, Project>, mr: Ticket['mr'], evidenceStatus: string, buildStatus: string | undefined): string[] {
  const gitlabProjects = projectNames.filter(projectName => Boolean(projects[projectName]?.config?.gitlab_project_id));
  return [
    projectNames.length > 0 ? `Project scope: ${projectNames.join(', ')}` : 'Assign project scope before polling.',
    mr?.iid ? `MR IID: !${mr.iid}` : 'Capture MR IID before polling.',
    gitlabProjects.length > 0 ? `GitLab project ID available for ${gitlabProjects.join(', ')}` : 'Set gitlab_project_id on at least one linked project.',
    `Evidence gate: ${evidenceStatus}`,
    buildStatus ? `Build: ${buildStatus}` : 'Build: unknown',
  ];
}

function latestSignalAt(ticket: Ticket): string | undefined {
  const candidates = [
    ticket.updated,
    ticket.last_action_at,
    ticket.evidence?.updated_at,
    ticket.mr?.last_comment_at,
    ticket.mr?.last_discussion_at,
  ].filter((value): value is string => Boolean(value));
  const sorted = candidates.sort();
  return sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
}

function sortCandidates(a: MrAutopilotCandidate, b: MrAutopilotCandidate): number {
  return statusRank(a.status) - statusRank(b.status) || a.ticketKey.localeCompare(b.ticketKey);
}

function statusRank(status: MrAutopilotCandidateStatus): number {
  if (status === 'attention') { return 0; }
  if (status === 'blocked') { return 1; }
  if (status === 'watching') { return 2; }
  if (status === 'ready') { return 3; }
  return 4;
}
