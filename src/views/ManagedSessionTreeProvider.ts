import * as vscode from 'vscode';
import { OperatorTerminalRegistry } from '../services/operatorTerminalRegistry';
import { WorkSessionRecord, listWorkSessions } from '../services/workSessionStore';

export interface ManagedSessionCommandTarget {
  workSessionId: string;
  ticketKey: string;
  liveTerminalBindingIds: readonly string[];
}

type WorkSessionLoader = () => WorkSessionRecord[];

/**
 * A terminal-first view of durable work sessions. Terminal ownership stays
 * with the operator and liveness comes only from OperatorTerminalRegistry.
 */
export class ManagedSessionTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly operatorTerminals: OperatorTerminalRegistry<vscode.Terminal>,
    private readonly loadWorkSessions: WorkSessionLoader = () => listWorkSessions(),
  ) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const sessions = this.safeLoadWorkSessions()
      .sort((left, right) => sessionSortOrder(left, right));
    if (sessions.length === 0) {
      return [new ManagedSessionMessageTreeItem()];
    }

    return sessions.map(session => new ManagedSessionTreeItem(
      session,
      this.operatorTerminals.listBindings(session.id).map(binding => binding.bindingId),
    ));
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  private safeLoadWorkSessions(): WorkSessionRecord[] {
    try {
      return this.loadWorkSessions();
    } catch (error: unknown) {
      console.warn(`Kronos managed-session refresh failed: ${errorMessage(error)}`);
      return [];
    }
  }
}

export class ManagedSessionTreeItem extends vscode.TreeItem implements ManagedSessionCommandTarget {
  readonly workSessionId: string;
  readonly ticketKey: string;
  readonly liveTerminalBindingIds: readonly string[];

  constructor(
    readonly session: WorkSessionRecord,
    liveTerminalBindingIds: readonly string[],
  ) {
    super(`${session.ticketKey}: ${session.title}`, vscode.TreeItemCollapsibleState.None);
    this.workSessionId = session.id;
    this.ticketKey = session.ticketKey;
    this.liveTerminalBindingIds = [...liveTerminalBindingIds].sort();

    const liveCount = this.liveTerminalBindingIds.length;
    const attached = session.status === 'active' && liveCount > 0;
    const commandTarget: ManagedSessionCommandTarget = {
      workSessionId: this.workSessionId,
      ticketKey: this.ticketKey,
      liveTerminalBindingIds: this.liveTerminalBindingIds,
    };

    this.id = `work-session:${session.id}`;
    this.contextValue = session.status === 'closed'
      ? 'work_session_closed'
      : !session.monitoring.enabled
        ? attached ? 'work_session_attached_paused' : 'work_session_detached_paused'
        : attached ? 'work_session_attached' : 'work_session_detached';
    this.description = sessionDescription(session, liveCount);
    this.tooltip = sessionTooltip(session, liveCount);
    this.iconPath = sessionIcon(session, attached);
    this.command = {
      command: attached ? 'kronos.focusWorkSessionTerminal' : 'kronos.reattachWorkSessionTerminal',
      title: attached ? 'Focus Managed Terminal' : 'Reattach Active Terminal',
      arguments: [commandTarget],
    };
  }
}

class ManagedSessionMessageTreeItem extends vscode.TreeItem {
  constructor() {
    super('No terminal work sessions yet', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'managed_session_empty';
    this.description = 'manage a focused terminal from a ticket';
    this.tooltip = 'Kronos organizes ticket context and provider monitoring around terminals you own and control.';
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

function sessionSortOrder(left: WorkSessionRecord, right: WorkSessionRecord): number {
  if (left.status !== right.status) { return left.status === 'active' ? -1 : 1; }
  return right.updatedAt.localeCompare(left.updatedAt)
    || left.ticketKey.localeCompare(right.ticketKey)
    || left.id.localeCompare(right.id);
}

function sessionDescription(session: WorkSessionRecord, liveCount: number): string {
  if (session.status === 'closed') { return 'management closed'; }
  const monitoring = session.monitoring.enabled
    ? `monitoring ${session.monitoring.lastState || 'waiting'}`
    : 'monitoring paused';
  if (liveCount === 0) { return `terminal detached • ${monitoring}`; }
  return `${liveCount} terminal${liveCount === 1 ? '' : 's'} attached • ${monitoring}`;
}

function sessionTooltip(session: WorkSessionRecord, liveCount: number): string {
  const terminalCounts = { attached: 0, detached: 0, closed: 0 };
  for (const terminal of session.terminals) {
    terminalCounts[terminal.status] += 1;
  }
  const providerBindings = session.providerBindings.length > 0
    ? session.providerBindings
      .map(binding => `${binding.provider} ${binding.resource} ${binding.subjectId}`)
      .join(', ')
    : 'none';
  const completeArtifacts = session.artifacts.filter(artifact => artifact.complete).length;
  const incompleteArtifacts = session.artifacts.length - completeArtifacts;
  const lines = [
    `Work session: ${session.id}`,
    `Ticket: ${session.ticketKey}`,
    `Title: ${session.title}`,
    `Status: ${session.status}`,
    'Terminal ownership: operator',
    `Live terminal bindings: ${liveCount}`,
    `Durable terminal history: ${terminalCounts.attached} attached, ${terminalCounts.detached} detached, ${terminalCounts.closed} closed`,
    `Provider bindings: ${providerBindings}`,
    `Context artifacts: ${completeArtifacts} complete, ${incompleteArtifacts} partial`,
    `Monitoring: ${session.monitoring.enabled ? 'enabled' : 'paused'}`,
    `Monitoring state: ${session.monitoring.lastState || 'not yet polled'}`,
    `Monitoring result: ${session.monitoring.lastSummary || 'none'}`,
    `Monitoring failures: ${session.monitoring.lastFailureCount ?? 0}`,
    `Monitoring skipped: ${session.monitoring.lastSkippedCount ?? 0}`,
    `Last monitoring attempt: ${session.monitoring.lastAttemptAt || 'never'}`,
    `Last successful poll: ${session.monitoring.lastPolledAt || 'never'}`,
    `Created: ${session.createdAt}`,
    `Updated: ${session.updatedAt}`,
  ];
  if (session.projectName) { lines.splice(4, 0, `Project: ${session.projectName}`); }
  if (session.projectPath) { lines.splice(5, 0, `Project path: ${session.projectPath}`); }
  if (session.closedAt) { lines.push(`Closed: ${session.closedAt}`); }
  return lines.join('\n');
}

function sessionIcon(session: WorkSessionRecord, attached: boolean): vscode.ThemeIcon {
  if (session.status === 'closed') {
    return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
  }
  return attached
    ? new vscode.ThemeIcon('terminal', new vscode.ThemeColor('testing.iconPassed'))
    : new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('charts.yellow'));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error.');
}
