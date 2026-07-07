import * as fs from 'fs';

import { Ticket } from '../state/types';
import { isHandoffAction } from './actionSemantics';
import { isPassingBuildStatus } from './buildStatus';
import { normalizeChangedFiles } from './changedFiles';
import { EvidenceGateResult, evaluateEvidenceGate } from './evidenceGate';
import { evidenceChecks, evidenceEnvironmentResults, evidenceNotes, evidenceString } from './evidenceData';
import { isExistingRealPathInside } from './pathUtils';
import { runProgressSummary } from './runProgress';
import { RUNS_DIR } from './runStore';
import { isSuccessfulRunStatus, terminalRunOutcome } from './runStatus';
import { escapeRegExp } from './regexp';
import { arrayFromUnknown, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown, recordFromUnknown } from './records';

type PostRunReadinessStatus = 'ready' | 'needs_human' | 'blocked' | 'not_ready' | 'unknown';
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

interface PostRunReadinessRunPatch {
  readiness: PostRunReadiness;
  failureKind: RunFailureKind;
  status?: 'waiting_for_review' | 'needs_human';
  failureReason?: string;
}

interface RunCompletionEvidenceCheck {
  name: string;
  result: 'pass' | 'fail' | 'warn' | 'unknown';
  environment: string;
  command?: string;
  summary: string;
  confidence: 'medium' | 'high';
}

interface RunCompletionEvidenceContext {
  record: Record<string, unknown>;
  runId: string;
  skill: string;
  status: string;
  exitCode: number | undefined;
  promptMetadata: Record<string, unknown>;
  progress: ReturnType<typeof runProgressSummary>;
  mr: Ticket['mr'] | undefined;
  build: Ticket['build'] | undefined;
  mrChangedFiles: number | undefined;
  sonarStatus: string | undefined;
  testCount: number | undefined;
  logText: string;
  sessionReport: string | undefined;
}

interface PostRunTicketResolution {
  ticketKey?: string;
  ticket?: Ticket;
}

export function resolvePostRunTicket(input: {
  tickets?: Record<string, Ticket>;
  ticketKey?: string;
  projectName?: string;
  run?: unknown;
}): PostRunTicketResolution {
  const ticketKey = optionalTrimmedStringFromUnknown(input.ticketKey);
  const tickets = input.tickets;
  if (!tickets) {
    return postRunTicketResolution(ticketKey);
  }
  if (ticketKey) {
    const direct = tickets[ticketKey];
    if (direct) {
      return { ticketKey, ticket: direct };
    }
    const matchedEntry = Object.entries(tickets).find(([key]) => key.toLowerCase() === ticketKey.toLowerCase());
    if (matchedEntry) {
      return { ticketKey: matchedEntry[0], ticket: matchedEntry[1] };
    }
  }

  const runResolved = resolveTicketFromRunRecord(tickets, input.run);
  if (runResolved) {
    return runResolved;
  }

  const projectName = optionalTrimmedStringFromUnknown(input.projectName) || runString(recordFromUnknown(input.run)['project']);
  if (!projectName) {
    return postRunTicketResolution(ticketKey);
  }
  const matchedProjectTickets = Object.entries(tickets).filter(([, ticket]) => (
    ticket.next_action !== 'done' && ticketLinkedToProject(ticket, projectName)
  ));
  const matchedProjectTicket = matchedProjectTickets.length === 1 ? matchedProjectTickets[0] : undefined;
  return matchedProjectTicket
    ? { ticketKey: matchedProjectTicket[0], ticket: matchedProjectTicket[1] }
    : postRunTicketResolution(ticketKey);
}

function postRunTicketResolution(ticketKey: string | undefined): PostRunTicketResolution {
  return ticketKey ? { ticketKey } : {};
}

export function shouldRecordRunCompletionEvidence(input: { run: unknown; ticket?: Ticket }): boolean {
  if (!input.ticket) { return false; }
  const record = recordFromUnknown(input.run);
  const runId = completionEvidenceRunId(record);
  const skill = runString(record['skill']);
  if (!runCompletedForEvidence(record) || hasRunCompletionEvidence(input.ticket, runId)) {
    return false;
  }
  if (skill === 'verify-local') {
    return true;
  }
  if (skill === 'implement') {
    return true;
  }
  return runCompletedForEvidence(record)
    && runString(record['skill']) === 'implement'
    && input.ticket.next_action === 'await_review';
}

export function buildRunCompletionEvidenceText(run: unknown, ticket?: Ticket): string {
  const context = runCompletionEvidenceContext(run, ticket);
  const exitCode = context.exitCode === undefined ? '' : `, exit ${context.exitCode}`;
  const workflow = runCompletionEvidenceWorkflow(context.skill);
  const lines = [
    `Kronos ${workflow} run ${context.runId} completed.`,
    `Run result: ${context.status}${exitCode}.`,
    ...(context.sessionReport ? ['Session report:', context.sessionReport] : []),
    '',
    `Progress: ${context.progress.label}.`,
    ...runCompletionEvidenceTargetLines(context),
    ...runCompletionEvidenceTrackingLines(context),
    `Files changed: ${context.progress.filesChanged} from run events; ${context.mrChangedFiles === undefined ? 'MR file list not captured' : `${context.mrChangedFiles} in MR`}.`,
    `Test count: ${context.testCount === undefined ? 'not captured in run metadata' : context.testCount}.`,
    `SonarQube: ${context.sonarStatus || 'not captured in ticket state'}.`,
    context.mr ? `MR: !${context.mr.iid} ${context.mr.state}/${context.mr.review_status}${context.mr.url ? ` - ${context.mr.url}` : ''}.` : 'MR: not linked at completion time.',
    context.build ? `Build: ${context.build.status} #${context.build.number}${context.build.url ? ` - ${context.build.url}` : ''}.` : 'Build: not captured in ticket state.',
  ];
  return lines.join('\n');
}

export function buildRunCompletionEvidenceCheck(run: unknown, ticket?: Ticket): RunCompletionEvidenceCheck {
  const context = runCompletionEvidenceContext(run, ticket);
  const strongSignal = positiveTestCount(context.testCount) || isPassingBuildStatus(context.build?.status) || isPassingSonar(context.sonarStatus);
  const cleanRun = runCleanForEvidence(context.record, context.exitCode);
  const isVerifyLocal = context.skill === 'verify-local';
  const reportSummary = runCompletionEvidenceReportSummary(context.sessionReport);
  const summaryParts = [
    `run ${context.runId} ${context.status}${context.exitCode === undefined ? '' : ` exit ${context.exitCode}`}`,
    ...runCompletionEvidenceTargetSummaryParts(context),
    ...runCompletionEvidenceTrackingSummaryParts(context),
    ...(reportSummary ? [`report: ${reportSummary}`] : []),
    `${context.progress.filesChanged} changed file${context.progress.filesChanged === 1 ? '' : 's'} from run events`,
    context.testCount === undefined ? 'test count not captured' : `${context.testCount} test${context.testCount === 1 ? '' : 's'}`,
    context.sonarStatus ? `SonarQube ${context.sonarStatus}` : 'SonarQube not captured',
    context.mr ? `MR !${context.mr.iid} ${context.mr.state}/${context.mr.review_status}` : 'MR not linked',
    context.build ? `build ${context.build.status} #${context.build.number}` : 'build not captured',
  ];
  return {
    name: runCompletionEvidenceCheckName(context.skill),
    result: isVerifyLocal ? (cleanRun ? 'warn' : 'fail') : cleanRun && strongSignal ? 'pass' : 'warn',
    environment: runCompletionEvidenceEnvironment(context),
    command: runCompletionEvidenceCommand(context.runId),
    confidence: strongSignal || (isVerifyLocal && cleanRun) || Boolean(context.sessionReport) ? 'high' : 'medium',
    summary: summaryParts.join('; '),
  };
}

function runCompletionEvidenceContext(run: unknown, ticket?: Ticket): RunCompletionEvidenceContext {
  const record = recordFromUnknown(run);
  const exitCode = Number(record['exitCode']);
  const skill = runString(record['skill']);
  const logText = readRunCompletionLogText(record);
  const sessionReport = runCompletionSessionReport(record, logText);
  return {
    record,
    runId: runString(record['id']) || 'unknown run',
    skill,
    status: runString(record['status']) || 'unknown',
    exitCode: Number.isFinite(exitCode) ? exitCode : undefined,
    promptMetadata: recordFromUnknown(record['promptMetadata']),
    progress: runProgressSummary(run),
    mr: ticket?.mr || undefined,
    build: ticket?.build || undefined,
    mrChangedFiles: mergeRequestChangedFileCount(ticket),
    sonarStatus: ticketSonarStatus(ticket),
    testCount: firstNumberField(record, ['testCount', 'tests', 'testsPassed', 'passedTests']),
    logText,
    sessionReport,
  };
}

function runCompletionEvidenceWorkflow(skill: string): string {
  return skill === 'verify-local' ? 'verify-local' : 'implement';
}

function runCompletionEvidenceCheckName(skill: string): string {
  return skill === 'verify-local' ? 'Kronos verify-local result' : 'Kronos implement completion';
}

function runCompletionEvidenceEnvironment(context: RunCompletionEvidenceContext): string {
  const environment = runString(context.promptMetadata['verifyEnvironment']);
  return environment || (context.skill === 'verify-local' ? 'verify-local' : 'kronos');
}

function runCompletionEvidenceTargetLines(context: RunCompletionEvidenceContext): string[] {
  if (context.skill !== 'verify-local') { return []; }
  return [
    `Verification branch: ${runString(context.promptMetadata['verifyBranch']) || 'not captured'}.`,
    `Verification environment: ${runCompletionEvidenceEnvironment(context)}.`,
    `Verification mode: ${runString(context.promptMetadata['verifyMode']) || 'not captured'}.`,
  ];
}

function runCompletionEvidenceTargetSummaryParts(context: RunCompletionEvidenceContext): string[] {
  if (context.skill !== 'verify-local') { return []; }
  return [
    `branch ${runString(context.promptMetadata['verifyBranch']) || 'not captured'}`,
    `environment ${runCompletionEvidenceEnvironment(context)}`,
    `mode ${runString(context.promptMetadata['verifyMode']) || 'not captured'}`,
  ];
}

function runCompletionEvidenceTrackingLines(context: RunCompletionEvidenceContext): string[] {
  const ids = runCompletionEvidenceTrackingIds(context);
  return ids.length ? [`Tracking IDs used: ${ids.join(', ')}.`] : [];
}

function runCompletionEvidenceTrackingSummaryParts(context: RunCompletionEvidenceContext): string[] {
  const ids = runCompletionEvidenceTrackingIds(context);
  return ids.length ? [`tracking IDs ${ids.join(', ')}`] : [];
}

function runCompletionEvidenceTrackingIds(context: RunCompletionEvidenceContext): string[] {
  if (context.skill !== 'verify-local') { return []; }
  const verifiedIds = trackingIdsFromText([
    context.sessionReport,
    context.logText,
    runEventDetails(context.record['events']).join('\n'),
  ].filter(Boolean).join('\n'));
  if (verifiedIds.length) {
    return verifiedIds.slice(0, 12);
  }
  const hints = runString(context.promptMetadata['verifyTrackingHints']);
  if (!hints || /^No explicit tracking/i.test(hints)) { return []; }
  const ids = hints
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
    .map(line => line.replace(/\s+\([^)]*\)\s*$/, '').trim())
    .flatMap(line => trackingIdsFromText(line))
    .filter(Boolean);
  return [...new Set(ids)].slice(0, 12);
}

function runCompletionSessionReport(record: Record<string, unknown>, logText: string): string | undefined {
  return compactEvidenceReport(
    finalReportFromClaudeLog(logText)
    || finalReportFromText(logText)
    || finalReportFromEvents(record['events'])
  );
}

function finalReportFromEvents(value: unknown): string | undefined {
  const events = arrayFromUnknown(value).map(recordFromUnknown);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) { continue; }
    const label = runString(event['label']);
    const detail = runString(event['detail']);
    const type = runString(event['type']);
    const combined = [label, detail].filter(Boolean).join('\n').trim();
    if (detail && (type === 'done' || looksLikeFinalReport(detail))) {
      return detail;
    }
    if (combined && looksLikeFinalReport(combined)) {
      return combined;
    }
  }
  return undefined;
}

function finalReportFromClaudeLog(logText: string): string | undefined {
  if (!logText.trim()) { return undefined; }
  const reports: string[] = [];
  for (const line of logText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) { continue; }
    try {
      const payload = recordFromUnknown(JSON.parse(trimmed));
      if (payload['type'] === 'result') {
        const result = runString(payload['result']);
        if (result) { reports.push(result); }
      } else if (payload['type'] === 'assistant') {
        const message = recordFromUnknown(payload['message']);
        for (const block of arrayFromUnknown(message['content'])) {
          const blockRecord = recordFromUnknown(block);
          if (blockRecord['type'] === 'text') {
            const text = runString(blockRecord['text']);
            if (text) { reports.push(text); }
          }
        }
      }
    } catch {
      // Ignore non-JSON log lines; stdout is a mixed stream on some Claude versions.
    }
  }
  for (let index = reports.length - 1; index >= 0; index -= 1) {
    const report = reports[index];
    if (report && looksLikeFinalReport(report)) {
      return report;
    }
  }
  for (let index = reports.length - 1; index >= 0; index -= 1) {
    const report = reports[index];
    if (report && report.trim().length > 120) {
      return report;
    }
  }
  return undefined;
}

function finalReportFromText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) { return undefined; }
  const markers = [
    /(?:^|\n)\s*#{1,4}\s*(?:final\s+)?(?:verification\s+)?(?:summary|report|result|findings)\b/i,
    /(?:^|\n)\s*(?:final\s+)?(?:verification\s+)?(?:summary|report|result|findings)\s*:/i,
    /(?:^|\n)\s*verdict\s*:/i,
  ];
  for (const marker of markers) {
    const match = marker.exec(trimmed);
    if (match?.index !== undefined && match.index >= 0) {
      return trimmed.slice(match.index).trim();
    }
  }
  return undefined;
}

function looksLikeFinalReport(text: string): boolean {
  return /final (summary|report)|verification (summary|report|result)|verdict|root cause|test results?|curl|x-tracking-?id|fix analysis|defect no longer reproduces|awaiting deployment/i.test(text);
}

function compactEvidenceReport(text: string | undefined, maxLength = 6000): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) { return undefined; }
  if (trimmed.length <= maxLength) { return trimmed; }
  return `${trimmed.slice(0, maxLength - 80).trimEnd()}\n\n[report truncated to ${maxLength} characters; see run log for full output]`;
}

function runCompletionEvidenceReportSummary(report: string | undefined): string | undefined {
  const lines = report?.split(/\r?\n/)
    .map(line => line.replace(/^\s*[#>*|:-]+\s*/, '').trim())
    .filter(line => line && !/^[-:|]+$/.test(line));
  if (!lines?.length) { return undefined; }
  const preferred = lines.find(line => /verdict/i.test(line))
    || lines.find(line => /fix|defect|pass|fail|success|awaiting deployment/i.test(line))
    || lines.find(line => /root cause/i.test(line))
    || lines[0];
  return preferred ? compactSingleLine(preferred, 300) : undefined;
}

function trackingIdsFromText(text: string): string[] {
  const ids: string[] = [];
  const patterns = [
    /\bX-Tracking-?Id\b["']?\s*[:=]\s*["']?([A-Za-z0-9][A-Za-z0-9._:-]{7,})/gi,
    /\btracking[-_\s]?id\b["']?\s*[:=]\s*["']?([A-Za-z0-9][A-Za-z0-9._:-]{7,})/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = normalizeTrackingId(match[1]);
      if (candidate && isUsefulTrackingId(candidate)) {
        ids.push(candidate);
      }
    }
  }
  return [...new Set(ids)];
}

function normalizeTrackingId(value: string | undefined): string {
  return String(value || '').replace(/^[<("{']+|[>)."',;]+$/g, '').trim();
}

function isUsefulTrackingId(value: string): boolean {
  if (value.length < 8) { return false; }
  if (/^[A-Za-z]+$/.test(value)) { return false; }
  return /^[A-Za-z0-9][A-Za-z0-9._:-]+$/.test(value);
}

function readRunCompletionLogText(record: Record<string, unknown>): string {
  const logPath = runString(record['logPath']);
  if (!logPath) { return ''; }
  try {
    if (!fs.existsSync(logPath) || !isExistingRealPathInside(logPath, RUNS_DIR) || !fs.statSync(logPath).isFile()) {
      return '';
    }
    const stat = fs.statSync(logPath);
    const maxBytes = 128 * 1024;
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(logPath, 'r');
    try {
      const buffer = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function compactSingleLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 3)}...`;
}

export function evaluatePostRunReadiness(input: {
  run: unknown;
  ticketKey?: string;
  ticket?: Ticket;
  now?: Date;
}): PostRunReadiness {
  const now = input.now || new Date();
  const inputRun = recordFromUnknown(input.run);
  const runStatus = runString(inputRun['status']);
  const failureKind = classifyRunFailure(input.run);
  const failureReason = runFailureReason(inputRun);
  if (!input.ticketKey || !input.ticket) {
    const readiness: PostRunReadiness = {
      evaluatedAt: now.toISOString(),
      status: isSuccessfulRunStatus(runStatus) ? 'needs_human' : 'blocked',
      summary: isSuccessfulRunStatus(runStatus)
        ? 'Run completed, but Kronos could not resolve current ticket state for readiness evaluation.'
        : `Run did not complete cleanly (${failureSummaryDetail(failureKind, failureReason)}).`,
      failureKind,
    };
    if (input.ticketKey) { readiness.ticketKey = input.ticketKey; }
    return readiness;
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

  const deploymentPendingSummary = fixMergedAwaitingDeploymentSummary(inputRun, input.ticket);
  if (deploymentPendingSummary) {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: 'needs_human',
      summary: deploymentPendingSummary,
      nextAction: 'deploy_monitor',
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  if (!isSuccessfulRunStatus(runStatus)) {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: 'blocked',
      summary: `Run ended as ${runStatus || 'unknown'} (${failureSummaryDetail(failureKind, failureReason)}); ticket gate is ${gate.status}.`,
      nextAction: input.ticket.next_action,
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  if (!isHandoffAction(input.ticket.next_action)) {
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

export function postRunReadinessRunPatch(run: unknown, readiness: PostRunReadiness): PostRunReadinessRunPatch {
  const record = recordFromUnknown(run);
  const currentStatus = runString(record['status']);
  const patch: PostRunReadinessRunPatch = {
    readiness,
    failureKind: readiness.failureKind,
  };
  const status = postRunReadinessStatusTransition(currentStatus, readiness);
  if (status) {
    patch.status = status;
  }
  const nextStatus = status || currentStatus;
  if (nextStatus === 'needs_human' && !runString(record['failureReason'])) {
    patch.failureReason = readiness.summary;
  }
  return patch;
}

function postRunReadinessStatusTransition(runStatus: string, readiness: PostRunReadiness): PostRunReadinessRunPatch['status'] {
  if (!isSuccessfulRunStatus(runStatus)) { return undefined; }
  if (readiness.status === 'ready') { return 'waiting_for_review'; }
  if (readiness.status === 'needs_human' || readiness.status === 'blocked') { return 'needs_human'; }
  return undefined;
}

export function classifyRunFailure(run: unknown): RunFailureKind {
  const record = recordFromUnknown(run);
  const status = runString(record['status']);
  if (!status && Object.keys(record).length === 0) { return 'unknown'; }
  if (isSuccessfulRunStatus(status)) { return 'none'; }
  if (status === 'cancelled') { return 'cancelled'; }
  const skill = runString(record['skill']).toLowerCase();
  const exitCode = Number(record['exitCode']);
  const text = [
    record['failureReason'],
    record['error'],
    ...runEventDetails(record['events']),
  ].map(runText).filter((line): line is string => Boolean(line)).join('\n').toLowerCase();

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
  return status === 'failed' || status === 'needs_human' ? 'unknown' : 'none';
}

function runCompletedForEvidence(record: Record<string, unknown>): boolean {
  const status = runString(record['status']);
  return isSuccessfulRunStatus(status)
    || (status === 'needs_human' && terminalRunOutcome(record) === 'completed')
    || verifyLocalLoopInterruptedAfterFinalSummary(record);
}

function runCleanForEvidence(record: Record<string, unknown>, exitCode: number | undefined): boolean {
  return runCompletedForEvidence(record)
    && (exitCode === undefined || exitCode === 0 || verifyLocalLoopInterruptedAfterFinalSummary(record));
}

function verifyLocalLoopInterruptedAfterFinalSummary(record: Record<string, unknown>): boolean {
  if (runString(record['skill']) !== 'verify-local') { return false; }
  if (runString(record['status']) !== 'needs_human') { return false; }
  const text = [
    record['failureReason'],
    record['error'],
    ...runEventDetails(record['events']),
  ].map(runText).filter((line): line is string => Boolean(line)).join('\n');
  if (!/Possible tool loop detected|Stopped after \d+ repeated/i.test(text)) { return false; }
  if (!/final (summary|report)|verification (summary|report)|verdict|result/i.test(text)) { return false; }
  return /defect no longer reproduces|fix (?:verified|works|confirmed)|reported failure no longer occurs|pass(?:ed|ing)?|success/i.test(text);
}

function completionEvidenceRunId(record: Record<string, unknown>): string {
  return runString(record['id']) || 'unknown run';
}

function hasRunCompletionEvidence(ticket: Ticket, runId: string): boolean {
  const command = runCompletionEvidenceCommand(runId);
  return evidenceChecks(ticket).some(check => evidenceCheckMatchesRunCompletion(check, runId, command))
    || evidenceNotes(ticket).some(note => evidenceNoteMatchesRunCompletion(note, runId));
}

function evidenceCheckMatchesRunCompletion(check: object, runId: string, command: string): boolean {
  const name = evidenceString(check, 'name');
  if (!name.startsWith('Kronos ') || (!name.includes('completion') && !name.includes('result'))) { return false; }
  if (runId === 'unknown run') { return true; }
  return evidenceString(check, 'command') === command
    || evidenceString(check, 'summary').includes(`run ${runId}`);
}

function evidenceNoteMatchesRunCompletion(note: object, runId: string): boolean {
  const text = evidenceString(note, 'text');
  return runId === 'unknown run'
    ? /^Kronos (implement|verify-local) run unknown run completed\./.test(text)
    : new RegExp(`^Kronos (implement|verify-local) run ${escapeRegExp(runId)} completed\\.`).test(text);
}

function runCompletionEvidenceCommand(runId: string): string {
  return `kronos run ${runId}`;
}

function runString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function runText(value: unknown): string | undefined {
  if (value === undefined || value === null) { return undefined; }
  const text = String(value).trim();
  return text ? text : undefined;
}

function runFailureReason(record: Record<string, unknown>): string {
  return [
    record['failureReason'],
    record['error'],
    ...runEventDetails(record['events']),
  ].map(runText).find((line): line is string => Boolean(line)) || '';
}

function failureSummaryDetail(kind: RunFailureKind, reason: string): string {
  return reason ? `${kind}: ${reason}` : kind;
}

function runEventDetails(value: unknown): unknown[] {
  return arrayFromUnknown(value).flatMap(event => {
    const record = recordFromUnknown(event);
    return [record['label'], record['detail']];
  });
}

function fixMergedAwaitingDeploymentSummary(record: Record<string, unknown>, ticket: Ticket): string | undefined {
  if (runString(record['skill']) !== 'verify-local') { return undefined; }
  const metadata = recordFromUnknown(record['promptMetadata']);
  if (runString(metadata['verifyMode']) !== 'confirm-fix-works') { return undefined; }
  if (!verifyTargetIsTest(metadata, ticket)) { return undefined; }
  if (!fixAppearsMergedInDevelop(metadata, ticket)) { return undefined; }
  if (!testStillShowsOldBehavior(record, ticket) && ticket.next_action !== 'deploy_monitor') { return undefined; }
  return 'Verify-local found the fix on develop, but TEST still appears to be running the old behavior; fix is merged and awaiting deployment to TEST.';
}

function verifyTargetIsTest(metadata: Record<string, unknown>, ticket: Ticket): boolean {
  const environment = runString(metadata['verifyEnvironment']).toLowerCase();
  const environmentUrl = runString(metadata['verifyEnvironmentUrl']).toLowerCase();
  if (environment === 'test' || /\btest\b/.test(environmentUrl)) { return true; }
  return evidenceEnvironmentResults(ticket).some(result => evidenceString(result, 'environment').toLowerCase() === 'test');
}

function fixAppearsMergedInDevelop(metadata: Record<string, unknown>, ticket: Ticket): boolean {
  const branch = runString(metadata['verifyBranch']).replace(/^origin\//, '').toLowerCase();
  return branch === 'develop' || ticket.mr?.state === 'merged' || ticket.next_action === 'deploy_monitor';
}

function testStillShowsOldBehavior(record: Record<string, unknown>, ticket: Ticket): boolean {
  const text = [
    record['failureReason'],
    record['error'],
    ...runEventDetails(record['events']),
    ...evidenceEnvironmentResults(ticket).flatMap(result => [
      evidenceString(result, 'environment'),
      evidenceString(result, 'status'),
      evidenceString(result, 'detail'),
    ]),
    ...evidenceChecks(ticket).flatMap(check => [
      evidenceString(check, 'name'),
      evidenceString(check, 'result'),
      evidenceString(check, 'summary'),
    ]),
  ].map(runText).filter((line): line is string => Boolean(line)).join('\n').toLowerCase();
  return /old behavior|still reproduc|still fail|not deployed|awaiting deploy|deployment pending|test.*(?:old|not updated|stale)|environment.*(?:old|stale)/.test(text);
}

function resolveTicketFromRunRecord(tickets: Record<string, Ticket>, run: unknown): PostRunTicketResolution | undefined {
  const searchValues = runSearchStrings(recordFromUnknown(run));
  if (searchValues.length === 0) { return undefined; }
  const matches = Object.entries(tickets).filter(([key]) => ticketKeyAppearsInStrings(key, searchValues));
  if (matches.length !== 1) { return undefined; }
  const matched = matches[0];
  return matched ? { ticketKey: matched[0], ticket: matched[1] } : undefined;
}

function runSearchStrings(record: Record<string, unknown>): string[] {
  const branch = recordFromUnknown(record['branch']);
  const promptMetadata = recordFromUnknown(record['promptMetadata']);
  return [
    record['ticket'],
    record['ticketKey'],
    record['issueKey'],
    record['jiraKey'],
    record['id'],
    record['promptPreview'],
    record['prompt'],
    record['worktreePath'],
    record['cwd'],
    branch['requestedWorktreeBranch'],
    branch['resolvedWorktreeRef'],
    branch['checkoutRef'],
    branch['currentRef'],
    promptMetadata['name'],
    promptMetadata['path'],
    ...runEventDetails(record['events']),
  ].map(runText).filter((line): line is string => Boolean(line));
}

function ticketKeyAppearsInStrings(ticketKey: string, values: string[]): boolean {
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(ticketKey)}($|[^A-Za-z0-9])`, 'i');
  return values.some(value => pattern.test(value));
}

function ticketLinkedToProject(ticket: Ticket, projectName: string): boolean {
  const target = projectName.toLowerCase();
  return ticket.projects.some(project => project.toLowerCase() === target);
}

function mergeRequestChangedFileCount(ticket?: Ticket): number | undefined {
  const files = ticket?.mr?.changed_files ?? ticket?.mr?.files;
  if (files === undefined) { return undefined; }
  return normalizeChangedFiles(files).length;
}

function ticketSonarStatus(ticket?: Ticket): string | undefined {
  return firstStringField(recordFromUnknown(ticket), [
    'sonar_status',
    'sonarStatus',
    'sonar_quality_gate',
    'sonarQualityGate',
    'quality_gate',
    'qualityGate',
    'quality_gate_status',
    'qualityGateStatus',
  ]);
}

function isPassingSonar(status: string | undefined): boolean {
  return ['OK', 'PASS', 'PASSED', 'SUCCESS'].includes(String(status || '').trim().toUpperCase());
}

function positiveTestCount(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstNumberField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const parsed = optionalFiniteNumberFromUnknown(record[key]);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}
