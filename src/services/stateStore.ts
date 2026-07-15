import * as os from 'os';
import * as path from 'path';
import type {
  BuildStatus,
  KronosState,
  MergeRequest,
  Project,
  ProjectBranchProfile,
  ProjectConfig,
  Ticket,
} from '../state/types';
import { unknownErrorMessage } from './errorUtils';
import {
  ensurePrivateDirectoryPath,
  readPrivateTextFileIfPresent,
  writePrivateTextFileAtomically,
} from './privateFilePrimitives';
import { isRecord } from './records';
import { migrateLegacyKronosState } from './legacyStateMigration';

const explicitKronosDir = process.env['KRONOS_DIR']?.trim();
const defaultKronosDir = path.join(os.homedir(), '.kronos');
if (!explicitKronosDir) {
  migrateLegacyKronosState(defaultKronosDir, path.join(os.homedir(), '.claude', 'kronos'));
}
export const KRONOS_DIR = explicitKronosDir || defaultKronosDir;
export const STATE_FILE = path.join(KRONOS_DIR, 'work.json');
const FILE_MODE = 0o600;
export const MAX_WORK_CATALOG_BYTES = 32 * 1024 * 1024;
export const WORK_CATALOG_SCHEMA_VERSION = 2;

export interface StateFileLoadIssue {
  filePath: string;
  detail: string;
}

export interface StateFileReadResult {
  state: KronosState | null;
  issues: StateFileLoadIssue[];
}

export function emptyWorkCatalog(): KronosState {
  return { schemaVersion: WORK_CATALOG_SCHEMA_VERSION, refreshedAt: null, projects: {}, tickets: {} };
}

export function readStateFileWithIssues(): StateFileReadResult {
  const filePath = STATE_FILE;
  try {
    const raw = JSON.parse(readBoundedPrivateUtf8File(
      filePath,
      MAX_WORK_CATALOG_BYTES,
      'Kronos Work catalog',
    )) as unknown;
    return normalizeWorkCatalog(raw, filePath);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { state: emptyWorkCatalog(), issues: [] };
    }
    return {
      state: emptyWorkCatalog(),
      issues: [{ filePath, detail: unknownErrorMessage(error, 'Could not read the local Work catalog.') }],
    };
  }
}

export function writeStateFile(state: KronosState): void {
  const canonicalState = normalizeWorkCatalog({ ...state, schemaVersion: WORK_CATALOG_SCHEMA_VERSION }, STATE_FILE).state
    || emptyWorkCatalog();
  ensurePrivateDirectoryPath(KRONOS_DIR, 'Kronos Work catalog');
  writePrivateTextFileAtomically(STATE_FILE, `${JSON.stringify(canonicalState, null, 2)}\n`, {
    label: 'Kronos Work catalog',
    maxBytes: MAX_WORK_CATALOG_BYTES,
    temporaryPrefix: 'work-catalog',
    fileMode: FILE_MODE,
  });
}

export function normalizeWorkCatalog(raw: unknown, filePath = STATE_FILE): StateFileReadResult {
  if (!isRecord(raw)) {
    return { state: emptyWorkCatalog(), issues: [{ filePath, detail: 'Work catalog root must be an object.' }] };
  }
  const issues: StateFileLoadIssue[] = [];
  const sourceSchemaVersion = safeNonNegativeInteger(raw['schemaVersion']);
  if (sourceSchemaVersion !== undefined && sourceSchemaVersion > WORK_CATALOG_SCHEMA_VERSION) {
    return {
      state: emptyWorkCatalog(),
      issues: [{
        filePath,
        detail: `Work catalog schema ${sourceSchemaVersion} is newer than supported schema ${WORK_CATALOG_SCHEMA_VERSION}.`,
      }],
    };
  }
  const state = emptyWorkCatalog();
  state.refreshedAt = safeString(raw['refreshedAt']) || safeString(raw['last_updated']) || null;

  const rawProjects = isRecord(raw['projects']) ? raw['projects'] : {};
  for (const [name, value] of Object.entries(rawProjects)) {
    const project = normalizeProject(value);
    if (project) { state.projects[safeKey(name)] = project; }
    else { issues.push({ filePath, detail: `Ignored invalid project ${safeKey(name)}.` }); }
  }

  const rawTickets = isRecord(raw['tickets']) ? raw['tickets'] : {};
  for (const [rawKey, value] of Object.entries(rawTickets)) {
    const key = normalizeTicketKey(rawKey);
    const ticket = normalizeTicket(value, sourceSchemaVersion);
    if (key && ticket) { state.tickets[key] = ticket; }
    else { issues.push({ filePath, detail: `Ignored invalid Jira ticket ${safeKey(rawKey)}.` }); }
  }
  for (const [ticketKey, ticket] of Object.entries(state.tickets)) {
    const projectName = ticket.linked_local_project;
    if (!projectName || state.projects[projectName]?.path) { continue; }
    delete ticket.linked_local_project;
    issues.push({ filePath, detail: `Cleared unavailable local project link for ${ticketKey}.` });
  }
  return { state, issues };
}

export function readBoundedPrivateUtf8File(filePath: string, maxBytes: number, label: string): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(`${label} byte limit must be a positive safe integer.`);
  }

  const content = readPrivateTextFileIfPresent(filePath, { label, maxBytes });
  if (content !== null) { return content; }
  const error = new Error(`${label} is unavailable: ${path.resolve(filePath)}`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  throw error;
}

function normalizeProject(value: unknown): Project | undefined {
  if (!isRecord(value)) { return undefined; }
  const project: Project = { config: normalizeProjectConfig(value['config']) };
  const projectPath = safeString(value['path']);
  if (projectPath) { project.path = projectPath; }
  return project;
}

function normalizeProjectConfig(value: unknown): ProjectConfig {
  const raw = isRecord(value) ? value : {};
  const config: ProjectConfig = {};
  copyString(raw, config, 'repo_name');
  copyString(raw, config, 'jira_ticket_filter');
  copyString(raw, config, 'gitlab_project_path');
  copyString(raw, config, 'jenkins_url');
  copyString(raw, config, 'sonar_project_key');
  copyString(raw, config, 'sonar_branch');
  copyString(raw, config, 'base_branch');
  copyString(raw, config, 'default_branch');
  const gitlabProjectId = safePositiveInteger(raw['gitlab_project_id']);
  if (gitlabProjectId !== undefined) { config.gitlab_project_id = gitlabProjectId; }
  const extraDirs = safeStringArray(raw['extra_dirs']);
  if (extraDirs.length > 0) { config.extra_dirs = extraDirs; }
  const branchProfiles = normalizeBranchProfiles(raw['branch_profiles']);
  if (branchProfiles.length > 0) {
    config.branch_profiles = branchProfiles;
    const active = safeProfileBranch(raw['active_branch_profile']);
    if (active && branchProfiles.some(profile => profile.branch === active)) {
      config.active_branch_profile = active;
    }
  }
  return config;
}

function normalizeBranchProfiles(value: unknown): ProjectBranchProfile[] {
  if (!Array.isArray(value)) { return []; }
  const profiles: ProjectBranchProfile[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, 20)) {
    if (!isRecord(raw)) { continue; }
    const branch = safeProfileBranch(raw['branch']);
    if (!branch || seen.has(branch)) { continue; }
    const jenkinsUrl = safeProviderUrl(raw['jenkins_url']);
    const sonarProjectKey = safeString(raw['sonar_project_key']);
    const sonarBranch = safeProfileBranch(raw['sonar_branch']);
    if (sonarProjectKey && !/^[A-Za-z0-9_.:-]+$/.test(sonarProjectKey)) { continue; }
    if (!jenkinsUrl && !sonarProjectKey) { continue; }
    const profile: ProjectBranchProfile = { branch };
    if (jenkinsUrl) { profile.jenkins_url = jenkinsUrl; }
    if (sonarProjectKey) { profile.sonar_project_key = sonarProjectKey; }
    if (sonarBranch) { profile.sonar_branch = sonarBranch; }
    profiles.push(profile);
    seen.add(branch);
  }
  return profiles;
}

function safeProfileBranch(value: unknown): string | undefined {
  const branch = safeString(value);
  return branch
    && /^[A-Za-z0-9][A-Za-z0-9._/@+-]{0,499}$/.test(branch)
    && !branch.includes('..')
    && !branch.includes('@{')
    && !branch.includes('//')
    && !branch.endsWith('/')
    && !branch.endsWith('.')
    && !branch.endsWith('.lock')
    ? branch
    : undefined;
}

function safeProviderUrl(value: unknown): string | undefined {
  const candidate = safeString(value);
  if (!candidate) { return undefined; }
  try {
    const url = new URL(candidate);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
    return !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeTicket(value: unknown, sourceSchemaVersion?: number): Ticket | undefined {
  if (!isRecord(value) || value['source'] === 'adhoc') { return undefined; }
  const summary = safeString(value['summary']);
  if (!summary) { return undefined; }
  const ticket: Ticket = {
    summary,
    type: safeString(value['type']) || 'Issue',
    priority: safeString(value['priority']) || 'Unknown',
    jira_status: safeString(value['jira_status']) || safeString(value['status']) || 'Unknown',
    source: 'jira',
    mr: normalizeMergeRequest(value['mr']),
    build: normalizeBuild(value['build']),
  };
  const updated = safeString(value['updated']);
  const jiraStatusCategory = safeString(value['jira_status_category']);
  const jiraProjectKey = safeString(value['jira_project_key']);
  const description = safeMultilineString(value['description']);
  const jiraUrl = safeHttpUrl(value['jira_url']);
  const linkedLocalProject = safeString(value['linked_local_project'])
    || (sourceSchemaVersion !== WORK_CATALOG_SCHEMA_VERSION ? safeString(value['launch_project']) : undefined);
  const labels = safeStringArray(value['labels']);
  const attachments = normalizeAttachments(value['attachments']);
  if (updated) { ticket.updated = updated; }
  if (jiraStatusCategory) { ticket.jira_status_category = jiraStatusCategory; }
  if (jiraProjectKey) { ticket.jira_project_key = jiraProjectKey; }
  if (description) { ticket.description = description; }
  if (jiraUrl) { ticket.jira_url = jiraUrl; }
  if (linkedLocalProject) { ticket.linked_local_project = linkedLocalProject; }
  if (labels.length > 0) { ticket.labels = labels; }
  if (attachments.length > 0) { ticket.attachments = attachments; }
  return ticket;
}

function normalizeMergeRequest(value: unknown): MergeRequest | null {
  if (!isRecord(value)) { return null; }
  const iid = safePositiveInteger(value['iid']);
  const url = safeHttpUrl(value['url']);
  if (iid === undefined || !url) { return null; }
  const stateValue = safeString(value['state']);
  const reviewValue = safeString(value['review_status']);
  const mr: MergeRequest = {
    iid,
    url,
    state: stateValue === 'merged' || stateValue === 'closed' ? stateValue : 'opened',
    review_status: reviewValue === 'approved' || reviewValue === 'changes_requested' ? reviewValue : 'pending_review',
  };
  for (const key of ['title', 'author', 'last_comment_at', 'last_discussion_at', 'source_branch', 'target_branch', 'sourceBranch', 'targetBranch', 'branch', 'head_branch'] as const) {
    const item = safeString(value[key]);
    if (item) { mr[key] = item; }
  }
  for (const key of ['comment_count', 'discussion_count', 'unresolved_discussion_count', 'resolved_discussion_count'] as const) {
    const item = safeNonNegativeInteger(value[key]);
    if (item !== undefined) { mr[key] = item; }
  }
  if (typeof value['discussions_resolved'] === 'boolean') { mr.discussions_resolved = value['discussions_resolved']; }
  return mr;
}

function normalizeBuild(value: unknown): BuildStatus | null {
  if (!isRecord(value)) { return null; }
  const number = safePositiveInteger(value['number']);
  const status = safeString(value['status']);
  const url = safeHttpUrl(value['url']);
  return number !== undefined && status && url ? { number, status, url } : null;
}

function normalizeAttachments(value: unknown): Array<{ filename: string; size: number; mimeType: string }> {
  if (!Array.isArray(value)) { return []; }
  const normalized: Array<{ filename: string; size: number; mimeType: string }> = [];
  for (const item of value.slice(0, 250)) {
    if (!isRecord(item)) { continue; }
    const filename = safeString(item['filename']);
    if (!filename) { continue; }
    normalized.push({
      filename,
      size: safeNonNegativeInteger(item['size']) || 0,
      mimeType: safeString(item['mimeType']) || 'application/octet-stream',
    });
  }
  return normalized;
}

function copyString<K extends keyof ProjectConfig>(raw: Record<string, unknown>, target: ProjectConfig, key: K): void {
  const value = safeString(raw[key]);
  if (value) { (target as Record<string, unknown>)[key] = value; }
}

function normalizeTicketKey(value: string): string | undefined {
  const key = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]*-\d{1,12}$/.test(key) ? key : undefined;
}

function safeKey(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) || '(unnamed)';
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const normalized = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 32_000) : undefined;
}

function safeMultilineString(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const normalized = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').trim();
  return normalized ? normalized.slice(0, 128_000) : undefined;
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(safeString).filter((item): item is string => Boolean(item)))].slice(0, 500)
    : [];
}

function safePositiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function safeHttpUrl(value: unknown): string | undefined {
  const candidate = safeString(value);
  if (!candidate) { return undefined; }
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === code);
}
