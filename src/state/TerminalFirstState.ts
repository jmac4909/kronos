import * as fs from 'fs';
import * as vscode from 'vscode';
import type { KronosState as KronosStateSnapshot, Project, Ticket } from './types';
import { STATE_FILE, emptyWorkCatalog, readStateFileWithIssues, writeStateFile } from '../services/stateStore';
import { unknownErrorMessage } from '../services/errorUtils';
import { jiraRestClient, resolveJiraRestConfig, type JiraWorkListSnapshot } from '../services/jiraRestClient';
import { isRecord } from '../services/records';

export interface TerminalFirstStateIssue {
  filePath: string;
  detail: string;
}

export interface TerminalFirstRefreshResult {
  ticketCount: number;
  complete: boolean;
  retainedFromPrevious: number;
  pageCount: number;
  responseBytes: number;
  warnings: string[];
}

/**
 * The terminal-first product consumes only the bounded Jira Work catalog and
 * project/provider bindings needed by the three-view product.
 */
export class TerminalFirstState implements vscode.Disposable {
  private snapshot: KronosStateSnapshot | null = null;
  private issues: TerminalFirstStateIssue[] = [];
  private watcher: fs.FSWatcher | undefined;
  private watchTimer: NodeJS.Timeout | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.load();
    this.startWatcher();
  }

  get state(): KronosStateSnapshot | null {
    return this.snapshot;
  }

  get loadIssues(): TerminalFirstStateIssue[] {
    return this.issues.map(issue => ({ ...issue }));
  }

  load(): void {
    try {
      const result = readStateFileWithIssues();
      this.snapshot = result.state;
      this.issues = result.issues.map(issue => ({
        filePath: issue.filePath,
        detail: issue.detail,
      }));
    } catch (error: unknown) {
      this.snapshot = null;
      this.issues = [{
        filePath: STATE_FILE,
        detail: unknownErrorMessage(error, 'Could not load Kronos ticket state.'),
      }];
    }
  }

  reloadAndNotify(): void {
    this.load();
    this.restartWatcher();
    this.changeEmitter.fire();
  }

  async refreshTickets(): Promise<TerminalFirstRefreshResult> {
    const snapshot = await jiraRestClient.searchWorkList();
    const current = this.snapshot || emptyWorkCatalog();
    const next = catalogFromJiraWorkList(snapshot, current);
    writeStateFile(next.state);
    this.reloadAndNotify();
    return {
      ticketCount: Object.keys(next.state.tickets).length,
      complete: snapshot.complete,
      retainedFromPrevious: next.retainedFromPrevious,
      pageCount: snapshot.pageCount,
      responseBytes: snapshot.responseBytes,
      warnings: [...snapshot.warnings],
    };
  }

  dispose(): void {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = undefined;
    }
    this.watcher?.close();
    this.watcher = undefined;
    this.changeEmitter.dispose();
  }

  private startWatcher(): void {
    if (this.watcher || !fs.existsSync(STATE_FILE)) { return; }
    try {
      this.watcher = fs.watch(STATE_FILE, () => {
        if (this.watchTimer) { clearTimeout(this.watchTimer); }
        this.watchTimer = setTimeout(() => {
          this.watchTimer = undefined;
          this.load();
          this.restartWatcher();
          this.changeEmitter.fire();
        }, 150);
      });
    } catch (error: unknown) {
      console.warn(unknownErrorMessage(error, `Could not watch ${STATE_FILE}.`));
    }
  }

  private restartWatcher(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.startWatcher();
  }
}

function catalogFromJiraWorkList(
  snapshot: JiraWorkListSnapshot,
  current: KronosStateSnapshot,
): { state: KronosStateSnapshot; retainedFromPrevious: number } {
  const projects: Record<string, Project> = { ...current.projects };
  const tickets: Record<string, Ticket> = {};
  const baseUrl = resolveJiraRestConfig().baseUrl;
  for (const value of snapshot.issues) {
    const issue = isRecord(value) ? value : undefined;
    const key = normalizedIssueKey(issue?.['key']);
    const fields = isRecord(issue?.['fields']) ? issue['fields'] : undefined;
    const summary = providerText(fields?.['summary']);
    if (!key || !fields || !summary) { continue; }
    const previous = current.tickets[key];
    const projectKey = nestedProviderText(fields['project'], 'key');
    const linkedProjects = linkedProjectNames(projectKey, previous, projects);
    if (projectKey && linkedProjects.length === 0) {
      projects[projectKey] = { config: { jira_project_key: projectKey } };
      linkedProjects.push(projectKey);
    }
    const ticket: Ticket = {
      summary,
      type: nestedProviderText(fields['issuetype'], 'name') || previous?.type || 'Issue',
      priority: nestedProviderText(fields['priority'], 'name') || previous?.priority || 'Unknown',
      jira_status: nestedProviderText(fields['status'], 'name') || previous?.jira_status || 'Unknown',
      source: 'jira',
      projects: linkedProjects,
      mr: previous?.mr || null,
      build: previous?.build || null,
      jira_url: `${baseUrl}/browse/${encodeURIComponent(key)}`,
    };
    const updated = providerText(fields['updated']);
    const labels = Array.isArray(fields['labels'])
      ? fields['labels'].map(providerText).filter((item): item is string => Boolean(item)).slice(0, 500)
      : [];
    if (updated) { ticket.updated = updated; }
    if (labels.length > 0) { ticket.labels = [...new Set(labels)]; }
    const description = jiraDescriptionText(fields['description']);
    if (description) {
      ticket.description = description;
    } else if (!Object.prototype.hasOwnProperty.call(fields, 'description') && previous?.description) {
      ticket.description = previous.description;
    }
    const attachments = jiraAttachmentMetadata(fields['attachment']);
    if (attachments) {
      if (attachments.length > 0) { ticket.attachments = attachments; }
    } else if (previous?.attachments) {
      ticket.attachments = previous.attachments.map(item => ({ ...item }));
    }
    tickets[key] = ticket;
  }

  let retainedFromPrevious = 0;
  if (!snapshot.complete) {
    for (const [key, ticket] of Object.entries(current.tickets)) {
      if (tickets[key]) { continue; }
      tickets[key] = ticket;
      retainedFromPrevious += 1;
    }
  }
  return {
    state: { schemaVersion: 1, refreshedAt: snapshot.fetchedAt, projects, tickets },
    retainedFromPrevious,
  };
}

function linkedProjectNames(
  jiraProjectKey: string | undefined,
  previous: Ticket | undefined,
  projects: Record<string, Project>,
): string[] {
  const linked = new Set(previous?.projects || []);
  if (jiraProjectKey) {
    for (const [name, project] of Object.entries(projects)) {
      if (project.config.jira_project_key?.toUpperCase() === jiraProjectKey.toUpperCase()) { linked.add(name); }
    }
  }
  return [...linked].filter(name => Boolean(projects[name]) || name === jiraProjectKey).slice(0, 100);
}

function normalizedIssueKey(value: unknown): string | undefined {
  const key = providerText(value)?.toUpperCase();
  return key && /^[A-Z][A-Z0-9_]*-\d{1,12}$/.test(key) ? key : undefined;
}

function nestedProviderText(value: unknown, key: string): string | undefined {
  return isRecord(value) ? providerText(value[key]) : undefined;
}

function providerText(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const normalized = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 32_000) : undefined;
}

function jiraDescriptionText(value: unknown): string | undefined {
  if (typeof value === 'string') { return providerMultilineText(value); }
  if (!isRecord(value) && !Array.isArray(value)) { return undefined; }
  const fragments: string[] = [];
  let visited = 0;
  const visit = (node: unknown, depth: number): void => {
    if (depth > 32 || visited >= 10_000 || fragments.join('').length >= 32_000) { return; }
    visited += 1;
    if (typeof node === 'string') {
      fragments.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) { visit(child, depth + 1); }
      return;
    }
    if (!isRecord(node)) { return; }
    if (typeof node['text'] === 'string') { fragments.push(node['text']); }
    const type = typeof node['type'] === 'string' ? node['type'] : '';
    if (type === 'hardBreak') { fragments.push('\n'); }
    const content = node['content'];
    if (Array.isArray(content)) {
      for (const child of content) { visit(child, depth + 1); }
    }
    if (type === 'paragraph' || type === 'heading' || type === 'listItem'
      || type === 'bulletList' || type === 'orderedList' || type === 'codeBlock') {
      fragments.push('\n');
    }
  };
  visit(value, 0);
  return providerMultilineText(fragments.join('').slice(0, 32_000));
}

function providerMultilineText(value: string): string | undefined {
  const normalized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/ *\r?\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized ? normalized.slice(0, 32_000) : undefined;
}

function jiraAttachmentMetadata(value: unknown): Ticket['attachments'] | undefined {
  if (!Array.isArray(value)) { return undefined; }
  const attachments: NonNullable<Ticket['attachments']> = [];
  for (const candidate of value.slice(0, 200)) {
    if (!isRecord(candidate)) { continue; }
    const filename = providerText(candidate['filename']);
    if (!filename) { continue; }
    const rawSize = candidate['size'];
    const size = typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize >= 0
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(rawSize))
      : 0;
    attachments.push({
      filename: filename.slice(0, 1_000),
      size,
      mimeType: providerText(candidate['mimeType']) || 'application/octet-stream',
    });
  }
  return attachments;
}
