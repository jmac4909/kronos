import * as fs from 'fs';
import * as path from 'path';
import type { KronosState, Project, Ticket } from '../state/types';
import { readBoundedPrivateUtf8File } from './stateStore';

const MAX_GIT_POINTER_BYTES = 4 * 1024;
const MAX_LOCAL_PROJECTS = 200;

export interface LocalProjectSummary {
  name: string;
  path: string;
  branch?: string;
  detached: boolean;
  available: boolean;
}

export function registerLocalProject(
  state: KronosState,
  projectNameValue: string,
  projectPathValue: string,
): KronosState {
  const projectName = requiredSingleLine(projectNameValue, 'project name', 200);
  const projectPath = requiredProjectDirectory(projectPathValue);
  const existing = state.projects[projectName];
  const project: Project = {
    path: projectPath,
    config: { ...(existing?.config || {}) },
  };
  if (!project.config.repo_name) { project.config.repo_name = projectName; }
  return {
    ...state,
    projects: { ...state.projects, [projectName]: project },
  };
}

/**
 * Selects one local launch project without changing Jira/provider project
 * associations.
 */
export function setTicketLocalProject(
  state: KronosState,
  ticketKeyValue: string,
  projectNameValue?: string,
): KronosState {
  const ticketKey = normalizeTicketKey(ticketKeyValue);
  const ticket = state.tickets[ticketKey];
  if (!ticket) { throw new Error(`Jira ticket is not loaded: ${ticketKey}`); }
  let projectName: string | undefined;
  if (projectNameValue !== undefined) {
    projectName = requiredSingleLine(projectNameValue, 'project name', 200);
    const project = state.projects[projectName];
    if (!project?.path) { throw new Error(`Local project is not registered: ${projectName}`); }
    requiredProjectDirectory(project.path);
  }
  const nextTicket: Ticket = { ...ticket, projects: [...ticket.projects] };
  if (projectName) { nextTicket.launch_project = projectName; }
  else { delete nextTicket.launch_project; }
  return {
    ...state,
    tickets: {
      ...state.tickets,
      [ticketKey]: nextTicket,
    },
  };
}

export function listLocalProjects(state: KronosState | null | undefined): LocalProjectSummary[] {
  if (!state) { return []; }
  return Object.entries(state.projects)
    .filter(([, project]) => Boolean(project.path))
    .slice(0, MAX_LOCAL_PROJECTS)
    .map(([name, project]) => localProjectSummary(name, project.path || ''))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function ticketLocalProject(
  state: KronosState | null | undefined,
  ticket: Ticket | null | undefined,
): LocalProjectSummary | undefined {
  if (!state || !ticket) { return undefined; }
  const name = ticket.launch_project;
  const projectPath = name ? state.projects[name]?.path : undefined;
  if (!name || !projectPath) { return undefined; }
  const summary = localProjectSummary(name, projectPath);
  return summary.available ? summary : undefined;
}

export function readProjectGitBranch(projectPathValue: string): { branch: string; detached: boolean } | undefined {
  try {
    const projectPath = fs.realpathSync(requiredProjectDirectory(projectPathValue));
    const dotGitPath = path.join(projectPath, '.git');
    const dotGitStat = fs.lstatSync(dotGitPath);
    if (dotGitStat.isSymbolicLink()) { return undefined; }
    let gitDirectory: string;
    if (dotGitStat.isDirectory()) {
      gitDirectory = dotGitPath;
    } else if (dotGitStat.isFile() && dotGitStat.size <= MAX_GIT_POINTER_BYTES) {
      const pointer = readBoundedPrivateUtf8File(dotGitPath, MAX_GIT_POINTER_BYTES, 'Git directory pointer');
      const match = /^gitdir:\s*([^\r\n]+)\s*$/i.exec(pointer.trim());
      if (!match?.[1]) { return undefined; }
      const gitDirectoryCandidate = path.resolve(projectPath, match[1]);
      const gitDirectoryStat = fs.lstatSync(gitDirectoryCandidate);
      if (gitDirectoryStat.isSymbolicLink() || !gitDirectoryStat.isDirectory()) { return undefined; }
      gitDirectory = fs.realpathSync(gitDirectoryCandidate);
    } else {
      return undefined;
    }
    const head = readBoundedPrivateUtf8File(
      path.join(gitDirectory, 'HEAD'),
      MAX_GIT_POINTER_BYTES,
      'Git HEAD',
    ).trim();
    const branchMatch = /^ref:\s+refs\/heads\/(.+)$/.exec(head);
    if (branchMatch?.[1]) {
      const branch = safeSingleLine(branchMatch[1], 500);
      return branch ? { branch, detached: false } : undefined;
    }
    return /^[0-9a-f]{7,64}$/i.test(head)
      ? { branch: `detached@${head.slice(0, 7).toLowerCase()}`, detached: true }
      : undefined;
  } catch {
    return undefined;
  }
}

function localProjectSummary(name: string, projectPath: string): LocalProjectSummary {
  const available = isProjectDirectory(projectPath);
  const git = available ? readProjectGitBranch(projectPath) : undefined;
  const summary: LocalProjectSummary = {
    name: safeSingleLine(name, 200) || 'Project',
    path: path.isAbsolute(projectPath) ? path.normalize(projectPath) : projectPath,
    detached: git?.detached === true,
    available,
  };
  if (git) { summary.branch = git.branch; }
  return summary;
}

function requiredProjectDirectory(value: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('Project path must be absolute.');
  }
  const normalized = path.normalize(value);
  const stat = fs.statSync(normalized);
  if (!stat.isDirectory()) { throw new Error(`Project path is not a directory: ${normalized}`); }
  return normalized;
}

function isProjectDirectory(value: string): boolean {
  try {
    requiredProjectDirectory(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeTicketKey(value: string): string {
  const key = safeSingleLine(value, 160).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-[0-9]{1,12}$/.test(key)) { throw new Error('Invalid Jira ticket key.'); }
  return key;
}

function requiredSingleLine(value: string, label: string, maxLength: number): string {
  const normalized = safeSingleLine(value, maxLength);
  if (!normalized) { throw new Error(`${label} is required.`); }
  return normalized;
}

function safeSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}
