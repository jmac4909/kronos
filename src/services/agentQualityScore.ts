import { Ticket } from '../state/types';
import { isReviewReadyAction } from './actionSemantics';
import { isFailingBuildStatus, isPassingBuildStatus } from './buildStatus';
import { evaluateEvidenceGates } from './evidenceGate';
import { isActiveRun, isFailedOrCancelledRunStatus, isSuccessfulRunStatus } from './runStatus';
import { definedValues, recordString } from './records';
import { hasRetryMetadata, runLikeRecordsFromUnknown } from './runRecords';
import { countLabel } from './countLabels';
import { runAttentionLine, runAttentionSummary, type RunAttentionSummary } from './runAttention';

interface QualityComponent {
  label: string;
  score: number;
  max: number;
  detail: string;
}

interface QualityMetric {
  label: string;
  value: string;
}

export interface AgentQualityFailureTheme {
  label: string;
  count: number;
  detail: string;
  severity: 'critical' | 'warning' | 'info';
  sampleRunId?: string | undefined;
}

export interface AgentQualityScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
  components: QualityComponent[];
  metrics: QualityMetric[];
  failureThemes: AgentQualityFailureTheme[];
}

export function computeAgentQualityScore(input: {
  runs: unknown[];
  tickets: Record<string, Ticket>;
}): AgentQualityScore {
  const runs = runLikeRecordsFromUnknown(input.runs);
  const tickets = input.tickets || {};
  const totalRuns = runs.length;
  const completedRuns = runs.filter(run => isSuccessfulRunStatus(recordString(run, 'status'))).length;
  const failedRuns = runs.filter(run => isFailedOrCancelledRunStatus(recordString(run, 'status'))).length;
  const needsHumanRuns = runs.filter(run => recordString(run, 'status') === 'needs_human').length;
  const retryRuns = runs.filter(hasRetryMetadata).length;
  const activeRuns = runs.filter(isActiveRun).length;
  const failureThemes = buildFailureThemes(runs);

  const gates = evaluateEvidenceGates(tickets);
  const reviewRelevantGates = gates.filter(gate => {
    const action = tickets[gate.ticketKey]?.next_action;
    return isReviewReadyAction(action);
  });
  const gatePasses = reviewRelevantGates.filter(gate => gate.status === 'pass').length;
  const gateFailures = reviewRelevantGates.filter(gate => gate.status === 'fail').length;
  const gateWarnings = reviewRelevantGates.filter(gate => gate.status === 'warn').length;

  const ticketList = Object.values(tickets);
  const builds = definedValues(ticketList.map(ticket => ticket.build));
  const failedBuilds = builds.filter(build => isFailingBuildStatus(build.status)).length;
  const successfulBuilds = builds.filter(build => isPassingBuildStatus(build.status)).length;
  const mrs = definedValues(ticketList.map(ticket => ticket.mr));
  const approvedMrs = mrs.filter(mr => mr.review_status === 'approved').length;
  const changesRequestedMrs = mrs.filter(mr => mr.review_status === 'changes_requested').length;

  const components: QualityComponent[] = [
    {
      label: 'Run completion',
      max: 25,
      score: proportionalScore(completedRuns, totalRuns, 25),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${completedRuns}/${countLabel(totalRuns, 'run')} completed.`,
    },
    {
      label: 'Low run failure',
      max: 20,
      score: inverseProportionalScore(failedRuns, totalRuns, 20),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${failedRuns}/${countLabel(totalRuns, 'run')} failed or were cancelled.`,
    },
    {
      label: 'Low manual intervention',
      max: 15,
      score: inverseProportionalScore(needsHumanRuns, totalRuns, 15),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${needsHumanRuns}/${countLabel(totalRuns, 'run')} need human recovery.`,
    },
    {
      label: 'Evidence readiness',
      max: 20,
      score: evidenceReadinessScore(gatePasses, gateWarnings, gateFailures, reviewRelevantGates.length),
      detail: reviewRelevantGates.length === 0 ? 'No review-ready tickets yet.' : `${countLabel(gatePasses, 'passing evidence gate')}, ${countLabel(gateWarnings, 'warning evidence gate')}, ${countLabel(gateFailures, 'failing evidence gate')}.`,
    },
    {
      label: 'Build and review health',
      max: 15,
      score: buildReviewScore(successfulBuilds, failedBuilds, approvedMrs, changesRequestedMrs),
      detail: `${countLabel(successfulBuilds, 'successful build')}, ${countLabel(failedBuilds, 'failed build')}, ${countLabel(approvedMrs, 'approved MR')}, ${countLabel(changesRequestedMrs, 'change-requested MR')}.`,
    },
    {
      label: 'Retry discipline',
      max: 5,
      score: inverseProportionalScore(retryRuns, totalRuns, 5),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${retryRuns}/${countLabel(totalRuns, 'run')} are retries.`,
    },
  ];

  const score = Math.max(0, Math.min(100, Math.round(components.reduce((sum, component) => sum + component.score, 0))));
  return {
    score,
    grade: gradeForScore(score),
    summary: `${score}/100 (${gradeForScore(score)}) - ${completedRuns}/${countLabel(totalRuns, 'run')} completed, ${countLabel(gateFailures, 'failing evidence gate')}, ${countLabel(needsHumanRuns, 'needs-human run')}.`,
    components,
    metrics: [
      { label: 'Runs', value: String(totalRuns) },
      { label: 'Active runs', value: String(activeRuns) },
      { label: 'Completed', value: String(completedRuns) },
      { label: 'Failed/cancelled', value: String(failedRuns) },
      { label: 'Needs human', value: String(needsHumanRuns) },
      { label: 'Retries', value: String(retryRuns) },
      { label: 'Evidence gate failures', value: String(gateFailures) },
      { label: 'Evidence gate warnings', value: String(gateWarnings) },
      { label: 'Failed builds', value: String(failedBuilds) },
      { label: 'Changes requested MRs', value: String(changesRequestedMrs) },
    ],
    failureThemes,
  };
}

interface FailureThemeBucket extends AgentQualityFailureTheme {
  severityRank: number;
}

function buildFailureThemes(runs: Array<Record<string, unknown>>): AgentQualityFailureTheme[] {
  const buckets = new Map<string, FailureThemeBucket>();
  for (const run of runs) {
    const status = recordString(run, 'status');
    const retry = hasRetryMetadata(run);
    const attentionStatus = isFailedOrCancelledRunStatus(status) || status === 'needs_human';
    if (!attentionStatus && !retry) { continue; }

    const summary = runAttentionSummary(run);
    const retryOnly = retry && !attentionStatus;
    const label = retryOnly ? 'Retry pressure' : summary.label || 'Run needs review';
    const detail = retryOnly
      ? 'Run has retry metadata; review the upstream failure before normalizing a later pass.'
      : runAttentionLine(run, 180);
    const severity = failureThemeSeverity(summary, status, retryOnly);
    const severityRank = failureThemeSeverityRank(severity);
    const key = `${summary.failureKind}:${normalizeThemeLabel(label)}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      if (severityRank < existing.severityRank) {
        existing.severity = severity;
        existing.severityRank = severityRank;
        existing.detail = detail;
        existing.sampleRunId = recordString(run, 'id') || existing.sampleRunId;
      }
      continue;
    }
    buckets.set(key, {
      label,
      count: 1,
      detail,
      severity,
      severityRank,
      sampleRunId: recordString(run, 'id') || undefined,
    });
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.severityRank - b.severityRank || b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 6)
    .map(bucket => ({
      label: bucket.label,
      count: bucket.count,
      detail: bucket.detail,
      severity: bucket.severity,
      sampleRunId: bucket.sampleRunId,
    }));
}

function failureThemeSeverity(summary: RunAttentionSummary, status: string, retryOnly: boolean): AgentQualityFailureTheme['severity'] {
  if (retryOnly) { return 'warning'; }
  if (status === 'needs_human') { return 'critical'; }
  if (summary.failureKind === 'cancelled') { return 'warning'; }
  if (summary.failureKind === 'unknown' || summary.failureKind === 'none') { return status === 'cancelled' ? 'warning' : 'info'; }
  return 'critical';
}

function failureThemeSeverityRank(severity: AgentQualityFailureTheme['severity']): number {
  if (severity === 'critical') { return 0; }
  if (severity === 'warning') { return 1; }
  return 2;
}

function normalizeThemeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function proportionalScore(value: number, total: number, max: number): number {
  if (total <= 0) { return Math.round(max * 0.6); }
  return Math.round((value / total) * max);
}

function inverseProportionalScore(value: number, total: number, max: number): number {
  if (total <= 0) { return Math.round(max * 0.6); }
  return Math.round(Math.max(0, 1 - value / total) * max);
}

function evidenceReadinessScore(passes: number, warnings: number, failures: number, total: number): number {
  if (total <= 0) { return 12; }
  const weighted = passes + warnings * 0.55 - failures * 0.75;
  return Math.max(0, Math.min(20, Math.round((weighted / total) * 20)));
}

function buildReviewScore(successfulBuilds: number, failedBuilds: number, approvedMrs: number, changesRequestedMrs: number): number {
  const totalSignals = successfulBuilds + failedBuilds + approvedMrs + changesRequestedMrs;
  if (totalSignals <= 0) { return 9; }
  const weighted = successfulBuilds + approvedMrs - failedBuilds - changesRequestedMrs;
  return Math.max(0, Math.min(15, Math.round((weighted / totalSignals) * 15)));
}

function gradeForScore(score: number): AgentQualityScore['grade'] {
  if (score >= 90) { return 'A'; }
  if (score >= 80) { return 'B'; }
  if (score >= 70) { return 'C'; }
  if (score >= 60) { return 'D'; }
  return 'F';
}
