import * as vscode from 'vscode';
import { KronosState } from '../state/KronosState';
import { Ticket } from '../state/types';
import { TicketFilter, describeTicketFilter, hasTicketFilter, ticketMatchesFilter } from '../services/ticketFilters';

export class ReviewTreeProvider implements vscode.TreeDataProvider<ReviewItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ReviewItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private filter: TicketFilter = {};

  constructor(private kronosState: KronosState) {
    kronosState.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  getTreeItem(element: ReviewItem): vscode.TreeItem { return element; }

  setFilter(filter: TicketFilter): void {
    this.filter = filter;
    this._onDidChangeTreeData.fire(undefined);
  }

  clearFilter(): void {
    this.filter = {};
    this._onDidChangeTreeData.fire(undefined);
  }

  getFilter(): TicketFilter { return { ...this.filter }; }
  getFilterDescription(): string { return describeTicketFilter(this.filter); }

  getChildren(): ReviewItem[] {
    const state = this.kronosState.state;
    if (!state) { return []; }

    const items: ReviewItem[] = [];
    for (const [key, ticket] of Object.entries(state.tickets || {})) {
      if (ticket.mr && ticket.next_action !== 'done' && ticketMatchesFilter(key, ticket, this.filter)) {
        if (ticket.next_action === 'await_review' || ticket.mr.state === 'merged') {
          items.push(new ReviewItem(key, ticket));
        }
      }
    }

    if (items.length === 0) {
      const empty = new ReviewItem('', { summary: '', type: '', priority: '', jira_status: '', source: 'jira', projects: [], mr: null, build: null, next_action: '', last_action: null, last_action_at: null });
      empty.label = hasTicketFilter(this.filter) ? `No MRs match ${describeTicketFilter(this.filter)}` : 'No MRs waiting for review';
      empty.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
      empty.contextValue = undefined;
      return [empty];
    }
    return items;
  }
}

class ReviewItem extends vscode.TreeItem {
  public readonly ticketKey: string;
  public readonly ticket: Ticket;
  public readonly projectName: string;

  constructor(ticketKey: string, ticket: Ticket) {
    super(ticketKey || '', vscode.TreeItemCollapsibleState.None);
    this.ticketKey = ticketKey;
    this.ticket = ticket;
    this.projectName = ticket.projects?.[0] || '';

    if (!ticketKey) { return; }

    this.contextValue = 'review_item';
    const mr = ticket.mr!;
    const reviewStatus = mr.review_status.replace(/_/g, ' ');
    const projs = ticket.projects?.join(', ') || 'unlinked';

    const isMerged = mr.state === 'merged';
    const statusLabel = isMerged ? 'merged' : reviewStatus;
    this.description = `${projs} · MR !${mr.iid} · ${statusLabel}`;
    this.label = `${ticketKey} — ${ticket.summary}`;
    this.tooltip = new vscode.MarkdownString(
      `**${ticketKey}**: ${ticket.summary}\n\n` +
      `Projects: ${projs}\n\nMR: !${mr.iid} — ${statusLabel}\n\n` +
      (isMerged ? `_Merged to develop_` : `_Click to view diff_`)
    );
    this.command = { command: 'kronos.openMrDiff', title: 'View Diff', arguments: [this] };

    const color = isMerged ? new vscode.ThemeColor('testing.iconPassed')
      : mr.review_status === 'approved' ? new vscode.ThemeColor('testing.iconPassed')
      : mr.review_status === 'changes_requested' ? new vscode.ThemeColor('testing.iconFailed')
      : new vscode.ThemeColor('charts.yellow');
    this.iconPath = new vscode.ThemeIcon(isMerged ? 'git-merge' : 'git-pull-request', color);
  }
}
