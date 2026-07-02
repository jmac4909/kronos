import * as fs from 'fs';
import * as path from 'path';
import { safeFileStem } from './fileNames';
import { KRONOS_DIR } from './stateStore';
import { unknownErrorMessage } from './errorUtils';
import { effectiveRunStatus, isActiveRunStatus } from './runStatus';

export const RUNS_DIR = path.join(KRONOS_DIR, 'runs');
export const ARCHIVED_RUNS_DIR = path.join(RUNS_DIR, 'archive');

export interface RunRecord {
  id: string;
  status?: string;
  logPath?: string;
  promptPath?: string;
  archivedAt?: string;
  endedAt?: string;
  pausedAt?: string;
  resumedAt?: string;
  failureReason?: string;
  failureKind?: string;
  recoveryActions?: Array<{ at: string; action: string; reason: string }>;
  events?: Array<{ type?: string; label?: string; detail?: string; timestamp?: string }>;
  archiveWarnings?: string[];
  [key: string]: unknown;
}

export interface ArchivedRun {
  run: RunRecord;
  runPath: string;
  logPath?: string;
  promptPath?: string;
  warnings?: string[];
}

export interface RunStoreIssue {
  kind: 'invalid_run_record';
  scope: 'active' | 'archived';
  filePath: string;
  detail: string;
}

export function runRecordPath(runId: string): string {
  return path.join(RUNS_DIR, `${safeRunId(runId)}.json`);
}

export function archivedRunRecordPath(runId: string): string {
  return path.join(ARCHIVED_RUNS_DIR, `${safeRunId(runId)}.json`);
}

export function readRuns(limit = 100): RunRecord[] {
  return listRunRecordFiles(RUNS_DIR, limit)
    .map(filePath => readRunFile(filePath, 'active'))
    .filter((r): r is RunRecord => Boolean(r));
}

export function readArchivedRuns(limit = 100): RunRecord[] {
  return listRunRecordFiles(ARCHIVED_RUNS_DIR, limit)
    .map(filePath => readRunFile(filePath, 'archived'))
    .filter((r): r is RunRecord => Boolean(r));
}

export function listRunStoreIssues(limit = 100): RunStoreIssue[] {
  return [
    ...listRunRecordFiles(RUNS_DIR, limit).map(filePath => readRunFileIssue(filePath, 'active')).filter((i): i is RunStoreIssue => Boolean(i)),
    ...listRunRecordFiles(ARCHIVED_RUNS_DIR, limit).map(filePath => readRunFileIssue(filePath, 'archived')).filter((i): i is RunStoreIssue => Boolean(i)),
  ];
}

export function readRunRecord(runId: string): RunRecord | null {
  return readRunFile(runRecordPath(runId), 'active');
}

export function writeRunRecord(run: RunRecord): void {
  writeJsonAtomic(runRecordPath(run.id), run);
}

export function markRunNeedsHuman(runId: string, reason: string, now = new Date()): RunRecord {
  const run = readRequiredRunRecord(runId);
  const at = now.toISOString();
  const detail = reason.trim() || 'Marked needs-human by operator.';
  run.status = 'needs_human';
  run.failureReason = detail;
  run.failureKind = run.failureKind || 'unknown';
  run.endedAt = run.endedAt || at;
  run.recoveryActions = Array.isArray(run.recoveryActions) ? run.recoveryActions : [];
  run.recoveryActions.push({ at, action: 'mark-needs-human', reason: detail });
  run.events = Array.isArray(run.events) ? run.events : [];
  run.events.push({ type: 'recovery', label: 'Marked needs human', detail, timestamp: at });
  writeRunRecord(run);
  return run;
}

export function markRunCancelled(runId: string, reason: string, now = new Date()): RunRecord {
  const run = readRequiredRunRecord(runId);
  const at = now.toISOString();
  const detail = reason.trim() || 'Cancelled by operator.';
  run.status = 'cancelled';
  run.failureReason = detail;
  run.failureKind = 'cancelled';
  run.endedAt = run.endedAt || at;
  run.recoveryActions = Array.isArray(run.recoveryActions) ? run.recoveryActions : [];
  run.recoveryActions.push({ at, action: 'cancel-run', reason: detail });
  run.events = Array.isArray(run.events) ? run.events : [];
  run.events.push({ type: 'recovery', label: 'Run cancelled', detail, timestamp: at });
  writeRunRecord(run);
  return run;
}

export function markRunPaused(runId: string, reason: string, now = new Date()): RunRecord {
  const run = readRequiredRunRecord(runId);
  const at = now.toISOString();
  const detail = reason.trim() || 'Paused by operator.';
  run.status = 'paused';
  run.pausedAt = at;
  run.recoveryActions = Array.isArray(run.recoveryActions) ? run.recoveryActions : [];
  run.recoveryActions.push({ at, action: 'pause-run', reason: detail });
  run.events = Array.isArray(run.events) ? run.events : [];
  run.events.push({ type: 'recovery', label: 'Run paused', detail, timestamp: at });
  writeRunRecord(run);
  return run;
}

export function markRunContinued(runId: string, reason: string, now = new Date()): RunRecord {
  const run = readRequiredRunRecord(runId);
  const at = now.toISOString();
  const detail = reason.trim() || 'Continued by operator.';
  run.status = 'running';
  run.resumedAt = at;
  run.recoveryActions = Array.isArray(run.recoveryActions) ? run.recoveryActions : [];
  run.recoveryActions.push({ at, action: 'continue-run', reason: detail });
  run.events = Array.isArray(run.events) ? run.events : [];
  run.events.push({ type: 'recovery', label: 'Run continued', detail, timestamp: at });
  writeRunRecord(run);
  return run;
}

export function writeRunPrompt(runId: string, prompt: string): string {
  ensureDir(RUNS_DIR);
  const promptPath = path.join(RUNS_DIR, `${safeRunId(runId)}.prompt.txt`);
  writeTextAtomic(promptPath, prompt);
  return promptPath;
}

export function appendRunLog(logPath: string, chunk: string): void {
  if (!isPathInside(logPath, RUNS_DIR) || isPathInside(logPath, ARCHIVED_RUNS_DIR)) {
    throw new Error(`Refusing to append run log outside active runs directory: ${logPath}`);
  }
  ensureDir(path.dirname(logPath));
  fs.appendFileSync(logPath, chunk);
}

export function archiveRun(runId: string): ArchivedRun {
  const currentPath = runRecordPath(runId);
  if (!fs.existsSync(currentPath)) {
    throw new Error(`Run not found: ${runId}`);
  }
  ensureDir(ARCHIVED_RUNS_DIR);
  const run = readRequiredRunRecord(runId);
  run.archivedAt = new Date().toISOString();
  const warnings: string[] = [];

  const archivedPath = nextAvailablePath(archivedRunRecordPath(runId), warnings, 'run record');
  const logPath = moveRunArtifactIfExists(run.logPath, ARCHIVED_RUNS_DIR, warnings, 'logPath');
  const promptPath = moveRunArtifactIfExists(run.promptPath, ARCHIVED_RUNS_DIR, warnings, 'promptPath');
  if (logPath) { run.logPath = logPath; }
  if (promptPath) { run.promptPath = promptPath; }
  if (warnings.length > 0) { run.archiveWarnings = warnings; }
  writeJsonAtomic(archivedPath, run);
  fs.unlinkSync(currentPath);
  return { run, runPath: archivedPath, logPath, promptPath, warnings };
}

function readRequiredRunRecord(runId: string): RunRecord {
  const currentPath = runRecordPath(runId);
  if (!fs.existsSync(currentPath)) {
    throw new Error(`Run not found: ${runId}`);
  }
  const result = readRunFileResult(currentPath, 'active');
  if (result.issue) {
    throw new Error(`Invalid run record ${currentPath}: ${result.issue.detail}`);
  }
  return normalizeTerminalActiveRun(result.run!);
}

function readRunFile(filePath: string, scope: RunStoreIssue['scope']): RunRecord | null {
  const run = readRunFileResult(filePath, scope).run;
  return run ? normalizeTerminalActiveRun(run) : null;
}

function readRunFileIssue(filePath: string, scope: RunStoreIssue['scope']): RunStoreIssue | null {
  return readRunFileResult(filePath, scope).issue || null;
}

function readRunFileResult(filePath: string, scope: RunStoreIssue['scope']): { run?: RunRecord; issue?: RunStoreIssue } {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { issue: invalidRunRecordIssue(scope, filePath, 'Run record must be a JSON object.') };
    }
    if (typeof parsed.id !== 'string' || parsed.id.trim().length === 0) {
      return { issue: invalidRunRecordIssue(scope, filePath, 'Run record id must be a non-empty string.') };
    }
    return { run: parsed as RunRecord };
  } catch (e: unknown) {
    return { issue: invalidRunRecordIssue(scope, filePath, unknownErrorMessage(e, 'Unable to parse JSON.')) };
  }
}

function normalizeTerminalActiveRun(run: RunRecord): RunRecord {
  const status = typeof run.status === 'string' ? run.status : '';
  const effectiveStatus = effectiveRunStatus(run);
  if (!status || !isActiveRunStatus(status) || !effectiveStatus || effectiveStatus === status) {
    return run;
  }
  const normalized: RunRecord = { ...run, status: effectiveStatus };
  if (effectiveStatus === 'needs_human' && !normalized.failureReason) {
    normalized.failureReason = `Run record had terminal metadata while persisted status was ${status}; inspect the run before retrying.`;
  }
  if ((effectiveStatus === 'failed' || effectiveStatus === 'cancelled') && !normalized.failureKind) {
    normalized.failureKind = effectiveStatus === 'cancelled' ? 'cancelled' : 'unknown';
  }
  return normalized;
}

function invalidRunRecordIssue(scope: RunStoreIssue['scope'], filePath: string, detail: string): RunStoreIssue {
  return { kind: 'invalid_run_record', scope, filePath, detail };
}

function listRunRecordFiles(dir: string, limit: number): string[] {
  if (!fs.existsSync(dir)) { return []; }
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map(f => path.join(dir, f));
}

function moveRunArtifactIfExists(filePath: string | undefined, destDir: string, warnings: string[], label: string): string | undefined {
  if (!filePath || !fs.existsSync(filePath)) { return undefined; }
  if (!isPathInside(filePath, RUNS_DIR) || isPathInside(filePath, ARCHIVED_RUNS_DIR)) {
    warnings.push(`Skipped ${label} outside active runs directory: ${filePath}`);
    return undefined;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    warnings.push(`Skipped ${label} because it is not a file: ${filePath}`);
    return undefined;
  }
  ensureDir(destDir);
  const target = nextAvailablePath(path.join(destDir, path.basename(filePath)), warnings, label);
  fs.renameSync(filePath, target);
  return target;
}

function nextAvailablePath(filePath: string, warnings: string[], label: string): string {
  if (!fs.existsSync(filePath)) {
    return filePath;
  }
  const parsed = path.parse(filePath);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!fs.existsSync(candidate)) {
      warnings.push(`Archived ${label} as ${candidate} because ${filePath} already exists.`);
      return candidate;
    }
  }
  const fallback = path.join(parsed.dir, `${parsed.name}-${Date.now()}-${process.pid}${parsed.ext}`);
  warnings.push(`Archived ${label} as ${fallback} because ${filePath} already exists.`);
  return fallback;
}

function isPathInside(filePath: string, parentDir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedParent = path.resolve(parentDir);
  const relative = path.relative(resolvedParent, resolvedFile);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

function writeTextAtomic(filePath: string, text: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, filePath);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function safeRunId(runId: string): string {
  return safeFileStem(runId, { fallback: 'run' });
}
