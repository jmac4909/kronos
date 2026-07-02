import { execFileSync } from 'child_process';

export interface CliProbeCommandOptions {
  timeoutMs: number;
  maxBuffer?: number;
}

export type CliProbeCommandRunner = (command: string, args: string[], options: CliProbeCommandOptions) => string;

export interface CliProbeOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  commandRunner?: CliProbeCommandRunner;
}

export interface CliProbeResult {
  ok: boolean;
  output: string;
  error?: string;
}

const CLAUDE_AGENTS_TIMEOUT_MS = 5000;
const GCLOUD_AUTH_TIMEOUT_MS = 10000;
const CLAUDE_MODEL_TIMEOUT_MS = 15000;

export function defaultCliProbeCommandRunner(command: string, args: string[], options: CliProbeCommandOptions): string {
  return execFileSync(command, args, {
    encoding: 'utf-8',
    timeout: options.timeoutMs,
    windowsHide: true,
    maxBuffer: options.maxBuffer,
  });
}

export function runCliProbe(command: string, args: string[], options: CliProbeOptions = {}): CliProbeResult {
  const commandRunner = options.commandRunner || defaultCliProbeCommandRunner;
  try {
    return {
      ok: true,
      output: commandRunner(command, args, {
        timeoutMs: options.timeoutMs || CLAUDE_AGENTS_TIMEOUT_MS,
        maxBuffer: options.maxBuffer,
      }),
    };
  } catch (e: any) {
    return {
      ok: false,
      output: '',
      error: e?.message || String(e),
    };
  }
}

export function readClaudeAgents<T = unknown>(options: CliProbeOptions = {}): T[] {
  const result = runCliProbe('claude', ['agents', '--json'], {
    ...options,
    timeoutMs: options.timeoutMs || CLAUDE_AGENTS_TIMEOUT_MS,
  });
  if (!result.ok) {
    return [];
  }
  try {
    const parsed = JSON.parse(result.output);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function checkGcloudApplicationDefaultAuth(options: CliProbeOptions = {}): CliProbeResult {
  return runCliProbe('gcloud', ['auth', 'application-default', 'print-access-token'], {
    ...options,
    timeoutMs: options.timeoutMs || GCLOUD_AUTH_TIMEOUT_MS,
  });
}

export function checkClaudeModelAccess(model: string, options: CliProbeOptions = {}): CliProbeResult {
  return runCliProbe('claude', ['-p', 'ok', '--model', model, '--permission-mode', 'auto'], {
    ...options,
    timeoutMs: options.timeoutMs || CLAUDE_MODEL_TIMEOUT_MS,
  });
}
