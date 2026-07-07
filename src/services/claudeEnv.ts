import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unknownErrorMessage } from './errorUtils';

export interface ClaudeEnvLoadResult {
  path: string;
  present: boolean;
  parsed: number;
  loaded: number;
  skippedExisting: number;
  invalid: number;
  error?: string | undefined;
}

interface ClaudeEnvLoadOptions {
  filePath?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  overrideExisting?: boolean | undefined;
  readFile?: ((filePath: string) => string) | undefined;
  exists?: ((filePath: string) => boolean) | undefined;
}

interface ParsedDotEnv {
  values: Record<string, string>;
  invalid: number;
}

export function defaultClaudeEnvPath(): string {
  return path.join(os.homedir(), '.claude', '.env');
}

export function loadClaudeDotEnv(options: ClaudeEnvLoadOptions = {}): ClaudeEnvLoadResult {
  const filePath = options.filePath || defaultClaudeEnvPath();
  const env = options.env || process.env;
  const exists = options.exists || fs.existsSync;
  const readFile = options.readFile || ((target: string) => fs.readFileSync(target, 'utf8'));
  if (!exists(filePath)) {
    return { path: filePath, present: false, parsed: 0, loaded: 0, skippedExisting: 0, invalid: 0 };
  }
  try {
    const parsed = parseClaudeDotEnv(readFile(filePath));
    let loaded = 0;
    let skippedExisting = 0;
    for (const [key, value] of Object.entries(parsed.values)) {
      if (!options.overrideExisting && env[key] !== undefined) {
        skippedExisting += 1;
        continue;
      }
      env[key] = value;
      loaded += 1;
    }
    return {
      path: filePath,
      present: true,
      parsed: Object.keys(parsed.values).length,
      loaded,
      skippedExisting,
      invalid: parsed.invalid,
    };
  } catch (e: unknown) {
    return {
      path: filePath,
      present: true,
      parsed: 0,
      loaded: 0,
      skippedExisting: 0,
      invalid: 0,
      error: unknownErrorMessage(e, 'Could not load Claude environment file.'),
    };
  }
}

export function parseClaudeDotEnv(text: string): ParsedDotEnv {
  const values: Record<string, string> = {};
  let invalid = 0;
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) { continue; }
    const assignment = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const equals = assignment.indexOf('=');
    if (equals <= 0) {
      invalid += 1;
      continue;
    }
    const key = assignment.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      invalid += 1;
      continue;
    }
    values[key] = parseDotEnvValue(assignment.slice(equals + 1));
  }
  return { values, invalid };
}

function parseDotEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, '').trim();
}
