import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const SCRIPTS_DIR = process.env.KRONOS_SCRIPTS_DIR || path.join(os.homedir(), '.claude', 'scripts');
const PYTHON = findPython();

export type RequiredScriptName = 'kronos_state.py' | 'pipeline_monitor.py' | 'gitlab_api.py';

export interface ScriptRunOptions {
  timeout?: number;
  maxBuffer?: number;
}

export interface ScriptHealth {
  name: RequiredScriptName;
  path: string;
  present: boolean;
}

const DEFAULT_TIMEOUT = 60000;
const DEFAULT_BUFFER = 10 * 1024 * 1024;

export function requiredScripts(): ScriptHealth[] {
  return (['kronos_state.py', 'pipeline_monitor.py', 'gitlab_api.py'] as RequiredScriptName[])
    .map(name => {
      const filePath = scriptPath(name);
      return { name, path: filePath, present: fs.existsSync(filePath) };
    });
}

export function scriptPath(scriptName: RequiredScriptName): string {
  return path.join(SCRIPTS_DIR, scriptName);
}

export function runPythonScriptSync(scriptName: RequiredScriptName, args: string[], options: ScriptRunOptions = {}): string {
  const filePath = assertScriptAvailable(scriptName);
  try {
    return execFileSync(PYTHON, [filePath, ...args], {
      encoding: 'utf-8',
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      windowsHide: true,
      maxBuffer: options.maxBuffer ?? DEFAULT_BUFFER,
    });
  } catch (e: any) {
    throw scriptError(scriptName, args, e);
  }
}

export function runPythonScript(scriptName: RequiredScriptName, args: string[], options: ScriptRunOptions = {}): Promise<string> {
  const filePath = assertScriptAvailable(scriptName);
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [filePath, ...args], {
      encoding: 'utf-8',
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      windowsHide: true,
      maxBuffer: options.maxBuffer ?? DEFAULT_BUFFER,
    }, (err, stdout) => {
      if (err) {
        reject(scriptError(scriptName, args, err));
      } else {
        resolve(String(stdout));
      }
    });
  });
}

export async function runJsonScript<T = any>(scriptName: RequiredScriptName, args: string[], options: ScriptRunOptions = {}): Promise<T> {
  const raw = await runPythonScript(scriptName, args, options);
  return parseScriptJson<T>(scriptName, args, raw);
}

export function runKronosStateScript(args: string[], options: ScriptRunOptions = {}): string {
  return runPythonScriptSync('kronos_state.py', args, options);
}

export function runGitlabJson<T = any>(args: string[], options: ScriptRunOptions = {}): Promise<T> {
  return runJsonScript<T>('gitlab_api.py', args, options);
}

export function runPipelineJson<T = any>(args: string[], options: ScriptRunOptions = {}): Promise<T> {
  return runJsonScript<T>('pipeline_monitor.py', args, options);
}

function assertScriptAvailable(scriptName: RequiredScriptName): string {
  const filePath = scriptPath(scriptName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Kronos script missing: ${filePath}`);
  }
  return filePath;
}

function findPython(): string {
  const candidates = [process.env.PYTHON, 'python', 'python3'].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { encoding: 'utf-8', timeout: 3000, windowsHide: true });
      return candidate;
    } catch {}
  }
  return process.env.PYTHON || 'python';
}

function parseScriptJson<T>(scriptName: RequiredScriptName, args: string[], raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (e: any) {
    const preview = raw.trim().substring(0, 300);
    throw new Error(`Invalid JSON from ${scriptName} ${args.join(' ')}: ${e?.message || 'parse failed'}${preview ? `; output: ${preview}` : ''}`);
  }
}

function scriptError(scriptName: RequiredScriptName, args: string[], error: any): Error {
  const stderr = error?.stderr ? String(error.stderr).trim() : '';
  const message = stderr || error?.message || 'script failed';
  return new Error(`${scriptName} ${args.join(' ')} failed: ${message}`);
}
