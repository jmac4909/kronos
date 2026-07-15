import * as vscode from 'vscode';
import { boundedOperationFailure } from '../services/errorUtils';
import { OperatorTerminalRegistry } from '../services/operatorTerminalRegistry';
import { WorkSessionRecord, listWorkSessions } from '../services/workSessionStore';
import { readProjectGitBranch } from '../services/projectCatalog';
import { workSessionLifecycle } from '../services/workSessionLifecycle';
import {
  providerMonitoringHealthSummary,
  sessionProviderMonitoringHealth,
} from '../services/providerMonitoringHealth';

export interface ManagedSessionCommandTarget {
  workSessionId: string;
  ticketKey?: string;
  liveTerminalBindingIds: readonly string[];
}

type WorkSessionLoader = () => WorkSessionRecord[];
type SessionTreeElement = ManagedSessionTreeItem | ManagedSessionMessageTreeItem;

/** Operator-owned terminal sessions stay independent from registered project inventory. */
export class ManagedSessionTreeProvider implements vscode.TreeDataProvider<SessionTreeElement>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<SessionTreeElement | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly operatorTerminals: OperatorTerminalRegistry<vscode.Terminal>,
    private readonly loadWorkSessions: WorkSessionLoader = () => listWorkSessions(),
    private readonly pollIntervalMs: () => number = () => 300_000,
  ) {}

  getTreeItem(element: SessionTreeElement): vscode.TreeItem { return element; }

  async getChildren(element?: SessionTreeElement): Promise<SessionTreeElement[]> {
    if (element) { return []; }
    const sessions = this.safeLoadWorkSessions().sort((left, right) => sessionSortOrder(left, right));
    return sessions.length > 0
      ? sessions.map(session => new ManagedSessionTreeItem(
        session,
        this.operatorTerminals.listBindings(session.id).map(binding => binding.bindingId),
        this.pollIntervalMs(),
      ))
      : [new ManagedSessionMessageTreeItem()];
  }

  refresh(): void { this.changeEmitter.fire(undefined); }
  dispose(): void { this.changeEmitter.dispose(); }

  private safeLoadWorkSessions(): WorkSessionRecord[] {
    try { return this.loadWorkSessions(); }
    catch (error: unknown) {
      console.warn(`Kronos managed-session refresh failed: ${boundedOperationFailure(error, 'Managed session state could not be read.').display}`);
      return [];
    }
  }
}

export class ManagedSessionTreeItem extends vscode.TreeItem implements ManagedSessionCommandTarget {
  readonly workSessionId: string;
  readonly ticketKey?: string;
  readonly liveTerminalBindingIds: readonly string[];

  constructor(readonly session: WorkSessionRecord, liveTerminalBindingIds: readonly string[], pollIntervalMs: number) {
    super(sessionLabel(session), vscode.TreeItemCollapsibleState.None);
    this.workSessionId = session.id;
    if (session.kind === 'ticket') { this.ticketKey = session.ticketKey; }
    this.liveTerminalBindingIds = [...liveTerminalBindingIds].sort();
    const liveCount = this.liveTerminalBindingIds.length;
    const lifecycle = workSessionLifecycle(session, liveCount);
    const attached = lifecycle.terminal === 'attached';
    const commandTarget: ManagedSessionCommandTarget = {
      workSessionId: this.workSessionId,
      liveTerminalBindingIds: this.liveTerminalBindingIds,
    };
    if (this.ticketKey) { commandTarget.ticketKey = this.ticketKey; }
    this.id = `work-session:${session.id}`;
    const projectMonitoringSession = session.kind === 'standalone'
      && session.ticketKeys.length > 0
      && Boolean(session.projectName || session.projectPath);
    this.contextValue = session.kind === 'standalone' && !projectMonitoringSession
      ? session.status === 'closed' ? 'standalone_session_closed' : attached ? 'standalone_session_attached' : 'standalone_session_detached'
      : session.status === 'closed' ? 'work_session_closed'
        : !session.monitoring.enabled ? attached ? 'work_session_attached_paused' : 'work_session_detached_paused'
          : attached ? 'work_session_attached' : 'work_session_detached';
    this.description = sessionDescription(session, liveCount, pollIntervalMs);
    this.tooltip = sessionTooltip(session, liveCount, pollIntervalMs);
    this.iconPath = sessionIcon(session, attached);
    this.command = { command: 'kronos.focusWorkSessionTerminal', title: 'Open Session Terminal', arguments: [commandTarget] };
  }
}

class ManagedSessionMessageTreeItem extends vscode.TreeItem {
  constructor() {
    super('New Claude session', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'managed_session_empty';
    this.description = 'no Jira ticket required';
    this.iconPath = new vscode.ThemeIcon('add');
    this.command = {
      command: 'kronos.newClaudeSession',
      title: 'New Claude Session',
    };
  }
}

function sessionSortOrder(left: WorkSessionRecord, right: WorkSessionRecord): number {
  if (left.status !== right.status) { return left.status === 'active' ? -1 : 1; }
  return right.updatedAt.localeCompare(left.updatedAt) || sessionLabel(left).localeCompare(sessionLabel(right)) || left.id.localeCompare(right.id);
}

function sessionDescription(session: WorkSessionRecord, liveCount: number, pollIntervalMs: number): string {
  const lifecycle = workSessionLifecycle(session, liveCount);
  const branch = session.projectPath ? readProjectGitBranch(session.projectPath)?.branch : undefined;
  const project = branch ? `${session.projectName || 'project'} @ ${branch} • ` : '';
  if (lifecycle.management === 'stopped') { return `${project}management stopped`; }
  const contexts = session.ticketKeys.length > 0
    ? `${session.ticketKeys.length} ticket context${session.ticketKeys.length === 1 ? '' : 's'} • `
    : 'no ticket context • ';
  const terminal = lifecycle.terminal === 'attached'
    ? `${liveCount} terminal${liveCount === 1 ? '' : 's'} attached`
    : lifecycle.terminal === 'closed' ? 'terminal closed • reconnect available'
      : lifecycle.terminal === 'none' ? 'no terminal attached'
        : 'terminal detached';
  if (session.kind === 'standalone') {
    return `${project}${contexts}${terminal}`;
  }
  const health = sessionProviderMonitoringHealth(session, pollIntervalMs);
  const monitoring = lifecycle.monitoring === 'running'
    ? `auto-${providerMonitoringHealthSummary(health)}`
    : lifecycle.monitoring === 'paused' ? 'auto-poll paused' : 'auto-poll unavailable';
  return `${project}${contexts}${terminal} • ${monitoring}`;
}

function sessionTooltip(session: WorkSessionRecord, liveCount: number, pollIntervalMs: number): string {
  const lifecycle = workSessionLifecycle(session, liveCount);
  const terminalCounts = { attached: 0, detached: 0, closed: 0 };
  for (const terminal of session.terminals) { terminalCounts[terminal.status] += 1; }
  const providerBindings = session.providerBindings.length > 0
    ? session.providerBindings.map(binding => `${binding.provider} ${binding.resource} ${binding.subjectId}`).join(', ')
    : 'none yet; configured providers are discovered automatically';
  const completeArtifacts = session.artifacts.filter(artifact => artifact.complete).length;
  const health = sessionProviderMonitoringHealth(session, pollIntervalMs);
  const lines = [
    `Work session: ${session.id}`,
    `Ticket contexts: ${session.ticketKeys.join(', ') || 'none'}`,
    `Title: ${session.title}`,
    `Management lifecycle: ${lifecycle.management}`,
    `Terminal lifecycle: ${lifecycle.terminal}`,
    `Monitoring lifecycle: ${lifecycle.monitoring}`,
    'Select this session to open its attached terminal. If detached, choose an open terminal to reconnect.',
    'Terminal ownership: operator',
    `Live terminal bindings: ${liveCount}`,
    `Durable terminal history: ${terminalCounts.attached} attached, ${terminalCounts.detached} detached, ${terminalCounts.closed} closed`,
    `Provider bindings: ${providerBindings}`,
    `Context artifacts: ${completeArtifacts} complete, ${session.artifacts.length - completeArtifacts} partial`,
    `Automatic provider polling: ${session.monitoring.enabled ? 'enabled' : 'paused'}`,
    `Monitoring state: ${session.monitoring.lastState || 'not yet polled'}`,
    `Monitoring result: ${session.monitoring.lastSummary || 'none'}`,
    `Monitoring failures: ${session.monitoring.lastFailureCount ?? 0}`,
    `Monitoring skipped: ${session.monitoring.lastSkippedCount ?? 0}`,
    `Last monitoring attempt: ${session.monitoring.lastAttemptAt || 'never'}`,
    `Last successful poll: ${health.lastSuccessfulAt || 'never'}`,
    `Last meaningful provider change: ${health.lastMeaningfulChangeAt || 'never'}`,
    `Next scheduled poll: ${health.nextScheduledAt || 'not scheduled'}`,
    `Current normalized error: ${health.currentError || 'none'}`,
    `Suppressed unchanged polls since last change: ${health.suppressedUnchangedCount}`,
    `Created: ${session.createdAt}`,
    `Updated: ${session.updatedAt}`,
  ];
  if (session.projectName) { lines.splice(4, 0, `Project: ${session.projectName}`); }
  if (session.projectPath) { lines.splice(5, 0, `Project path: ${session.projectPath}`); }
  const branch = session.projectPath ? readProjectGitBranch(session.projectPath)?.branch : undefined;
  if (branch) { lines.splice(6, 0, `Git branch: ${branch}`); }
  if (session.closedAt) { lines.push(`Closed: ${session.closedAt}`); }
  return lines.join('\n');
}

function sessionLabel(session: WorkSessionRecord): string {
  if (session.projectName) { return `${session.projectName}: ${session.title}`; }
  return session.kind === 'ticket' ? `${session.ticketKey}: ${session.title}` : session.title;
}

function sessionIcon(session: WorkSessionRecord, attached: boolean): vscode.ThemeIcon {
  if (session.status === 'closed') { return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground')); }
  return attached
    ? new vscode.ThemeIcon('terminal', new vscode.ThemeColor('testing.iconPassed'))
    : new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('charts.yellow'));
}
