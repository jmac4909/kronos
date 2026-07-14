import * as vscode from 'vscode';
import type { KronosState as KronosStateSnapshot, Ticket } from '../state/types';

export interface WorkTreeStateSource {
  readonly state: KronosStateSnapshot | null;
  readonly onDidChange: vscode.Event<void>;
}

export interface WorkTicketFilter {
  query?: string;
  project?: string;
  source?: Ticket['source'];
  jiraStatus?: string;
}

type WorkTreeItem = WorkTicketTreeItem | WorkTreeMessageItem;

export class WorkTreeProvider implements vscode.TreeDataProvider<WorkTreeItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<WorkTreeItem | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly stateSubscription: vscode.Disposable;
  private filter: WorkTicketFilter = {};

  constructor(private readonly stateSource: WorkTreeStateSource) {
    this.stateSubscription = stateSource.onDidChange(() => this.changeEmitter.fire(undefined));
  }

  getTreeItem(element: WorkTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): WorkTreeItem[] {
    const state = this.stateSource.state;
    if (!state) {
      return [new WorkTreeMessageItem('Getting your work ready…', 'loading~spin')];
    }

    const allTickets = Object.entries(state.tickets);
    if (allTickets.length === 0) {
      return [new WorkTreeMessageItem(
        'No tickets yet — select here to refresh Jira.',
        'issues',
        'kronos.refreshTickets',
      )];
    }

    const visibleTickets = allTickets
      .filter(([ticketKey, ticket]) => workTicketMatchesFilter(ticketKey, ticket, this.filter))
      .sort(compareWorkTickets);
    if (visibleTickets.length === 0) {
      return [new WorkTreeMessageItem('No tickets match your search.', 'search')];
    }
    return visibleTickets.map(([ticketKey, ticket]) => new WorkTicketTreeItem(ticketKey, ticket));
  }

  setSearchQuery(query: string): void {
    this.setFilter(query);
  }

  setFilter(query: string): void {
    this.filter = normalizeWorkTicketFilter({ query });
    this.changeEmitter.fire(undefined);
  }

  clearFilter(): void {
    this.filter = {};
    this.changeEmitter.fire(undefined);
  }

  getFilter(): WorkTicketFilter {
    return { ...this.filter };
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.stateSubscription.dispose();
    this.changeEmitter.dispose();
  }
}

export class WorkTicketTreeItem extends vscode.TreeItem {
  override readonly contextValue = 'work_ticket';

  constructor(
    public readonly ticketKey: string,
    public readonly ticket: Ticket,
  ) {
    const key = safeSingleLine(ticketKey, 160) || 'Ticket';
    const summary = safeSingleLine(ticket.summary, 400) || 'Untitled ticket';
    super(`${key} — ${summary}`, vscode.TreeItemCollapsibleState.None);

    const projects = ticket.projects.map(project => safeSingleLine(project, 120)).filter(Boolean);
    const facts = [
      safeSingleLine(ticket.jira_status, 120),
      safeSingleLine(ticket.priority, 80),
      projects.length > 0 ? projects.join(', ') : 'unlinked',
      ticket.mr ? `MR !${ticket.mr.iid} ${safeSingleLine(ticket.mr.state, 40)}` : '',
      ticket.build ? `build #${ticket.build.number} ${safeSingleLine(ticket.build.status, 80)}` : '',
    ].filter(Boolean);
    this.description = facts.join(' • ');
    this.tooltip = buildWorkTicketTooltip(key, summary, ticket, projects);
    this.iconPath = new vscode.ThemeIcon(
      ticket.type.toLowerCase().includes('bug') || ticket.type.toLowerCase().includes('defect')
        ? 'bug'
        : 'issue-opened',
    );
    this.command = {
      command: 'kronos.openTicketWorkspace',
      title: 'Open Terminal Workspace',
      arguments: [this],
    };
  }
}

export function workTicketMatchesFilter(
  ticketKey: string,
  ticket: Ticket,
  filter: WorkTicketFilter,
): boolean {
  const normalized = normalizeWorkTicketFilter(filter);
  if (normalized.source && ticket.source !== normalized.source) { return false; }
  const projectFilter = normalized.project;
  if (projectFilter && !ticket.projects.some(project => comparable(project) === comparable(projectFilter))) {
    return false;
  }
  if (normalized.jiraStatus && comparable(ticket.jira_status) !== comparable(normalized.jiraStatus)) {
    return false;
  }
  const query = normalized.query;
  if (!query) { return true; }

  const searchable = [
    ticketKey,
    ticket.summary,
    ticket.description,
    ticket.type,
    ticket.priority,
    ticket.jira_status,
    ticket.source,
    ...ticket.projects,
    ...(ticket.labels || []),
    ticket.mr?.title,
    ticket.mr?.state,
    ticket.mr?.review_status,
    ticket.mr?.source_branch,
    ticket.mr?.target_branch,
    ticket.build?.status,
    ticket.build?.number,
  ].filter(value => value !== undefined && value !== null).map(value => comparable(String(value)));
  return searchable.some(value => value.includes(comparable(query)));
}

function normalizeWorkTicketFilter(filter: WorkTicketFilter): WorkTicketFilter {
  const normalized: WorkTicketFilter = {};
  const query = safeSingleLine(filter.query, 500);
  const project = safeSingleLine(filter.project, 200);
  const jiraStatus = safeSingleLine(filter.jiraStatus, 200);
  if (query) { normalized.query = query; }
  if (project) { normalized.project = project; }
  if (filter.source === 'jira' || filter.source === 'adhoc') { normalized.source = filter.source; }
  if (jiraStatus) { normalized.jiraStatus = jiraStatus; }
  return normalized;
}

function compareWorkTickets(
  left: [string, Ticket],
  right: [string, Ticket],
): number {
  const leftUpdated = timestamp(left[1].updated);
  const rightUpdated = timestamp(right[1].updated);
  return rightUpdated - leftUpdated || left[0].localeCompare(right[0]);
}

function buildWorkTicketTooltip(key: string, summary: string, ticket: Ticket, projects: readonly string[]): string {
  const lines = [
    `${key}: ${summary}`,
    `Jira status: ${safeSingleLine(ticket.jira_status, 160) || 'unknown'}`,
    `Type: ${safeSingleLine(ticket.type, 120) || 'unknown'}`,
    `Priority: ${safeSingleLine(ticket.priority, 120) || 'unknown'}`,
    `Projects: ${projects.join(', ') || 'unlinked'}`,
  ];
  if (ticket.mr) {
    lines.push(`MR !${ticket.mr.iid}: ${safeSingleLine(ticket.mr.state, 80)} / ${safeSingleLine(ticket.mr.review_status, 120)}`);
  }
  if (ticket.build) {
    lines.push(`Build #${ticket.build.number}: ${safeSingleLine(ticket.build.status, 120)}`);
  }
  const description = safeSingleLine(ticket.description, 300);
  if (description) { lines.push(description); }
  return lines.join('\n');
}

function comparable(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function timestamp(value: string | undefined): number {
  if (!value) { return 0; }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

class WorkTreeMessageItem extends vscode.TreeItem {
  constructor(label: string, icon: string, command?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    if (command) { this.command = { command, title: 'Refresh Jira Tickets' }; }
  }
}
