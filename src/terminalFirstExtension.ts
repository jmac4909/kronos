import * as vscode from 'vscode';
import type { ProjectConfig, Ticket } from './state/types';
import { TerminalFirstState } from './state/TerminalFirstState';
import { WorkTreeProvider } from './views/WorkTreeProvider';
import { ManagedSessionTreeProvider } from './views/ManagedSessionTreeProvider';
import { AttentionTreeProvider } from './views/AttentionTreeProvider';
import { loadProviderEnv } from './services/providerEnv';
import { unknownErrorMessage } from './services/errorUtils';
import { buildFallbackJiraTicketContext, normalizeJiraTicketContext, type JiraTicketContext } from './services/jiraTicketContext';
import { isJiraRestConfigured, jiraRestClient } from './services/jiraRestClient';
import { writeJiraContextArtifacts } from './services/jiraContextStore';
import {
  configuredGitLabProjectPathFromMergeRequestUrl,
  gitlabRestClient,
  isGitLabRestConfigured,
} from './services/gitlabRestClient';
import { normalizeGitLabMergeRequestContext } from './services/gitlabMergeRequestContext';
import { writeGitLabContextArtifacts } from './services/gitlabContextStore';
import { isJenkinsRestConfigured, jenkinsRestClient, type JenkinsBuildContext } from './services/jenkinsRestClient';
import { isSonarRestConfigured, sonarRestClient, type SonarBranchContext } from './services/sonarRestClient';
import { buildCiContext, writeCiContextArtifacts } from './services/ciContextStore';
import {
  buildCiContextReference,
  buildGitLabMergeRequestContextReference,
  buildJiraContextReference,
  insertTerminalContextReference,
} from './services/terminalContextInsertion';
import {
  createOperatorTerminalRegistry,
  type OperatorTerminalBinding,
  type OperatorTerminalRegistry,
} from './services/operatorTerminalRegistry';
import {
  addWorkSessionProviderBinding,
  attachWorkSessionTerminal,
  closeWorkSession,
  createOrGetWorkSessionByTicket,
  detachWorkSessionTerminal,
  getWorkSessionByTicket,
  listWorkSessionStoreIssues,
  listWorkSessions,
  readWorkSession,
  recordWorkSessionContextArtifact,
  reopenWorkSession,
  setWorkSessionMonitoring,
  type WorkSessionRecord,
} from './services/workSessionStore';
import {
  acknowledgeMonitorEvent,
  appendMonitorEvent,
  listMonitorEvents,
} from './services/monitorEventStore';
import { buildWorkSessionAuditMarkdown } from './services/workSessionAuditView';
import {
  ManagedProviderMonitor,
  configuredSonarBranch,
  type ManagedProviderNotice,
  type ManagedProviderPollResult,
} from './services/managedProviderMonitor';
import { buildTicketWorkspaceHtml } from './services/ticketWorkspaceView';
import {
  WEBVIEW_ACTION_PANEL_SCRIPT,
  WEBVIEW_READY_COMMAND,
  createWebviewNonce,
  webviewScriptCspOptions,
  withWebviewCsp,
} from './services/webviewSecurity';
import { normalizeActionPanelMessage } from './services/webviewMessages';
import { isRecord } from './services/records';

const TICKET_WORKSPACE_ACTIONS = new Set([
  'manageActiveTerminal',
  'insertJiraContext',
  'insertGitLabContext',
  'insertCiContext',
]);

interface TicketPanelRecord {
  panel: vscode.WebviewPanel;
  nonce: string;
}

interface TerminalSelection {
  terminal: vscode.Terminal;
  workSession?: WorkSessionRecord;
  binding?: OperatorTerminalBinding;
}

interface GitLabInsertionTarget {
  iid: number;
  projectIdOrPath: string;
  url?: string;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(new TerminalFirstRuntime(context));
}

export function deactivate(): void {}

class TerminalFirstRuntime implements vscode.Disposable {
  private readonly state = new TerminalFirstState();
  private readonly operatorTerminals: OperatorTerminalRegistry<vscode.Terminal> = createOperatorTerminalRegistry();
  private readonly workTree = new WorkTreeProvider(this.state);
  private readonly sessionTree = new ManagedSessionTreeProvider(this.operatorTerminals);
  private readonly attentionTree = new AttentionTreeProvider();
  private readonly output = vscode.window.createOutputChannel('Kronos Terminal Work Companion');
  private readonly disposables: vscode.Disposable[] = [];
  private readonly ticketPanels = new Map<string, TicketPanelRecord>();
  private readonly monitor: ManagedProviderMonitor;
  private refreshTimer: NodeJS.Timeout | undefined;
  private providerTimer: NodeJS.Timeout | undefined;
  private ticketRefreshRunning = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.loadProviderEnvironment();
    this.monitor = new ManagedProviderMonitor({
      state: () => this.state.state,
      log: (message, detail) => this.log(message, detail),
      notify: notice => this.showProviderNotice(notice),
      refresh: () => this.refreshTerminalFirstViews(),
    });

    this.disposables.push(
      vscode.window.registerTreeDataProvider('kronosWork', this.workTree),
      vscode.window.registerTreeDataProvider('kronosSessions', this.sessionTree),
      vscode.window.registerTreeDataProvider('kronosAttention', this.attentionTree),
      this.state.onDidChange(() => {
        this.workTree.refresh();
        this.refreshTicketPanels();
      }),
      vscode.window.onDidCloseTerminal(terminal => this.handleClosedTerminal(terminal)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('kronos.refreshIntervalSec')
          || event.affectsConfiguration('kronos.managedProviderPollIntervalSec')) {
          this.startTimers();
        }
      }),
    );
    this.registerCommands();
    this.startTimers();
    this.log('Kronos terminal-first runtime activated.', 'No agent, terminal, project command, or Git mutation was started.');
  }

  dispose(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); }
    if (this.providerTimer) { clearInterval(this.providerTimer); }
    for (const panel of this.ticketPanels.values()) { panel.panel.dispose(); }
    this.ticketPanels.clear();
    for (const disposable of this.disposables.splice(0)) { disposable.dispose(); }
    this.operatorTerminals.clear();
    this.workTree.dispose();
    this.sessionTree.dispose();
    this.attentionTree.dispose();
    this.state.dispose();
    this.output.dispose();
  }

  private registerCommands(): void {
    this.command('kronos.refreshTickets', async () => this.refreshTickets(true));
    this.command('kronos.filterWork', async () => {
      const current = this.workTree.getFilter().query || '';
      const query = await vscode.window.showInputBox({
        title: 'Filter Kronos Work',
        prompt: 'Match ticket key, summary, status, label, project, MR, or build',
        value: current,
      });
      if (query !== undefined) { this.workTree.setFilter(query); }
    });
    this.command('kronos.clearWorkFilter', () => this.workTree.clearFilter());
    this.command('kronos.openTicketWorkspace', async argument => this.openTicketWorkspace(argument));
    this.command('kronos.manageActiveTerminal', async argument => this.manageFocusedTerminal(argument));
    this.command('kronos.insertJiraContext', async argument => this.insertJiraContext(argument));
    this.command('kronos.insertGitLabContext', async argument => this.insertGitLabContext(argument));
    this.command('kronos.insertCiContext', async argument => this.insertCiContext(argument));
    this.command('kronos.pollManagedWorkSessions', async () => this.pollProviders(true));
    this.command('kronos.openWorkSessionAudit', async argument => this.openWorkSessionAudit(argument));
    this.command('kronos.focusWorkSessionTerminal', async argument => this.focusWorkSessionTerminal(argument));
    this.command('kronos.reattachWorkSessionTerminal', async argument => this.reattachFocusedTerminal(argument));
    this.command('kronos.detachWorkSessionTerminal', async argument => this.detachManagedTerminal(argument));
    this.command('kronos.closeWorkSession', async argument => this.stopManagingSession(argument));
    this.command('kronos.pauseWorkSessionMonitoring', async argument => this.setMonitoring(argument, false));
    this.command('kronos.resumeWorkSessionMonitoring', async argument => this.setMonitoring(argument, true));
    this.command('kronos.acknowledgeAttention', async argument => this.acknowledgeAttention(argument));
    this.command('kronos.openProvider', async argument => this.openProvider(argument));
    this.command('kronos.doctor', async () => this.openDoctor());
    this.command('kronos.settings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'Kronos Terminal Work Companion');
    });
  }

  private command(id: string, handler: (...args: unknown[]) => unknown): void {
    this.disposables.push(vscode.commands.registerCommand(id, handler));
  }

  private loadProviderEnvironment(): void {
    const result = loadProviderEnv();
    if (result.error) {
      this.log('Could not load the local provider environment.', result.error);
      void vscode.window.showWarningMessage('Kronos could not load its provider environment file. Provider reads may be unavailable; run Kronos: Doctor.');
    } else if (result.present) {
      this.log('Loaded local provider environment.', `${result.loaded} value(s) loaded; ${result.skippedExisting} existing value(s) preserved.`);
    }
  }

  private startTimers(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); }
    if (this.providerTimer) { clearInterval(this.providerTimer); }
    const refreshMs = this.configurationIntervalMs('refreshIntervalSec', 300);
    const providerMs = this.configurationIntervalMs('managedProviderPollIntervalSec', 300);
    this.refreshTimer = setInterval(() => { void this.refreshTickets(false); }, refreshMs);
    this.providerTimer = setInterval(() => { void this.pollProviders(false); }, providerMs);
    this.refreshTimer.unref();
    this.providerTimer.unref();
  }

  private configurationIntervalMs(key: string, fallbackSeconds: number): number {
    const configured = vscode.workspace.getConfiguration('kronos').get<number>(key, fallbackSeconds);
    const seconds = typeof configured === 'number' && Number.isFinite(configured)
      ? Math.max(15, Math.floor(configured))
      : fallbackSeconds;
    return seconds * 1000;
  }

  private async refreshTickets(showResult: boolean): Promise<void> {
    if (this.ticketRefreshRunning) {
      if (showResult) { void vscode.window.showInformationMessage('A Jira ticket refresh is already running.'); }
      return;
    }
    this.ticketRefreshRunning = true;
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kronos: Reading Jira work metadata...' },
        async () => this.state.refreshTickets(),
      );
      if (result.warnings.length > 0) {
        this.log('Jira Work refresh completed with bounded-read warnings.', result.warnings.join(' '));
      }
      if (showResult) {
        const retained = result.retainedFromPrevious > 0
          ? ` ${result.retainedFromPrevious} prior ticket${result.retainedFromPrevious === 1 ? ' was' : 's were'} retained because the read was partial.`
          : '';
        const message = `Kronos refreshed ${result.ticketCount} Jira ticket${result.ticketCount === 1 ? '' : 's'} across ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}.${retained}`;
        if (result.complete && result.warnings.length === 0) { void vscode.window.showInformationMessage(message); }
        else { void vscode.window.showWarningMessage(`${message} Open Doctor for details.`); }
      }
    } catch (error: unknown) {
      const detail = unknownErrorMessage(error, 'Jira ticket refresh failed.');
      this.log('Jira ticket refresh failed.', detail);
      if (showResult) { void vscode.window.showWarningMessage(`${detail} Run Kronos: Doctor for configuration details.`); }
    } finally {
      this.ticketRefreshRunning = false;
    }
  }

  private async openTicketWorkspace(argument: unknown): Promise<void> {
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    const existing = this.ticketPanels.get(ticketKey);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      this.renderTicketPanel(ticketKey, existing);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'kronosTicketWorkspace',
      `${ticketKey} — Terminal Workspace`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      },
    );
    const record: TicketPanelRecord = { panel, nonce: createWebviewNonce() };
    this.ticketPanels.set(ticketKey, record);
    panel.onDidDispose(() => this.ticketPanels.delete(ticketKey));
    panel.webview.onDidReceiveMessage(async raw => {
      if (isRecord(raw) && raw['command'] === WEBVIEW_READY_COMMAND) { return; }
      const message = normalizeActionPanelMessage(raw, TICKET_WORKSPACE_ACTIONS);
      if (!message || message.ticket !== ticketKey) {
        void vscode.window.showWarningMessage('Kronos ignored an invalid ticket-workspace request.');
        return;
      }
      const command = `kronos.${message.command}`;
      await vscode.commands.executeCommand(command, { ticketKey });
      const current = this.ticketPanels.get(ticketKey);
      if (current) { this.renderTicketPanel(ticketKey, current); }
    });
    this.renderTicketPanel(ticketKey, record);
  }

  private renderTicketPanel(ticketKey: string, record: TicketPanelRecord): void {
    const ticket = this.state.state?.tickets[ticketKey];
    if (!ticket) {
      record.panel.webview.html = '<!DOCTYPE html><html><body><p>This ticket is no longer present in the local Work state.</p></body></html>';
      return;
    }
    const session = getWorkSessionByTicket(ticketKey);
    const actionScriptUri = record.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', WEBVIEW_ACTION_PANEL_SCRIPT),
    ).toString();
    const html = buildTicketWorkspaceHtml({
      ticketKey,
      ticket,
      nonce: record.nonce,
      actionScriptUri,
      workSession: session,
      liveTerminalCount: session ? this.operatorTerminals.listBindings(session.id).length : 0,
    });
    record.panel.webview.html = withWebviewCsp(
      html,
      webviewScriptCspOptions(record.panel.webview.cspSource, record.nonce),
    );
  }

  private refreshTicketPanels(): void {
    for (const [ticketKey, record] of this.ticketPanels) { this.renderTicketPanel(ticketKey, record); }
  }

  private async manageFocusedTerminal(argument: unknown): Promise<void> {
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      void vscode.window.showWarningMessage('Focus the already-running interactive terminal you want Kronos to organize, then try again.');
      return;
    }
    const sessionInput: Parameters<typeof createOrGetWorkSessionByTicket>[0] = {
      ticketKey,
      title: ticket.summary,
    };
    const projectName = ticket.projects[0];
    if (projectName) {
      sessionInput.projectName = projectName;
      const projectPath = this.state.state?.projects[projectName]?.path;
      if (projectPath) { sessionInput.projectPath = projectPath; }
    }
    let session = createOrGetWorkSessionByTicket(sessionInput);
    if (session.status === 'closed') { session = reopenWorkSession(session.id); }
    session = this.ensureProviderBindings(session, ticket);
    await this.attachTerminal(session, terminal);
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(
      `${terminal.name} is now organized under ${ticketKey}. Kronos did not start, read, or control the terminal.`,
    );
  }

  private async attachTerminal(session: WorkSessionRecord, terminal: vscode.Terminal): Promise<WorkSessionRecord> {
    const previous = this.operatorTerminals.bindingForTerminal(terminal);
    if (previous && previous.sessionId !== session.id) {
      detachWorkSessionTerminal(previous.sessionId, previous.bindingId, 'Terminal reassigned by the operator.');
      this.appendTerminalDetachedEvent(previous, 'reassigned');
    }
    let processId: number | undefined;
    try { processId = await terminal.processId; } catch { processId = undefined; }
    const input: Parameters<typeof attachWorkSessionTerminal>[1] = { name: terminal.name };
    if (previous?.sessionId === session.id) { input.bindingId = previous.bindingId; }
    if (processId !== undefined) { input.processId = processId; }
    const cwd = terminal.shellIntegration?.cwd?.fsPath;
    if (cwd) { input.cwd = cwd; }
    const updated = attachWorkSessionTerminal(session.id, input);
    const persisted = input.bindingId
      ? updated.terminals.find(binding => binding.id === input.bindingId)
      : updated.terminals[updated.terminals.length - 1];
    if (!persisted) { throw new Error('Kronos could not persist the terminal attachment.'); }
    this.operatorTerminals.attach(terminal, { sessionId: updated.id, bindingId: persisted.id });
    appendMonitorEvent({
      sessionId: updated.id,
      type: 'terminal.attached',
      source: 'operator',
      summary: `${updated.ticketKey} operator terminal attached.`,
      subject: { kind: 'work-session', id: updated.id, ticketKey: updated.ticketKey },
      metadata: { terminalBindingId: persisted.id },
    });
    return updated;
  }

  private ensureProviderBindings(session: WorkSessionRecord, ticket: Ticket): WorkSessionRecord {
    let updated = session;
    const projectName = ticket.projects[0];
    const config = projectName ? this.state.state?.projects[projectName]?.config : undefined;
    if (ticket.source === 'jira') {
      const binding: Parameters<typeof addWorkSessionProviderBinding>[1] = {
        provider: 'jira',
        resource: 'ticket',
        subjectId: session.ticketKey,
      };
      if (ticket.jira_url) { binding.url = ticket.jira_url; }
      updated = addWorkSessionProviderBinding(updated.id, binding);
    }
    if (ticket.mr?.iid) {
      const binding: Parameters<typeof addWorkSessionProviderBinding>[1] = {
        provider: 'gitlab',
        resource: 'merge-request',
        subjectId: String(ticket.mr.iid),
      };
      if (config?.gitlab_project_id) { binding.projectId = String(config.gitlab_project_id); }
      if (ticket.mr.url) { binding.url = ticket.mr.url; }
      updated = addWorkSessionProviderBinding(updated.id, binding);
    }
    const jenkinsUrl = ticket.build?.url || config?.jenkins_url;
    if (jenkinsUrl) {
      updated = addWorkSessionProviderBinding(updated.id, {
        id: 'jenkins-build',
        provider: 'jenkins',
        resource: 'build',
        subjectId: ticket.build ? String(ticket.build.number) : 'latest',
        url: jenkinsUrl,
      });
    }
    const sonarTarget = configuredSonarBranch(this.state.state, session.ticketKey);
    if (sonarTarget) {
      updated = addWorkSessionProviderBinding(updated.id, {
        id: 'sonar-quality-gate',
        provider: 'sonar',
        resource: 'quality-gate',
        subjectId: `${sonarTarget.projectKey}:${sonarTarget.branch}`,
        projectId: sonarTarget.projectKey,
      });
    }
    return updated;
  }

  private async insertJiraContext(argument: unknown): Promise<void> {
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    if (ticket.source !== 'jira') {
      void vscode.window.showWarningMessage(`${ticketKey} is not a Jira ticket.`);
      return;
    }
    const selection = await this.chooseInsertionTerminal(ticketKey);
    if (!selection) { return; }

    await this.runProgress(`Kronos: Preparing ${ticketKey} Jira context...`, async progress => {
      let jiraContext: JiraTicketContext | undefined;
      const warnings: string[] = [];
      if (isJiraRestConfigured()) {
        progress.report({ message: 'Reading visible fields, comments, and bounded safe-text attachments...' });
        try {
          const snapshot = await jiraRestClient.ticketContext(ticketKey, ticket.jira_url);
          jiraContext = normalizeJiraTicketContext(ticketKey, snapshot, { ...ticket });
        } catch (error: unknown) {
          warnings.push(`${unknownErrorMessage(error, 'Native Jira REST read failed.')} Cached ticket data was inserted instead.`);
        }
      } else {
        warnings.push('Native Jira REST credentials are unavailable. Cached ticket data was inserted instead.');
      }
      if (!jiraContext) {
        jiraContext = buildFallbackJiraTicketContext(ticketKey, { ...ticket }, [], warnings);
      }
      progress.report({ message: 'Writing private content-addressed context...' });
      const artifact = writeJiraContextArtifacts(jiraContext);
      if (!this.insertionTerminalUnchanged(selection)) {
        void vscode.window.showWarningMessage(`${ticketKey} context was saved, but the terminal attachment changed. Reattach the intended terminal and insert again.`);
        return;
      }
      insertTerminalContextReference(selection.terminal, buildJiraContextReference(ticketKey, artifact.promptPath));
      if (selection.workSession) {
        recordWorkSessionContextArtifact(selection.workSession.id, {
          id: `jira-${ticketKey}`,
          kind: 'jira-ticket',
          label: `[${ticketKey}] Jira context`,
          promptPath: artifact.promptPath,
          fetchedAt: jiraContext.fetchedAt,
          complete: jiraContext.completeness.complete,
          warnings: jiraContext.completeness.warnings,
          contentSha256: artifact.contentSha256,
        });
        this.appendContextEvent(selection.workSession, 'jira', ticketKey, artifact.promptPath, artifact.contentSha256);
      }
      this.refreshTerminalFirstViews();
      const summary = `${jiraContext.completeness.fieldCount} fields (${jiraContext.completeness.customFieldCount} custom), ${jiraContext.comments.length} comments, ${jiraContext.completeness.attachmentBodiesCaptured}/${jiraContext.completeness.attachmentsTotal} attachment bodies`;
      const message = `Inserted [${ticketKey}] into ${selection.terminal.name} without submitting it (${summary}).`;
      if (jiraContext.completeness.complete) {
        void vscode.window.showInformationMessage(`${message} Review or extend it, then press Enter yourself.`);
      } else {
        const action = await vscode.window.showWarningMessage(
          `${message} Cached or partial context was used; review its warnings.`,
          'Open Context',
          'Run Doctor',
        );
        if (action === 'Open Context') { await this.openLocalArtifact(artifact.promptPath); }
        if (action === 'Run Doctor') { await vscode.commands.executeCommand('kronos.doctor'); }
      }
    });
  }

  private async insertGitLabContext(argument: unknown): Promise<void> {
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    const target = await this.resolveGitLabInsertionTarget(ticketKey, ticket);
    if (!target) { return; }
    const { iid, projectIdOrPath } = target;
    const selection = await this.chooseInsertionTerminal(ticketKey);
    if (!selection) { return; }

    await this.runProgress(`Kronos: Preparing MR-${iid} context...`, async progress => {
      progress.report({ message: 'Reading MR, discussions, diffs, pipeline, jobs, and tests...' });
      const snapshot = await gitlabRestClient.mergeRequestContext({ projectIdOrPath, iid });
      const context = normalizeGitLabMergeRequestContext(ticketKey, iid, snapshot);
      const artifact = writeGitLabContextArtifacts(context);
      if (!this.insertionTerminalUnchanged(selection)) {
        void vscode.window.showWarningMessage(`MR-${iid} context was saved, but the terminal attachment changed. Reattach and insert again.`);
        return;
      }
      insertTerminalContextReference(selection.terminal, buildGitLabMergeRequestContextReference(iid, artifact.promptPath));
      if (selection.workSession) {
        const mergeRequestBinding: Parameters<typeof addWorkSessionProviderBinding>[1] = {
          provider: 'gitlab',
          resource: 'merge-request',
          subjectId: String(iid),
          projectId: projectIdOrPath,
        };
        if (target.url) { mergeRequestBinding.url = target.url; }
        let session = addWorkSessionProviderBinding(selection.workSession.id, mergeRequestBinding);
        if (context.pipeline) {
          const pipelineBinding: Parameters<typeof addWorkSessionProviderBinding>[1] = {
            provider: 'gitlab',
            resource: 'pipeline',
            subjectId: String(context.pipeline.id),
          };
          if (context.pipeline.projectId) { pipelineBinding.projectId = String(context.pipeline.projectId); }
          if (context.pipeline.webUrl) { pipelineBinding.url = context.pipeline.webUrl; }
          session = addWorkSessionProviderBinding(session.id, pipelineBinding);
        }
        recordWorkSessionContextArtifact(session.id, {
          id: `gitlab-mr-${iid}`,
          kind: 'gitlab-merge-request',
          label: `[MR-${iid}] GitLab MR and pipeline context`,
          promptPath: artifact.promptPath,
          fetchedAt: context.fetchedAt,
          complete: context.completeness.complete,
          warnings: context.completeness.warnings,
          contentSha256: artifact.contentSha256,
        });
        this.appendContextEvent(session, 'gitlab', String(iid), artifact.promptPath, artifact.contentSha256);
      }
      this.refreshTerminalFirstViews();
      const failedTests = context.testReport?.failedCount ?? context.testReportSummary?.failedCount ?? 0;
      const message = `Inserted [MR-${iid}] into ${selection.terminal.name} without submitting it (${context.notes.length} notes, ${context.jobs.length} jobs, ${failedTests} failed tests).`;
      if (context.completeness.complete) {
        void vscode.window.showInformationMessage(`${message} Review it, then press Enter yourself.`);
      } else {
        void vscode.window.showWarningMessage(`${message} The saved MR context is partial; review its warnings.`);
      }
    });
  }

  private async insertCiContext(argument: unknown): Promise<void> {
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    const selection = await this.chooseInsertionTerminal(ticketKey);
    if (!selection) { return; }
    const config = this.projectConfig(ticket);
    const jenkinsUrl = ticket.build?.url || config?.jenkins_url;
    const sonarTarget = configuredSonarBranch(this.state.state, ticketKey);
    if (!jenkinsUrl && !sonarTarget) {
      void vscode.window.showWarningMessage(`${ticketKey} has no linked Jenkins URL or SonarQube project/branch.`);
      return;
    }

    await this.runProgress(`Kronos: Preparing ${ticketKey} CI context...`, async progress => {
      const warnings: string[] = [];
      let jenkins: JenkinsBuildContext | undefined;
      let sonar: SonarBranchContext | undefined;
      if (jenkinsUrl) {
        progress.report({ message: 'Reading Jenkins build, stages, and tests...' });
        try { jenkins = await jenkinsRestClient.buildContext(jenkinsUrl); }
        catch (error: unknown) { warnings.push(unknownErrorMessage(error, 'Jenkins context was unavailable.')); }
      }
      if (sonarTarget) {
        progress.report({ message: 'Reading SonarQube gate, measures, and issues...' });
        try { sonar = await sonarRestClient.branchContext(sonarTarget.projectKey, sonarTarget.branch); }
        catch (error: unknown) { warnings.push(unknownErrorMessage(error, 'SonarQube context was unavailable.')); }
      }
      if (!jenkins && !sonar) { throw new Error('Neither Jenkins nor SonarQube context could be read. Run Kronos: Doctor.'); }
      const input: { jenkins?: JenkinsBuildContext; sonar?: SonarBranchContext; warnings: string[] } = { warnings };
      if (jenkins) { input.jenkins = jenkins; }
      if (sonar) { input.sonar = sonar; }
      const context = buildCiContext(ticketKey, input);
      const artifact = writeCiContextArtifacts(context);
      if (!this.insertionTerminalUnchanged(selection)) {
        void vscode.window.showWarningMessage(`${ticketKey} CI context was saved, but the terminal attachment changed. Reattach and insert again.`);
        return;
      }
      insertTerminalContextReference(selection.terminal, buildCiContextReference(ticketKey, artifact.promptPath));
      if (selection.workSession) {
        let session = selection.workSession;
        if (jenkins) {
          session = addWorkSessionProviderBinding(session.id, {
            id: 'jenkins-build',
            provider: 'jenkins',
            resource: 'build',
            subjectId: String(jenkins.build.number),
            url: jenkinsUrl || jenkins.build.url,
          });
        }
        if (sonar && sonarTarget) {
          session = addWorkSessionProviderBinding(session.id, {
            id: 'sonar-quality-gate',
            provider: 'sonar',
            resource: 'quality-gate',
            subjectId: `${sonarTarget.projectKey}:${sonarTarget.branch}`,
            projectId: sonarTarget.projectKey,
            url: sonar.dashboardUrl,
          });
        }
        recordWorkSessionContextArtifact(session.id, {
          id: `ci-${ticketKey}`,
          kind: 'ci-evidence',
          label: `[CI-${ticketKey}] Jenkins and SonarQube context`,
          promptPath: artifact.promptPath,
          fetchedAt: context.fetchedAt,
          complete: context.completeness.complete,
          warnings: context.completeness.warnings,
          contentSha256: artifact.contentSha256,
        });
        this.appendContextEvent(session, 'kronos', ticketKey, artifact.promptPath, artifact.contentSha256);
      }
      this.refreshTerminalFirstViews();
      const message = `Inserted [CI-${ticketKey}] into ${selection.terminal.name} without submitting it.`;
      if (context.completeness.complete) {
        void vscode.window.showInformationMessage(`${message} Review it, then press Enter yourself.`);
      } else {
        void vscode.window.showWarningMessage(`${message} One or more provider components were partial; review the saved warnings.`);
      }
    });
  }

  private async chooseInsertionTerminal(ticketKey: string): Promise<TerminalSelection | undefined> {
    const session = getWorkSessionByTicket(ticketKey);
    if (session?.status === 'active') {
      const terminal = vscode.window.activeTerminal;
      if (!terminal) {
        void vscode.window.showWarningMessage(`Focus the terminal managed for ${ticketKey} before inserting context.`);
        return undefined;
      }
      const binding = this.operatorTerminals.bindingForTerminal(terminal);
      if (binding?.sessionId !== session.id) {
        void vscode.window.showWarningMessage(
          `The focused terminal is not managed for ${ticketKey}. Focus its attached terminal or explicitly reattach this one before inserting context.`,
        );
        return undefined;
      }
      return { terminal, workSession: session, binding };
    }
    void vscode.window.showWarningMessage(
      `Manage the focused operator-owned terminal for ${ticketKey} before inserting context. This explicit association prevents insertion into the wrong terminal.`,
    );
    return undefined;
  }

  private async chooseLiveTerminal(sessionId: string): Promise<{ terminal: vscode.Terminal; binding: OperatorTerminalBinding } | undefined> {
    const active = vscode.window.activeTerminal;
    if (active) {
      const binding = this.operatorTerminals.bindingForTerminal(active);
      if (binding?.sessionId === sessionId) { return { terminal: active, binding }; }
    }
    const bindings = this.operatorTerminals.listBindings(sessionId);
    if (bindings.length === 0) { return undefined; }
    let selected = bindings[0];
    if (bindings.length > 1) {
      const session = readWorkSession(sessionId);
      const pick = await vscode.window.showQuickPick(bindings.map(binding => ({
        label: session?.terminals.find(candidate => candidate.id === binding.bindingId)?.name || binding.bindingId,
        description: binding.bindingId,
        binding,
      })), { title: 'Choose the operator-owned terminal for this action' });
      selected = pick?.binding;
    }
    if (!selected) { return undefined; }
    const resolved = this.operatorTerminals.resolve(sessionId, selected.bindingId);
    return resolved.kind === 'resolved' ? { terminal: resolved.terminal, binding: resolved.binding } : undefined;
  }

  private insertionTerminalUnchanged(selection: TerminalSelection): boolean {
    if (!selection.binding) { return vscode.window.activeTerminal === selection.terminal; }
    const resolved = this.operatorTerminals.resolve(selection.binding.sessionId, selection.binding.bindingId);
    return resolved.kind === 'resolved' && resolved.terminal === selection.terminal;
  }

  private async pollProviders(showResult: boolean): Promise<void> {
    let result: ManagedProviderPollResult;
    try {
      result = await this.monitor.poll();
    } catch (error: unknown) {
      const detail = unknownErrorMessage(error, 'Managed provider poll failed.');
      this.log('Managed provider poll failed.', detail);
      if (showResult) { void vscode.window.showWarningMessage(detail); }
      return;
    }
    if (!showResult) { return; }
    if (result.leaseUnavailable && result.polled === 0) {
      void vscode.window.showInformationMessage('Another Kronos window owns the provider-monitoring lease; no duplicate read was started.');
      return;
    }
    const message = `Read ${result.polled} provider context${result.polled === 1 ? '' : 's'}; recorded ${result.transitions} new attention item${result.transitions === 1 ? '' : 's'}; ${result.failures} failed; ${result.skipped} skipped.`;
    if (result.failures > 0 || result.leaseUnavailable) { void vscode.window.showWarningMessage(message); }
    else { void vscode.window.showInformationMessage(message); }
  }

  private showProviderNotice(notice: ManagedProviderNotice): void {
    try {
      const notificationEvent: Parameters<typeof appendMonitorEvent>[0] = {
        sessionId: notice.session.id,
        type: 'notification.shown',
        source: 'kronos',
        summary: notice.event.summary,
        metadata: { transitionEventId: notice.event.id },
      };
      if (notice.event.subject) { notificationEvent.subject = notice.event.subject; }
      appendMonitorEvent(notificationEvent);
    } catch (error: unknown) {
      this.log('Could not record provider notification display.', unknownErrorMessage(error, 'Notification audit failed.'));
    }
    const actions = [
      ...(notice.providerUrl ? ['Open Provider'] : []),
      ...(notice.contextCommand ? ['Insert Fresh Context'] : []),
      'Acknowledge',
    ];
    const prompt = notice.severity === 'warning'
      ? vscode.window.showWarningMessage(notice.event.summary, ...actions)
      : vscode.window.showInformationMessage(notice.event.summary, ...actions);
    void prompt.then(async action => {
      if (action === 'Open Provider' && notice.providerUrl) { await this.openHttpUrl(notice.providerUrl); }
      if (action === 'Insert Fresh Context' && notice.contextCommand) {
        await vscode.commands.executeCommand(notice.contextCommand, { ticketKey: notice.session.ticketKey });
      }
      if (action === 'Acknowledge') {
        acknowledgeMonitorEvent(notice.event.id, notice.session.id);
        this.attentionTree.refresh();
      }
    }, error => this.log('Provider notification action failed.', unknownErrorMessage(error, 'Notification action failed.')));
  }

  private async openWorkSessionAudit(argument: unknown): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const events = listMonitorEvents({ sessionId: session.id, limit: 1000 });
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: buildWorkSessionAuditMarkdown(session, events),
    });
    await vscode.window.showTextDocument(document, { preview: true, viewColumn: vscode.ViewColumn.One });
  }

  private async focusWorkSessionTerminal(argument: unknown): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const selected = await this.chooseLiveTerminal(session.id);
    if (!selected) {
      void vscode.window.showWarningMessage(`${session.ticketKey} has no live attached terminal. Focus it and choose Reattach Focused Terminal.`);
      return;
    }
    selected.terminal.show(false);
  }

  private async reattachFocusedTerminal(argument: unknown): Promise<void> {
    let session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      void vscode.window.showWarningMessage('Focus the intended existing terminal before reattaching it.');
      return;
    }
    if (session.status === 'closed') { session = reopenWorkSession(session.id); }
    const ticket = this.state.state?.tickets[session.ticketKey];
    if (ticket) { session = this.ensureProviderBindings(session, ticket); }
    await this.attachTerminal(session, terminal);
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(`Reattached ${terminal.name} to ${session.ticketKey}. Terminal contents were not read.`);
  }

  private async detachManagedTerminal(argument: unknown): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const selected = await this.chooseLiveTerminal(session.id);
    if (!selected) {
      void vscode.window.showInformationMessage(`${session.ticketKey} has no live terminal attachment.`);
      return;
    }
    this.operatorTerminals.detachBinding(session.id, selected.binding.bindingId);
    detachWorkSessionTerminal(session.id, selected.binding.bindingId, 'Detached explicitly by the operator.');
    this.appendTerminalDetachedEvent(selected.binding, 'operator-detached');
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(`Detached ${selected.terminal.name} from ${session.ticketKey}. The terminal remains open.`);
  }

  private async stopManagingSession(argument: unknown): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const confirmation = await vscode.window.showWarningMessage(
      `Stop organizing ${session.ticketKey}? Monitoring will stop, but every terminal remains open and untouched.`,
      { modal: true },
      'Stop Managing',
    );
    if (confirmation !== 'Stop Managing') { return; }
    this.operatorTerminals.detachSession(session.id);
    closeWorkSession(session.id);
    appendMonitorEvent({
      sessionId: session.id,
      type: 'decision.recorded',
      source: 'operator',
      summary: `${session.ticketKey} work-session management stopped by the operator.`,
      subject: { kind: 'work-session', id: session.id, ticketKey: session.ticketKey },
      metadata: { monitoringEnabled: false, terminalClosed: false },
    });
    this.refreshTerminalFirstViews();
  }

  private async setMonitoring(argument: unknown, enabled: boolean): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    if (session.status !== 'active') {
      void vscode.window.showWarningMessage(`Reattach ${session.ticketKey} before enabling monitoring.`);
      return;
    }
    setWorkSessionMonitoring(session.id, enabled);
    appendMonitorEvent({
      sessionId: session.id,
      type: 'decision.recorded',
      source: 'operator',
      summary: `${session.ticketKey} monitoring ${enabled ? 'resumed' : 'paused'} by the operator.`,
      subject: { kind: 'work-session', id: session.id, ticketKey: session.ticketKey },
      metadata: { monitoringEnabled: enabled },
    });
    this.refreshTerminalFirstViews();
  }

  private async acknowledgeAttention(argument: unknown): Promise<void> {
    const eventId = stringProperty(argument, 'eventId');
    const sessionId = stringProperty(argument, 'sessionId') || stringProperty(argument, 'workSessionId');
    if (!eventId || !sessionId) {
      void vscode.window.showWarningMessage('Select an Attention item to acknowledge.');
      return;
    }
    acknowledgeMonitorEvent(eventId, sessionId);
    this.attentionTree.refresh();
  }

  private async openProvider(argument: unknown): Promise<void> {
    const providerUrl = stringProperty(argument, 'providerUrl') || stringProperty(argument, 'url');
    if (!providerUrl) {
      void vscode.window.showWarningMessage('This Attention item has no validated provider URL.');
      return;
    }
    await this.openHttpUrl(providerUrl);
  }

  private async openDoctor(): Promise<void> {
    const stateIssues = this.state.loadIssues;
    const sessionIssues = listWorkSessionStoreIssues();
    const rows = [
      doctorRow('Work catalog', this.state.state !== null && stateIssues.length === 0, `${Object.keys(this.state.state?.tickets || {}).length} Jira ticket(s); ${stateIssues.length} local issue(s)`),
      doctorRow('Jira REST', isJiraRestConfigured(), 'Requires JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.'),
      doctorRow('GitLab REST', isGitLabRestConfigured(), 'Requires a GitLab URL/token plus a project ID or parseable MR URL.'),
      doctorRow('Jenkins REST', isJenkinsRestConfigured(), 'Uses configured Jenkins URLs and inherited credentials when required.'),
      doctorRow('SonarQube REST', isSonarRestConfigured(), 'Requires SonarQube URL/token and a project/branch binding.'),
      doctorRow('Private work-session state', sessionIssues.length === 0, `${listWorkSessions().length} session(s); ${sessionIssues.length} invalid record(s)`),
    ];
    const issueLines = [
      ...stateIssues.map(issue => `- ${issue.filePath}: ${issue.detail}`),
      ...sessionIssues.map(issue => `- ${issue.filePath}: ${issue.detail}`),
    ];
    const markdown = [
      '# Kronos Terminal-First Doctor',
      '',
      'Doctor checks provider readiness and the read / insert / monitor / audit ownership boundary. It never runs repairs or project commands.',
      '',
      ...rows,
      ...(issueLines.length > 0 ? ['', '## Local state issues', '', ...issueLines] : []),
      '',
      'Credential values are never displayed.',
      '',
    ].join('\n');
    const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: markdown });
    await vscode.window.showTextDocument(document, { preview: true });
  }

  private async resolveTicketKey(argument: unknown, allowPick: boolean): Promise<string | undefined> {
    const direct = normalizeTicketKey(
      typeof argument === 'string'
        ? argument
        : stringProperty(argument, 'ticketKey') || stringProperty(argument, 'ticket'),
    );
    if (direct && this.state.state?.tickets[direct]) { return direct; }
    if (!allowPick) { return undefined; }
    const entries = Object.entries(this.state.state?.tickets || {});
    if (entries.length === 0) {
      void vscode.window.showWarningMessage('No Jira work is loaded. Refresh Work or run Kronos: Doctor.');
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(entries.map(([ticketKey, ticket]) => ({
      label: ticketKey,
      description: ticket.summary,
      detail: `${ticket.jira_status} • ${ticket.projects.join(', ') || 'unlinked'}`,
      ticketKey,
    })), { title: 'Choose the Jira work item for this terminal action', matchOnDescription: true, matchOnDetail: true });
    return pick?.ticketKey;
  }

  private async resolveWorkSession(argument: unknown, allowPick: boolean): Promise<WorkSessionRecord | undefined> {
    const direct = typeof argument === 'string'
      ? argument
      : stringProperty(argument, 'workSessionId') || stringProperty(argument, 'sessionId');
    if (direct) {
      try {
        const session = readWorkSession(direct);
        if (session) { return session; }
      } catch (error: unknown) {
        this.log('Could not read selected work session.', unknownErrorMessage(error, 'Invalid work session.'));
      }
    }
    const ticketKey = normalizeTicketKey(stringProperty(argument, 'ticketKey'));
    if (ticketKey) {
      const session = getWorkSessionByTicket(ticketKey);
      if (session) { return session; }
    }
    if (!allowPick) { return undefined; }
    const sessions = listWorkSessions();
    const pick = await vscode.window.showQuickPick(sessions.map(session => ({
      label: session.ticketKey,
      description: `${session.status} • ${session.monitoring.enabled ? 'monitoring on' : 'monitoring off'}`,
      detail: session.title,
      session,
    })), { title: 'Choose a managed work session' });
    return pick?.session;
  }

  private gitLabProjectId(ticket: Ticket): string | undefined {
    const config = this.projectConfig(ticket);
    if (config?.gitlab_project_id) { return String(config.gitlab_project_id); }
    return configuredGitLabProjectPathFromMergeRequestUrl(ticket.mr?.url, process.env);
  }

  private async resolveGitLabInsertionTarget(
    ticketKey: string,
    ticket: Ticket,
  ): Promise<GitLabInsertionTarget | undefined> {
    const configuredProject = this.gitLabProjectId(ticket);
    if (ticket.mr?.iid && configuredProject) {
      return { iid: ticket.mr.iid, projectIdOrPath: configuredProject, url: ticket.mr.url };
    }

    const session = getWorkSessionByTicket(ticketKey);
    const savedBinding = [...(session?.providerBindings || [])]
      .reverse()
      .find(binding => binding.provider === 'gitlab' && binding.resource === 'merge-request');
    if (savedBinding && /^[1-9][0-9]*$/.test(savedBinding.subjectId)) {
      const iid = Number(savedBinding.subjectId);
      const projectIdOrPath = savedBinding.projectId
        || configuredGitLabProjectPathFromMergeRequestUrl(savedBinding.url, process.env);
      if (Number.isSafeInteger(iid) && projectIdOrPath) {
        const target: GitLabInsertionTarget = { iid, projectIdOrPath };
        if (savedBinding.url) { target.url = savedBinding.url; }
        return target;
      }
    }

    const value = await vscode.window.showInputBox({
      title: `Connect a GitLab merge request to ${ticketKey}`,
      prompt: configuredProject
        ? 'Paste the merge-request URL or enter its numeric IID. Kronos saves the binding only in the local work session.'
        : 'Paste the full merge-request URL. Its origin must match the configured GitLab API.',
      placeHolder: 'https://gitlab.example/group/project/-/merge_requests/77',
      ignoreFocusOut: true,
    });
    const candidate = value?.trim();
    if (!candidate) { return undefined; }
    if (/^[1-9][0-9]*$/.test(candidate)) {
      const iid = Number(candidate);
      if (Number.isSafeInteger(iid) && configuredProject) {
        return { iid, projectIdOrPath: configuredProject };
      }
      void vscode.window.showWarningMessage('A numeric MR IID also needs a configured GitLab project ID or an existing linked MR URL.');
      return undefined;
    }
    let iid: number | undefined;
    try {
      const parsed = new URL(candidate);
      const match = /\/-\/merge_requests\/([1-9][0-9]*)(?:\/|$)/.exec(parsed.pathname);
      const numeric = match?.[1] ? Number(match[1]) : Number.NaN;
      if (Number.isSafeInteger(numeric)) { iid = numeric; }
    } catch {
      iid = undefined;
    }
    const projectIdOrPath = configuredGitLabProjectPathFromMergeRequestUrl(candidate, process.env);
    if (!iid || !projectIdOrPath) {
      void vscode.window.showWarningMessage('That MR URL is invalid or outside the configured GitLab origin. Run Kronos: Doctor to check GitLab configuration.');
      return undefined;
    }
    return { iid, projectIdOrPath, url: candidate };
  }

  private projectConfig(ticket: Ticket): ProjectConfig | undefined {
    const projectName = ticket.projects[0];
    return projectName ? this.state.state?.projects[projectName]?.config : undefined;
  }

  private appendContextEvent(
    session: WorkSessionRecord,
    source: 'jira' | 'gitlab' | 'kronos',
    subjectId: string,
    artifactPath: string,
    contentSha256: string,
  ): void {
    appendMonitorEvent({
      sessionId: session.id,
      type: 'context.inserted',
      source,
      summary: `${session.ticketKey} ${source} context reference inserted without submission.`,
      subject: { kind: source === 'gitlab' ? 'merge-request' : source === 'jira' ? 'ticket' : 'ci-context', id: subjectId, ticketKey: session.ticketKey },
      artifactPath,
      metadata: { submitted: false, artifactSha256: contentSha256 },
    });
  }

  private appendTerminalDetachedEvent(binding: OperatorTerminalBinding, reason: string): void {
    const session = readWorkSession(binding.sessionId);
    if (!session) { return; }
    appendMonitorEvent({
      sessionId: session.id,
      type: 'terminal.detached',
      source: 'operator',
      summary: `${session.ticketKey} operator terminal detached.`,
      subject: { kind: 'work-session', id: session.id, ticketKey: session.ticketKey },
      metadata: { reason },
    });
  }

  private handleClosedTerminal(terminal: vscode.Terminal): void {
    const binding = this.operatorTerminals.detachTerminal(terminal);
    if (!binding) { return; }
    try {
      detachWorkSessionTerminal(binding.sessionId, binding.bindingId, 'Terminal closed by the operator.');
      this.appendTerminalDetachedEvent(binding, 'closed-by-operator');
    } catch (error: unknown) {
      this.log('Could not persist a closed terminal attachment.', unknownErrorMessage(error, 'Terminal detach failed.'));
    }
    this.refreshTerminalFirstViews();
  }

  private refreshTerminalFirstViews(): void {
    this.workTree.refresh();
    this.sessionTree.refresh();
    this.attentionTree.refresh();
    this.refreshTicketPanels();
  }

  private async runProgress(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<void>,
  ): Promise<void> {
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task);
    } catch (error: unknown) {
      const detail = unknownErrorMessage(error, `${title} failed.`);
      this.log(title, detail);
      void vscode.window.showErrorMessage(detail);
    }
  }

  private async openLocalArtifact(filePath: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(document, { preview: true });
  }

  private async openHttpUrl(value: string): Promise<void> {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') { throw new Error('Only HTTP(S) provider URLs are allowed.'); }
      url.username = '';
      url.password = '';
      await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
    } catch (error: unknown) {
      void vscode.window.showWarningMessage(unknownErrorMessage(error, 'Kronos refused an invalid provider URL.'));
    }
  }

  private log(message: string, detail?: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
    if (detail) { this.output.appendLine(detail); }
  }
}

function normalizeTicketKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z][A-Z0-9_]{0,127}-[1-9][0-9]*$/.test(normalized) ? normalized : undefined;
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) { return undefined; }
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function doctorRow(label: string, passed: boolean, detail: string): string {
  return `- ${passed ? 'PASS' : 'NEEDS ATTENTION'} — **${label}**: ${detail}`;
}
