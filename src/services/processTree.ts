import { execFileSync } from 'child_process';
import { unknownErrorMessage } from './errorUtils';

type ProcessTreeSignal = 'SIGSTOP' | 'SIGCONT' | 'SIGTERM' | 'SIGKILL';

interface ProcessTreeCommandOptions {
  windowsHide: boolean;
  timeout: number;
}

type ProcessTreeCommandRunner = (command: string, args: string[], options: ProcessTreeCommandOptions) => void;
type ProcessKillRunner = (pid: number, signal?: ProcessTreeSignal) => void;
type ProcessTreeScheduler = (callback: () => void, ms: number) => unknown;

interface ProcessTreeOptions {
  platform?: NodeJS.Platform | string;
  commandRunner?: ProcessTreeCommandRunner;
  kill?: ProcessKillRunner;
  schedule?: ProcessTreeScheduler;
  sigkillDelayMs?: number;
}

interface ProcessTreeResult {
  attempted: boolean;
  signalled: boolean;
  method: 'none' | 'taskkill' | 'process-group' | 'process' | 'unsupported';
  fallbackUsed: boolean;
  error?: string;
}

export function stopProcessTree(pid: number | undefined, options: ProcessTreeOptions = {}): ProcessTreeResult {
  const processPid = normalizePid(pid);
  if (!processPid) { return result(false, false, 'none', false); }

  const platform = options.platform || process.platform;
  const kill = options.kill || defaultKill;
  if (platform === 'win32') {
    try {
      const commandRunner = options.commandRunner || defaultCommandRunner;
      commandRunner('taskkill', ['/PID', String(processPid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
      return result(true, true, 'taskkill', false);
    } catch (e: unknown) {
      return fallbackKill(processPid, kill, e);
    }
  }

  try {
    kill(-processPid, 'SIGTERM');
    const schedule = options.schedule || setTimeout;
    schedule(() => {
      try {
        kill(-processPid, 'SIGKILL');
      } catch (e: unknown) {
        console.warn(unknownErrorMessage(e, 'Delayed process-group SIGKILL failed.'));
      }
    }, options.sigkillDelayMs ?? 2500);
    return result(true, true, 'process-group', false);
  } catch (e: unknown) {
    return fallbackKill(processPid, kill, e);
  }
}

export function signalProcessTree(
  pid: number | undefined,
  signal: Extract<ProcessTreeSignal, 'SIGSTOP' | 'SIGCONT'>,
  options: ProcessTreeOptions = {},
): ProcessTreeResult {
  const processPid = normalizePid(pid);
  if (!processPid) { return result(false, false, 'none', false); }
  if (!supportsProcessTreeSuspend(options.platform || process.platform)) {
    return result(true, false, 'unsupported', false, `${signal} is not supported on Windows.`);
  }

  const kill = options.kill || defaultKill;
  try {
    kill(-processPid, signal);
    return result(true, true, 'process-group', false);
  } catch (e: unknown) {
    try {
      kill(processPid, signal);
      return result(true, true, 'process', true);
    } catch (fallbackError: unknown) {
      return result(true, false, 'process', true, unknownErrorMessage(fallbackError, unknownErrorMessage(e, 'process signal failed')));
    }
  }
}

export function supportsProcessTreeSuspend(platform: NodeJS.Platform | string = process.platform): boolean {
  return platform !== 'win32';
}

function fallbackKill(pid: number, kill: ProcessKillRunner, cause: unknown): ProcessTreeResult {
  try {
    kill(pid);
    return result(true, true, 'process', true);
  } catch (fallbackError: unknown) {
    return result(true, false, 'process', true, unknownErrorMessage(fallbackError, unknownErrorMessage(cause, 'process stop failed')));
  }
}

function normalizePid(pid: number | undefined): number | undefined {
  return typeof pid === 'number' && Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

function result(
  attempted: boolean,
  signalled: boolean,
  method: ProcessTreeResult['method'],
  fallbackUsed: boolean,
  error?: string,
): ProcessTreeResult {
  const output: ProcessTreeResult = { attempted, signalled, method, fallbackUsed };
  if (error) { output.error = error; }
  return output;
}

function defaultCommandRunner(command: string, args: string[], options: ProcessTreeCommandOptions): void {
  execFileSync(command, args, options);
}

function defaultKill(pid: number, signal?: ProcessTreeSignal): void {
  process.kill(pid, signal);
}
