import * as fs from 'fs';

interface RunResumeSource {
  id?: string;
  project?: string;
  skill?: string;
  ticket?: string;
  status?: string;
  failureReason?: string;
  startedAt?: string;
  endedAt?: string;
  cwd?: string;
  worktreePath?: string;
  promptHash?: string;
}

export function readRunLogTail(logPath: string | undefined, maxBytes = 12000): string {
  if (!logPath || !fs.existsSync(logPath)) { return ''; }
  const stat = fs.statSync(logPath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const fd = fs.openSync(logPath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

export function buildRunResumePrompt(run: RunResumeSource, originalPrompt: string, logTail: string): string {
  const lines = [
    `Resume Kronos run ${run.id || 'unknown-run'} from the last safe point.`,
    '',
    'Run context:',
    `- Project: ${run.project || 'unknown'}`,
    `- Skill: ${run.skill || 'continue-work'}`,
    `- Ticket: ${run.ticket || 'none'}`,
    `- Previous status: ${run.status || 'unknown'}`,
    `- Failure reason: ${run.failureReason || 'none recorded'}`,
    `- Started: ${run.startedAt || 'unknown'}`,
    `- Ended: ${run.endedAt || 'not recorded'}`,
    `- Workspace: ${run.worktreePath || run.cwd || 'unknown'}`,
    `- Prompt hash: ${run.promptHash || 'unknown'}`,
    '',
    'Resume rules:',
    '- Inspect the current workspace before making changes.',
    '- Do not repeat completed work unless the workspace proves it is missing or broken.',
    '- Preserve existing edits and continue from the safest recoverable state.',
    '- Run the narrowest useful verification before reporting completion.',
    '- Record any unresolved risks, skipped checks, or manual handoff needs.',
    '',
    'Original prompt:',
    originalPrompt.trim() || '(original prompt unavailable)',
    '',
    'Recent run log tail:',
    logTail.trim() || '(run log unavailable)',
  ];
  return lines.join('\n');
}
