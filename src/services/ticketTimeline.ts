import { QueueState, Ticket } from '../state/types';
import { evidenceChecks, evidenceEnvironmentResults, evidenceNotes, evidenceString } from './evidenceData';

export type TimelineSource = 'jira' | 'queue' | 'run' | 'evidence' | 'mr' | 'build' | 'ticket';
export type TimelineSeverity = 'info' | 'success' | 'warning' | 'failure';

export interface TimelineRun {
  id: string;
  ticket?: string;
  project?: string;
  skill?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  failureReason?: string;
  model?: string;
  promptHash?: string;
  worktreePath?: string;
  logPath?: string;
}

export interface TimelineEvent {
  id: string;
  at?: string;
  source: TimelineSource;
  severity: TimelineSeverity;
  title: string;
  detail: string;
  url?: string;
  artifactPath?: string;
}

export interface TicketTimelineInput {
  ticketKey: string;
  ticket: Ticket;
  queue?: QueueState | null;
  runs?: TimelineRun[];
}
type TimelineRunRecord = TimelineRun & Record<string, any>;

export function buildTicketTimeline(input: TicketTimelineInput): TimelineEvent[] {
  const { ticketKey, ticket } = input;
  const events: TimelineEvent[] = [];
  const runs = (Array.isArray(input.runs) ? input.runs : []).filter(isRunRecord);

  if (ticket.updated) {
    events.push({
      id: `${ticketKey}:jira-updated`,
      at: ticket.updated,
      source: 'jira',
      severity: 'info',
      title: `Jira status: ${ticket.jira_status}`,
      detail: ticket.summary,
      url: ticket.jira_url,
    });
  }

  if (ticket.last_action_at || ticket.last_action) {
    events.push({
      id: `${ticketKey}:last-action`,
      at: ticket.last_action_at || undefined,
      source: 'ticket',
      severity: severityForAction(ticket.next_action),
      title: `Kronos action: ${ticket.last_action || ticket.next_action}`,
      detail: `Next action is ${ticket.next_action}`,
    });
  }

  const queuedItems = (input.queue?.items || []).filter(item => item.ticket === ticketKey);
  for (const item of queuedItems) {
    events.push({
      id: `${ticketKey}:queue:${item.id}`,
      at: input.queue?.last_computed || undefined,
      source: 'queue',
      severity: 'info',
      title: `Queued: ${item.action}`,
      detail: `${item.reason || 'No reason recorded'} (score ${item.priority_score})`,
    });
  }

  const notes = evidenceNotes(ticket);
  for (const [idx, note] of notes.entries()) {
    const kind = evidenceString(note, 'kind', 'note');
    events.push({
      id: `${ticketKey}:evidence:${idx}`,
      at: evidenceString(note, 'at') || undefined,
      source: 'evidence',
      severity: kind === 'risk' ? 'warning' : kind === 'test' ? 'success' : 'info',
      title: `${kind} evidence`,
      detail: evidenceString(note, 'text'),
    });
  }

  const checks = evidenceChecks(ticket);
  for (const [idx, check] of checks.entries()) {
    const result = evidenceString(check, 'result', 'unknown');
    const environment = evidenceString(check, 'environment');
    const summary = evidenceString(check, 'summary');
    const command = evidenceString(check, 'command');
    events.push({
      id: `${ticketKey}:evidence-check:${evidenceString(check, 'id') || idx}`,
      at: evidenceString(check, 'at') || undefined,
      source: 'evidence',
      severity: result === 'fail' ? 'failure' : result === 'pass' ? 'success' : 'warning',
      title: `Evidence check: ${evidenceString(check, 'name', 'Unnamed check')}`,
      detail: [
        `Result: ${result}`,
        environment ? `Environment: ${environment}` : '',
        summary,
        command ? `Command: ${command}` : '',
      ].filter(Boolean).join('\n'),
      url: evidenceString(check, 'artifact_path') || undefined,
    });
  }

  const environmentResults = evidenceEnvironmentResults(ticket);
  for (const result of environmentResults) {
    const environment = evidenceString(result, 'environment', 'environment');
    const status = evidenceString(result, 'status', 'unknown');
    events.push({
      id: `${ticketKey}:environment:${environment}`,
      at: evidenceString(result, 'checked_at') || undefined,
      source: 'evidence',
      severity: status === 'fail' ? 'failure' : status === 'pass' ? 'success' : 'warning',
      title: `Environment ${environment}: ${status}`,
      detail: evidenceString(result, 'detail'),
      url: evidenceString(result, 'artifact_path') || undefined,
    });
  }

  if (ticket.mr) {
    events.push({
      id: `${ticketKey}:mr:${ticket.mr.iid}`,
      at: ticket.updated || ticket.last_action_at || undefined,
      source: 'mr',
      severity: ticket.mr.review_status === 'changes_requested' ? 'failure' : ticket.mr.review_status === 'approved' ? 'success' : 'warning',
      title: `MR !${ticket.mr.iid}: ${ticket.mr.state}`,
      detail: ticket.mr.review_status.replace(/_/g, ' '),
      url: ticket.mr.url,
    });
  }

  if (ticket.build) {
    events.push({
      id: `${ticketKey}:build:${ticket.build.number}`,
      at: ticket.updated || ticket.last_action_at || undefined,
      source: 'build',
      severity: severityForBuild(ticket.build.status),
      title: `Build #${ticket.build.number}: ${ticket.build.status}`,
      detail: ticket.build.url || '',
      url: ticket.build.url,
    });
  }

  for (const run of runs.filter(r => runString(r, 'ticket') === ticketKey)) {
    const status = runString(run, 'status') || 'unknown';
    events.push({
      id: `${ticketKey}:run:${runId(run)}`,
      at: runString(run, 'endedAt') || runString(run, 'startedAt') || undefined,
      source: 'run',
      severity: severityForRun(status),
      title: `Run ${status}: ${runString(run, 'skill') || 'session'}`,
      detail: runDetail(run),
      artifactPath: runString(run, 'logPath') || undefined,
    });
  }

  return events.sort(compareTimelineEvents);
}

function compareTimelineEvents(a: TimelineEvent, b: TimelineEvent): number {
  const atA = timestampValue(a.at);
  const atB = timestampValue(b.at);
  if (atA !== atB) { return atB - atA; }
  return a.id.localeCompare(b.id);
}

function timestampValue(value: string | undefined): number {
  if (!value) { return 0; }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function severityForAction(action: string): TimelineSeverity {
  if (action === 'blocked' || action === 'fix_build') { return 'failure'; }
  if (action === 'await_review' || action === 'verify' || action === 'deploy_monitor') { return 'warning'; }
  if (action === 'done') { return 'success'; }
  return 'info';
}

function severityForBuild(status: string): TimelineSeverity {
  const upper = status.toUpperCase();
  if (upper === 'SUCCESS' || upper === 'PASSED') { return 'success'; }
  if (upper === 'FAILURE' || upper === 'FAILED' || upper === 'ERROR') { return 'failure'; }
  return 'warning';
}

function severityForRun(status: string | undefined): TimelineSeverity {
  if (status === 'completed' || status === 'waiting_for_review') { return 'success'; }
  if (status === 'failed' || status === 'needs_human') { return 'failure'; }
  if (status === 'cancelled' || status === 'running' || status === 'preflight') { return 'warning'; }
  return 'info';
}

function runDetail(run: TimelineRunRecord): string {
  const promptHash = runString(run, 'promptHash');
  const parts = [
    runString(run, 'failureReason'),
    runString(run, 'project') ? `project ${runString(run, 'project')}` : '',
    runString(run, 'model') ? `model ${runString(run, 'model')}` : '',
    promptHash ? `prompt ${promptHash.substring(0, 12)}` : '',
    runString(run, 'worktreePath') ? `worktree ${runString(run, 'worktreePath')}` : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

function runId(run: TimelineRunRecord): string {
  return runString(run, 'id') || 'run';
}

function runString(run: TimelineRunRecord, key: string): string {
  const value = run[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isRunRecord(value: unknown): value is TimelineRunRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
