import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { KronosState, QueueState } from '../state/types';

export const KRONOS_DIR = process.env.KRONOS_DIR || path.join(os.homedir(), '.claude', 'kronos');
export const STATE_FILE = path.join(KRONOS_DIR, 'state.json');
export const QUEUE_FILE = path.join(KRONOS_DIR, 'queue.json');
export const STATE_WRITE_LOCK_FILE = path.join(KRONOS_DIR, 'state.write.lock');
export const STATE_AUDIT_FILE = path.join(KRONOS_DIR, 'audit.jsonl');

const BACKUP_DIR = path.join(KRONOS_DIR, 'backups');
const WRITE_LOCK_STALE_MS = 5 * 60 * 1000;

export interface StateBackup {
  filePath: string;
  targetPath: string;
  targetName: 'state.json' | 'queue.json';
  createdAt: string;
  size: number;
}

export interface StateFileLoadIssue {
  target: 'state.json' | 'queue.json';
  filePath: string;
  detail: string;
}

export interface StateFileReadResult {
  state: KronosState | null;
  issues: StateFileLoadIssue[];
}

export interface StateAuditEvent {
  at: string;
  action: string;
  target?: string;
  backup?: string | null;
  [key: string]: unknown;
}

const DEFAULT_OVERNIGHT = {
  enabled: false,
  max_concurrent: 1,
  max_open_mrs_per_project: 1,
  nightly_implement_cap: 1,
  vpn_check_host: '',
  vpn_check_port: 0,
  vpn_check_interval_sec: 60,
};

export const VALID_TICKET_ACTIONS = [
  'implement',
  'in_progress',
  'fix_build',
  'await_review',
  'verify',
  'deploy_monitor',
  'blocked',
  'done',
] as const;

export const VALID_QUEUE_ACTIONS = [...VALID_TICKET_ACTIONS, 'refresh'] as const;

const VALID_TICKET_ACTION_SET = new Set<string>(VALID_TICKET_ACTIONS);
const VALID_QUEUE_ACTION_SET = new Set<string>(VALID_QUEUE_ACTIONS);

export function readStateFile(): KronosState | null {
  if (!fs.existsSync(STATE_FILE)) { return null; }
  const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  const migrated = migrateStateFileShape(raw);
  validateStateFileShape(migrated);
  return migrated;
}

export function readStateFileWithIssues(): StateFileReadResult {
  if (!fs.existsSync(STATE_FILE)) { return { state: null, issues: [] }; }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    const migrated = migrateStateFileShape(raw);
    const issues = repairStateForUi(migrated);
    try {
      validateStateFileShape(migrated);
    } catch (e: any) {
      issues.push({
        target: 'state.json',
        filePath: STATE_FILE,
        detail: `State loaded with remaining validation warning: ${e?.message || 'unknown validation error'}`,
      });
    }
    return { state: migrated, issues };
  } catch (e: any) {
    return {
      state: null,
      issues: [{
        target: 'state.json',
        filePath: STATE_FILE,
        detail: e?.message || 'Failed to load state.json',
      }],
    };
  }
}

export function readQueueFile(): QueueState | null {
  if (!fs.existsSync(QUEUE_FILE)) { return null; }
  const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
  const migrated = migrateQueueFileShape(raw);
  validateQueueState(migrated);
  return migrated;
}

export function migrateStateFileShape(raw: any): KronosState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('state.json must be an object');
  }
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const migrated: KronosState = {
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1,
    last_updated: raw.last_updated || null,
    settings: {
      ...settings,
      scan_dirs: Array.isArray(settings.scan_dirs) ? settings.scan_dirs : [],
      overnight: { ...DEFAULT_OVERNIGHT, ...(settings.overnight && typeof settings.overnight === 'object' ? settings.overnight : {}) },
    },
    projects: {},
    tickets: {},
    adhoc_tasks: raw.adhoc_tasks && typeof raw.adhoc_tasks === 'object' ? raw.adhoc_tasks : {},
    overnight: raw.overnight && typeof raw.overnight === 'object' ? { enabled: Boolean(raw.overnight.enabled), last_run: raw.overnight.last_run || null } : { enabled: false, last_run: null },
    discovered_projects: Array.isArray(raw.discovered_projects) ? raw.discovered_projects : [],
  };

  for (const [name, project] of Object.entries(raw.projects || {})) {
    const p = project as any;
    migrated.projects[name] = {
      path: String(p?.path || ''),
      priority: Number.isFinite(Number(p?.priority)) ? Number(p.priority) : 0,
      config: p?.config && typeof p.config === 'object' ? p.config : {},
      health: ['green', 'yellow', 'red', 'gray'].includes(p?.health) ? p.health : 'gray',
      summary: String(p?.summary || ''),
      last_polled: p?.last_polled || null,
      open_mr_count: Number.isFinite(Number(p?.open_mr_count)) ? Number(p.open_mr_count) : 0,
    };
  }

  for (const [key, ticket] of Object.entries(raw.tickets || {})) {
    const t = ticket as any;
    migrated.tickets[key] = {
      ...t,
      summary: String(t?.summary || ''),
      type: String(t?.type || 'Story'),
      priority: String(t?.priority || 'Medium'),
      jira_status: String(t?.jira_status || 'Open'),
      source: t?.source === 'adhoc' ? 'adhoc' : 'jira',
      projects: Array.isArray(t?.projects) ? t.projects : [],
      mr: t?.mr || null,
      build: t?.build || null,
      next_action: String(t?.next_action || 'implement'),
      last_action: t?.last_action || null,
      last_action_at: t?.last_action_at || null,
      evidence: migrateTicketEvidence(t?.evidence),
    };
  }

  return migrated;
}

function migrateTicketEvidence(evidence: any): any {
  if (evidence === undefined || evidence === null) { return undefined; }
  if (typeof evidence !== 'object' || Array.isArray(evidence)) { return evidence; }
  return {
    ...evidence,
    notes: evidence.notes === undefined ? undefined : evidence.notes,
    acceptance_criteria: evidence.acceptance_criteria === undefined ? undefined : evidence.acceptance_criteria,
    checks: evidence.checks === undefined ? undefined : evidence.checks,
    environment_results: evidence.environment_results === undefined ? undefined : evidence.environment_results,
    risk_notes: evidence.risk_notes === undefined ? undefined : evidence.risk_notes,
  };
}

export function migrateQueueFileShape(raw: any): QueueState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('queue.json must be an object');
  }
  const items = Array.isArray(raw.items) ? raw.items.map(migrateQueueItemShape) : [];
  const queue: QueueState = {
    items,
    last_computed: typeof raw.last_computed === 'string' ? raw.last_computed : null,
  };
  if (raw.decisions !== undefined) {
    if (!isPlainObject(raw.decisions)) {
      throw new Error('queue.decisions must be an object');
    }
    queue.decisions = Object.fromEntries(Object.entries(raw.decisions).map(([key, decision]) => {
      if (!isPlainObject(decision)) {
        throw new Error(`queue decision ${key} must be an object`);
      }
      const d = decision as any;
      return [key, {
        ...d,
        plan_id: String(d.plan_id || key),
        ticket: typeof d.ticket === 'string' ? d.ticket : null,
        action: String(d.action || 'implement'),
        decided_at: typeof d.decided_at === 'string' ? d.decided_at : new Date(0).toISOString(),
      }];
    }));
  }
  return queue;
}

function migrateQueueItemShape(item: any, idx: number): QueueState['items'][number] {
  if (!isPlainObject(item)) {
    throw new Error(`queue item ${idx} must be an object`);
  }
  const legacyProject = typeof item.project === 'string'
    ? item.project
    : typeof item.projectName === 'string'
      ? item.projectName
      : undefined;
  const projects = Array.isArray(item.projects)
    ? item.projects
    : typeof item.projects === 'string'
      ? [item.projects]
      : legacyProject
        ? [legacyProject]
        : [];
  const ticket = typeof item.ticket === 'string' ? item.ticket : null;
  const action = String(item.action || item.next_action || 'implement');
  return {
    ...item,
    id: String(item.id || `queued-${ticket || action}-${idx}`),
    ticket,
    ticket_summary: typeof item.ticket_summary === 'string' ? item.ticket_summary : undefined,
    projects,
    project_path: String(item.project_path || item.path || item.cwd || ''),
    action,
    priority_score: Number.isFinite(Number(item.priority_score)) ? Number(item.priority_score) : 0,
    reason: String(item.reason || `Migrated queue item for ${ticket || action}`),
  };
}

export function validateQueueState(queue: QueueState): void {
  if (!queue || !Array.isArray(queue.items)) {
    throw new Error('queue.json must contain an items array');
  }
  for (const [idx, item] of queue.items.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`queue item ${idx} must be an object`);
    }
    requireString(item.id, `queue item ${idx} id`);
    if (item.ticket !== null && item.ticket !== undefined) {
      requireString(item.ticket, `queue item ${idx} ticket`);
    }
    if (!Array.isArray(item.projects)) {
      throw new Error(`queue item ${idx} must contain a projects array`);
    }
    validateStringArray(item.projects, `queue item ${idx} projects`);
    requireString(item.project_path, `queue item ${idx} project_path`);
    validateActionValue(item.action, VALID_QUEUE_ACTION_SET, `queue item ${idx} action`);
    requireFiniteNumber(item.priority_score, `queue item ${idx} priority_score`);
    requireString(item.reason, `queue item ${idx} reason`);
  }
  if (queue.decisions !== undefined) {
    if (!isPlainObject(queue.decisions)) {
      throw new Error('queue.decisions must be an object');
    }
    for (const [key, decision] of Object.entries(queue.decisions)) {
      const d = decision as any;
      if (!isPlainObject(d)) {
        throw new Error(`queue decision ${key} must be an object`);
      }
      requireString(d.plan_id, `queue decision ${key} plan_id`);
      if (d.ticket !== null && d.ticket !== undefined) {
        requireString(d.ticket, `queue decision ${key} ticket`);
      }
      if (d.decision !== 'rejected' && d.decision !== 'snoozed') {
        throw new Error(`queue decision ${key} has invalid decision`);
      }
      if (typeof d.action !== 'string' || typeof d.decided_at !== 'string') {
        throw new Error(`queue decision ${key} must contain action and decided_at`);
      }
      validateActionValue(d.action, VALID_QUEUE_ACTION_SET, `queue decision ${key} action`);
      if (d.snoozed_until !== undefined && typeof d.snoozed_until !== 'string') {
        throw new Error(`queue decision ${key} snoozed_until must be a string`);
      }
    }
  }
}

function repairStateForUi(state: KronosState): StateFileLoadIssue[] {
  const issues: StateFileLoadIssue[] = [];

  if (!Array.isArray(state.settings.scan_dirs)) {
    state.settings.scan_dirs = [];
    addStateIssue(issues, 'state.settings.scan_dirs must be an array; using an empty list.');
  } else {
    filterStringArrayInPlace(state.settings.scan_dirs, 'state.settings.scan_dirs', issues);
  }

  for (const [name, project] of Object.entries({ ...state.projects })) {
    try {
      repairProjectRecord(name, project, issues);
      validateProjectRecord(name, project);
    } catch (e: any) {
      delete state.projects[name];
      addStateIssue(issues, `Skipped project ${name}: ${e?.message || 'invalid project record'}`);
    }
  }

  for (const [key, ticket] of Object.entries({ ...state.tickets })) {
    try {
      repairTicketRecord(key, ticket, issues);
      validateTicketRecord(key, ticket);
    } catch (e: any) {
      delete state.tickets[key];
      addStateIssue(issues, `Skipped ticket ${key}: ${e?.message || 'invalid ticket record'}`);
    }
  }

  return issues;
}

function repairProjectRecord(name: string, project: any, issues: StateFileLoadIssue[]): void {
  if (!isPlainObject(project)) {
    throw new Error(`project ${name} must be an object`);
  }
  if (project.last_polled !== null && project.last_polled !== undefined && typeof project.last_polled !== 'string') {
    project.last_polled = String(project.last_polled);
    addStateIssue(issues, `project ${name} last_polled was coerced to a string.`);
  }
  if (!isPlainObject(project.config)) {
    project.config = {};
    addStateIssue(issues, `project ${name} config was invalid; using an empty config.`);
  }
  repairProjectConfig(project.config, `project ${name} config`, issues);
}

function repairProjectConfig(config: any, label: string, issues: StateFileLoadIssue[]): void {
  for (const key of ['repo_name', 'jira_project_key', 'jira_ticket_filter', 'jenkins_url', 'sonar_project_key', 'github_repository', 'github_repo', 'github_api_url', 'base_branch', 'default_branch']) {
    if (config[key] !== undefined && typeof config[key] !== 'string') {
      config[key] = String(config[key]);
      addStateIssue(issues, `${label}.${key} was coerced to a string.`);
    }
  }
  if (config.gitlab_project_id !== undefined && typeof config.gitlab_project_id !== 'number') {
    const numeric = Number(config.gitlab_project_id);
    if (Number.isFinite(numeric)) {
      config.gitlab_project_id = numeric;
      addStateIssue(issues, `${label}.gitlab_project_id was coerced to a number.`);
    } else {
      delete config.gitlab_project_id;
      addStateIssue(issues, `${label}.gitlab_project_id was invalid and was ignored.`);
    }
  }
  if (config.extra_dirs !== undefined) {
    if (!Array.isArray(config.extra_dirs)) {
      delete config.extra_dirs;
      addStateIssue(issues, `${label}.extra_dirs was invalid and was ignored.`);
    } else {
      filterStringArrayInPlace(config.extra_dirs, `${label}.extra_dirs`, issues);
    }
  }
  if (config.deploy_approvers !== undefined) {
    if (!Array.isArray(config.deploy_approvers)) {
      delete config.deploy_approvers;
      addStateIssue(issues, `${label}.deploy_approvers was invalid and was ignored.`);
    } else {
      config.deploy_approvers = config.deploy_approvers.filter((approver: any, idx: number) => {
        if (!isPlainObject(approver)) {
          addStateIssue(issues, `${label}.deploy_approvers ${idx} was invalid and was ignored.`);
          return false;
        }
        for (const key of ['name', 'id', 'email']) {
          if (approver[key] !== undefined && typeof approver[key] !== 'string') {
            approver[key] = String(approver[key]);
            addStateIssue(issues, `${label}.deploy_approvers ${idx} ${key} was coerced to a string.`);
          }
        }
        return typeof approver.name === 'string' && typeof approver.id === 'string' && typeof approver.email === 'string';
      });
    }
  }
}

function repairTicketRecord(key: string, ticket: any, issues: StateFileLoadIssue[]): void {
  if (!isPlainObject(ticket)) {
    throw new Error(`ticket ${key} must be an object`);
  }
  if (!Array.isArray(ticket.projects)) {
    ticket.projects = [];
    addStateIssue(issues, `ticket ${key} projects was invalid; using an empty project list.`);
  } else {
    filterStringArrayInPlace(ticket.projects, `ticket ${key} projects`, issues);
  }
  if (typeof ticket.next_action !== 'string' || !VALID_TICKET_ACTION_SET.has(ticket.next_action)) {
    ticket.next_action = 'implement';
    addStateIssue(issues, `ticket ${key} next_action was invalid; using implement.`);
  }
  repairMergeRequest(ticket, key, issues);
  repairBuildStatus(ticket, key, issues);
  repairTicketEvidence(ticket, key, issues);
}

function repairMergeRequest(ticket: any, key: string, issues: StateFileLoadIssue[]): void {
  if (ticket.mr === null || ticket.mr === undefined) { return; }
  if (!isPlainObject(ticket.mr)) {
    ticket.mr = null;
    addStateIssue(issues, `ticket ${key} mr was invalid and was ignored.`);
    return;
  }
  const mr = ticket.mr as any;
  if (typeof mr.iid !== 'number') {
    const numeric = Number(mr.iid);
    if (Number.isFinite(numeric)) {
      mr.iid = numeric;
      addStateIssue(issues, `ticket ${key} mr.iid was coerced to a number.`);
    }
  }
  if (!['opened', 'merged', 'closed'].includes(mr.state)) {
    mr.state = 'opened';
    addStateIssue(issues, `ticket ${key} mr.state was invalid; using opened.`);
  }
  if (!['pending_review', 'approved', 'changes_requested'].includes(mr.review_status)) {
    mr.review_status = 'pending_review';
    addStateIssue(issues, `ticket ${key} mr.review_status was invalid; using pending_review.`);
  }
  if (mr.url !== undefined && typeof mr.url !== 'string') {
    mr.url = String(mr.url);
    addStateIssue(issues, `ticket ${key} mr.url was coerced to a string.`);
  }
}

function repairBuildStatus(ticket: any, key: string, issues: StateFileLoadIssue[]): void {
  if (ticket.build === null || ticket.build === undefined) { return; }
  if (!isPlainObject(ticket.build)) {
    ticket.build = null;
    addStateIssue(issues, `ticket ${key} build was invalid and was ignored.`);
    return;
  }
  const build = ticket.build as any;
  if (typeof build.number !== 'number') {
    const numeric = Number(build.number);
    if (Number.isFinite(numeric)) {
      build.number = numeric;
      addStateIssue(issues, `ticket ${key} build.number was coerced to a number.`);
    }
  }
  if (build.status !== undefined && typeof build.status !== 'string') {
    build.status = String(build.status);
    addStateIssue(issues, `ticket ${key} build.status was coerced to a string.`);
  }
  if (build.url !== undefined && typeof build.url !== 'string') {
    build.url = String(build.url);
    addStateIssue(issues, `ticket ${key} build.url was coerced to a string.`);
  }
}

function repairTicketEvidence(ticket: any, key: string, issues: StateFileLoadIssue[]): void {
  const evidence = ticket.evidence;
  if (evidence === null || evidence === undefined) { return; }
  if (!isPlainObject(evidence)) {
    delete ticket.evidence;
    addStateIssue(issues, `ticket ${key} evidence was invalid and was ignored.`);
    return;
  }
  for (const section of ['notes', 'acceptance_criteria', 'checks', 'risk_notes']) {
    if (evidence[section] !== undefined && !Array.isArray(evidence[section])) {
      delete evidence[section];
      addStateIssue(issues, `ticket ${key} evidence.${section} was invalid and was ignored.`);
    }
  }
  if (evidence.environment_results !== undefined && !isPlainObject(evidence.environment_results)) {
    delete evidence.environment_results;
    addStateIssue(issues, `ticket ${key} evidence.environment_results was invalid and was ignored.`);
  }
}

function filterStringArrayInPlace(value: unknown[], label: string, issues: StateFileLoadIssue[]): void {
  const originalLength = value.length;
  const filtered = value.filter((item): item is string => typeof item === 'string');
  if (filtered.length !== originalLength) {
    value.splice(0, value.length, ...filtered);
    addStateIssue(issues, `${label} contained non-string entries that were ignored.`);
  }
}

function addStateIssue(issues: StateFileLoadIssue[], detail: string): void {
  issues.push({ target: 'state.json', filePath: STATE_FILE, detail });
}

export function validateStateFileShape(raw: any): void {
  if (!isPlainObject(raw)) {
    throw new Error('state.json must be an object');
  }
  if (!isPlainObject(raw.settings)) {
    throw new Error('state.json must contain settings');
  }
  if (!Array.isArray(raw.settings.scan_dirs)) {
    throw new Error('state.settings.scan_dirs must be an array');
  }
  validateStringArray(raw.settings.scan_dirs, 'state.settings.scan_dirs');
  if (!isPlainObject(raw.projects)) {
    throw new Error('state.json must contain projects');
  }
  for (const [name, project] of Object.entries(raw.projects)) {
    validateProjectRecord(name, project);
  }
  if (!isPlainObject(raw.tickets)) {
    throw new Error('state.json must contain tickets');
  }
  for (const [key, ticket] of Object.entries(raw.tickets)) {
    validateTicketRecord(key, ticket);
  }
}

function validateTicketRecord(key: string, ticket: unknown): void {
  const t = ticket as any;
  if (!isPlainObject(t)) {
    throw new Error(`ticket ${key} must be an object`);
  }
  requireString(t.summary, `ticket ${key} summary`);
  requireString(t.type, `ticket ${key} type`);
  requireString(t.priority, `ticket ${key} priority`);
  requireString(t.jira_status, `ticket ${key} jira_status`);
  if (t.source !== 'jira' && t.source !== 'adhoc') {
    throw new Error(`ticket ${key} source must be jira or adhoc`);
  }
  if (!Array.isArray(t.projects)) {
    throw new Error(`ticket ${key} must contain a projects array`);
  }
  validateStringArray(t.projects, `ticket ${key} projects`);
  validateActionValue(t.next_action, VALID_TICKET_ACTION_SET, `ticket ${key} next_action`);
  validateMergeRequest(t.mr, `ticket ${key} mr`);
  validateBuildStatus(t.build, `ticket ${key} build`);
  const evidence = t.evidence as any;
  if (evidence !== null && evidence !== undefined && !isPlainObject(evidence)) {
    throw new Error(`ticket ${key} evidence must be an object`);
  }
  if (evidence && evidence.notes !== undefined && !Array.isArray(evidence.notes)) {
    throw new Error(`ticket ${key} evidence.notes must be an array`);
  }
  for (const [idx, note] of (evidence?.notes || []).entries()) {
    validateEvidenceNote(note, `ticket ${key} evidence note ${idx}`);
  }
  if (evidence && evidence.acceptance_criteria !== undefined) {
    if (!Array.isArray(evidence.acceptance_criteria)) {
      throw new Error(`ticket ${key} evidence.acceptance_criteria must be an array`);
    }
    for (const [idx, criterion] of evidence.acceptance_criteria.entries()) {
      if (!criterion || typeof criterion !== 'object' || typeof criterion.text !== 'string') {
        throw new Error(`ticket ${key} acceptance criterion ${idx} must contain text`);
      }
      if (criterion.checked !== undefined && typeof criterion.checked !== 'boolean') {
        throw new Error(`ticket ${key} acceptance criterion ${idx} checked must be boolean`);
      }
    }
  }
  if (evidence && evidence.checks !== undefined) {
    if (!Array.isArray(evidence.checks)) {
      throw new Error(`ticket ${key} evidence.checks must be an array`);
    }
    for (const [idx, check] of evidence.checks.entries()) {
      if (!check || typeof check !== 'object' || typeof check.name !== 'string') {
        throw new Error(`ticket ${key} evidence check ${idx} must contain name`);
      }
      if (!['pass', 'fail', 'warn', 'unknown'].includes(check.result)) {
        throw new Error(`ticket ${key} evidence check ${idx} has invalid result`);
      }
      if (check.confidence !== undefined && !['low', 'medium', 'high'].includes(check.confidence)) {
        throw new Error(`ticket ${key} evidence check ${idx} has invalid confidence`);
      }
    }
  }
  if (evidence && evidence.environment_results !== undefined) {
    if (!evidence.environment_results || typeof evidence.environment_results !== 'object' || Array.isArray(evidence.environment_results)) {
      throw new Error(`ticket ${key} evidence.environment_results must be an object`);
    }
    for (const [env, result] of Object.entries(evidence.environment_results)) {
      const r = result as any;
      if (!r || typeof r !== 'object' || typeof r.detail !== 'string') {
        throw new Error(`ticket ${key} environment result ${env} must contain detail`);
      }
      if (!['pass', 'fail', 'warn', 'unknown'].includes(r.status)) {
        throw new Error(`ticket ${key} environment result ${env} has invalid status`);
      }
      requireString(r.environment, `ticket ${key} environment result ${env} environment`);
      requireString(r.checked_at, `ticket ${key} environment result ${env} checked_at`);
    }
  }
  if (evidence && evidence.risk_notes !== undefined) {
    if (!Array.isArray(evidence.risk_notes)) {
      throw new Error(`ticket ${key} evidence.risk_notes must be an array`);
    }
    for (const [idx, risk] of evidence.risk_notes.entries()) {
      if (!risk || typeof risk !== 'object' || typeof risk.text !== 'string') {
        throw new Error(`ticket ${key} risk note ${idx} must contain text`);
      }
      if (risk.severity !== undefined && !['low', 'medium', 'high'].includes(risk.severity)) {
        throw new Error(`ticket ${key} risk note ${idx} has invalid severity`);
      }
    }
  }
}

function validateProjectRecord(name: string, project: unknown): void {
  const p = project as any;
  if (!isPlainObject(p)) {
    throw new Error(`project ${name} must be an object`);
  }
  requireString(p.path, `project ${name} path`);
  requireFiniteNumber(p.priority, `project ${name} priority`);
  if (!isPlainObject(p.config)) {
    throw new Error(`project ${name} config must be an object`);
  }
  validateProjectConfig(p.config, `project ${name} config`);
  if (typeof p.health !== 'string' || !['green', 'yellow', 'red', 'gray'].includes(p.health)) {
    throw new Error(`project ${name} health is invalid`);
  }
  requireString(p.summary, `project ${name} summary`);
  if (p.last_polled !== null && p.last_polled !== undefined) {
    requireString(p.last_polled, `project ${name} last_polled`);
  }
  requireFiniteNumber(p.open_mr_count, `project ${name} open_mr_count`);
}

function validateProjectConfig(config: any, label: string): void {
  for (const key of ['repo_name', 'jira_project_key', 'jira_ticket_filter', 'jenkins_url', 'sonar_project_key', 'github_repository', 'github_repo', 'github_api_url', 'base_branch', 'default_branch']) {
    if (config[key] !== undefined && typeof config[key] !== 'string') {
      throw new Error(`${label}.${key} must be a string`);
    }
  }
  if (config.gitlab_project_id !== undefined) {
    requireFiniteNumber(config.gitlab_project_id, `${label}.gitlab_project_id`);
  }
  if (config.extra_dirs !== undefined) {
    if (!Array.isArray(config.extra_dirs)) {
      throw new Error(`${label}.extra_dirs must be an array`);
    }
    validateStringArray(config.extra_dirs, `${label}.extra_dirs`);
  }
  if (config.deploy_approvers !== undefined) {
    if (!Array.isArray(config.deploy_approvers)) {
      throw new Error(`${label}.deploy_approvers must be an array`);
    }
    for (const [idx, approver] of config.deploy_approvers.entries()) {
      if (!isPlainObject(approver)) {
        throw new Error(`${label}.deploy_approvers ${idx} must be an object`);
      }
      requireString(approver.name, `${label}.deploy_approvers ${idx} name`);
      requireString(approver.id, `${label}.deploy_approvers ${idx} id`);
      requireString(approver.email, `${label}.deploy_approvers ${idx} email`);
    }
  }
}

function validateMergeRequest(mr: unknown, label: string): void {
  if (mr === null || mr === undefined) { return; }
  const value = mr as any;
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object or null`);
  }
  requireFiniteNumber(value.iid, `${label}.iid`);
  if (typeof value.state !== 'string' || !['opened', 'merged', 'closed'].includes(value.state)) {
    throw new Error(`${label}.state is invalid`);
  }
  if (typeof value.review_status !== 'string' || !['pending_review', 'approved', 'changes_requested'].includes(value.review_status)) {
    throw new Error(`${label}.review_status is invalid`);
  }
  requireString(value.url, `${label}.url`);
}

function validateBuildStatus(build: unknown, label: string): void {
  if (build === null || build === undefined) { return; }
  const value = build as any;
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object or null`);
  }
  requireFiniteNumber(value.number, `${label}.number`);
  requireString(value.status, `${label}.status`);
  requireString(value.url, `${label}.url`);
}

function validateEvidenceNote(note: unknown, label: string): void {
  const value = note as any;
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  requireString(value.at, `${label}.at`);
  if (typeof value.kind !== 'string' || !['note', 'test', 'risk', 'decision'].includes(value.kind)) {
    throw new Error(`${label}.kind is invalid`);
  }
  requireString(value.text, `${label}.text`);
}

function validateActionValue(value: unknown, allowed: Set<string>, label: string): void {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`${label} has unsupported action "${String(value)}"`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireString(value: unknown, label: string): void {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
}

function requireFiniteNumber(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function validateStringArray(value: unknown[], label: string): void {
  for (const [idx, item] of value.entries()) {
    if (typeof item !== 'string') {
      throw new Error(`${label} ${idx} must be a string`);
    }
  }
}

export function writeJsonFileAtomic(filePath: string, data: unknown, action: string): void {
  ensureDir(path.dirname(filePath));
  ensureDir(BACKUP_DIR);
  const releaseLock = acquireStateWriteLock(action, filePath);
  try {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const backupPath = path.join(BACKUP_DIR, `${path.basename(filePath)}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);

    let backedUp = false;
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
      backedUp = true;
    }

    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmpPath, filePath);
    auditEvent(action, {
      target: filePath,
      backup: backedUp ? backupPath : null,
    });
  } finally {
    releaseLock();
  }
}

export function listBackups(): StateBackup[] {
  if (!fs.existsSync(BACKUP_DIR)) { return []; }
  return fs.readdirSync(BACKUP_DIR)
    .filter(file => file.endsWith('.bak') && (file.startsWith('state.json.') || file.startsWith('queue.json.')))
    .map(file => {
      const filePath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(filePath);
      const targetName = file.startsWith('state.json.') ? 'state.json' : 'queue.json';
      return {
        filePath,
        targetPath: targetName === 'state.json' ? STATE_FILE : QUEUE_FILE,
        targetName,
        createdAt: stat.mtime.toISOString(),
        size: stat.size,
      } as StateBackup;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function restoreBackup(backupPath: string): StateBackup {
  const backup = listBackups().find(entry => entry.filePath === backupPath);
  if (!backup) {
    throw new Error(`Backup not found or not restorable: ${backupPath}`);
  }

  let raw = JSON.parse(fs.readFileSync(backup.filePath, 'utf-8'));
  if (backup.targetName === 'state.json') {
    raw = migrateStateFileShape(raw);
    validateStateFileShape(raw);
  } else {
    raw = migrateQueueFileShape(raw);
    validateQueueState(raw);
  }
  writeJsonFileAtomic(backup.targetPath, raw, `restore-${backup.targetName}`);
  return backup;
}

export function listStateAuditEvents(limit = 100): StateAuditEvent[] {
  if (!fs.existsSync(STATE_AUDIT_FILE)) { return []; }
  const max = Math.max(1, Math.floor(limit));
  const lines = fs.readFileSync(STATE_AUDIT_FILE, 'utf-8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-max).reverse().map((line): StateAuditEvent => {
    try {
      const event = JSON.parse(line);
      return {
        at: typeof event.at === 'string' ? event.at : '',
        action: typeof event.action === 'string' ? event.action : 'unknown',
        ...event,
      };
    } catch (e: any) {
      return {
        at: '',
        action: 'invalid-audit-entry',
        error: e?.message || 'Invalid audit JSONL entry',
        raw: line.slice(0, 500),
      };
    }
  });
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function auditEvent(action: string, detail: Record<string, unknown>): void {
  ensureDir(KRONOS_DIR);
  fs.appendFileSync(STATE_AUDIT_FILE, JSON.stringify({ at: new Date().toISOString(), action, ...detail }) + '\n');
}

function acquireStateWriteLock(action: string, target: string): () => void {
  ensureDir(KRONOS_DIR);
  clearStaleWriteLock();
  const payload = JSON.stringify({ pid: process.pid, action, target, createdAt: new Date().toISOString() }) + '\n';
  let fd: number | undefined;
  try {
    fd = fs.openSync(STATE_WRITE_LOCK_FILE, 'wx');
    fs.writeFileSync(fd, payload);
  } catch (e: any) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    const current = readCurrentWriteLock();
    throw new Error(`Kronos state write lock is held${current ? ` by pid ${current.pid || 'unknown'} for ${current.action || 'unknown action'}` : ''}. Retry after the current write finishes.`);
  }
  fs.closeSync(fd);
  let released = false;
  return () => {
    if (released) { return; }
    released = true;
    try {
      fs.unlinkSync(STATE_WRITE_LOCK_FILE);
    } catch {}
  };
}

function clearStaleWriteLock(): void {
  if (!fs.existsSync(STATE_WRITE_LOCK_FILE)) { return; }
  try {
    const stat = fs.statSync(STATE_WRITE_LOCK_FILE);
    if (Date.now() - stat.mtime.getTime() > WRITE_LOCK_STALE_MS) {
      fs.unlinkSync(STATE_WRITE_LOCK_FILE);
      auditEvent('clear-stale-state-write-lock', { lock: STATE_WRITE_LOCK_FILE });
    }
  } catch {}
}

function readCurrentWriteLock(): any {
  try {
    return JSON.parse(fs.readFileSync(STATE_WRITE_LOCK_FILE, 'utf-8'));
  } catch {
    return null;
  }
}
