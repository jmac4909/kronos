import * as fs from 'fs';
import * as path from 'path';
import { KRONOS_DIR } from './stateStore';
import { unknownErrorMessage } from './errorUtils';
import { readJsonFile } from './jsonFiles';
import { isRecord, trimmedStringFromUnknown } from './records';

export const ACTIVE_WORKTREES_FILE = path.join(KRONOS_DIR, 'active-worktrees.json');

export interface ActiveWorktreeEntry {
  projectPath: string;
  worktreePath: string;
  ticket: string;
  createdAt: string;
}

interface ActiveWorktreeRegistry {
  entries: ActiveWorktreeEntry[];
  issue?: string;
}

export function loadActiveWorktreeRegistry(filePath = ACTIVE_WORKTREES_FILE): ActiveWorktreeRegistry {
  try {
    if (fs.existsSync(filePath)) {
      const parsed = readJsonFile(filePath);
      if (!Array.isArray(parsed)) {
        return { entries: [], issue: 'active-worktrees.json must be an array.' };
      }
      const entries: ActiveWorktreeEntry[] = [];
      for (const [index, entry] of parsed.entries()) {
        const normalized = normalizeActiveWorktreeEntry(entry, index);
        if (typeof normalized === 'string') {
          return { entries: [], issue: normalized };
        }
        entries.push(normalized);
      }
      return { entries };
    }
  } catch (e: unknown) {
    return { entries: [], issue: unknownErrorMessage(e, 'Could not parse active-worktrees.json.') };
  }
  return { entries: [] };
}

export function trackActiveWorktree(
  projectPath: string,
  worktreePath: string,
  ticket: string,
  now = new Date(),
  filePath = ACTIVE_WORKTREES_FILE,
): ActiveWorktreeEntry {
  const registry = loadActiveWorktreeRegistry(filePath);
  assertMutableRegistry(registry, filePath);
  const entry: ActiveWorktreeEntry = {
    projectPath,
    worktreePath,
    ticket,
    createdAt: now.toISOString(),
  };
  const entries = registry.entries.filter(existing => existing.worktreePath !== worktreePath);
  entries.push(entry);
  writeJsonAtomic(filePath, entries);
  return entry;
}

export function untrackActiveWorktree(worktreePath: string, filePath = ACTIVE_WORKTREES_FILE): ActiveWorktreeEntry[] {
  const registry = loadActiveWorktreeRegistry(filePath);
  assertMutableRegistry(registry, filePath);
  const entries = registry.entries.filter(entry => entry.worktreePath !== worktreePath);
  writeJsonAtomic(filePath, entries);
  return entries;
}

function normalizeActiveWorktreeEntry(entry: unknown, index: number): ActiveWorktreeEntry | string {
  if (!isRecord(entry)) {
    return `active-worktrees.json entry ${index} must be an object.`;
  }
  const projectPath = trimmedStringFromUnknown(entry['projectPath']);
  const worktreePath = trimmedStringFromUnknown(entry['worktreePath']);
  if (!projectPath) {
    return `active-worktrees.json entry ${index} is missing projectPath.`;
  }
  if (!worktreePath) {
    return `active-worktrees.json entry ${index} is missing worktreePath.`;
  }
  return {
    projectPath,
    worktreePath,
    ticket: trimmedStringFromUnknown(entry['ticket']),
    createdAt: trimmedStringFromUnknown(entry['createdAt']),
  };
}

function assertMutableRegistry(registry: ActiveWorktreeRegistry, filePath: string): void {
  if (registry.issue) {
    throw new Error(`Active worktree registry needs manual review before it can be changed: ${filePath}\n${registry.issue}`);
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}
