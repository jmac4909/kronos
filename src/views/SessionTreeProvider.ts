import * as vscode from 'vscode';
import * as path from 'path';
import { KronosState } from '../state/KronosState';
import { ClaudeSession } from '../state/types';

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _timer: NodeJS.Timeout | undefined;

  constructor(private kronosState: KronosState) {
    kronosState.onDidSessionChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this._timer = setInterval(async () => {
      await this.kronosState.refreshSessions();
    }, intervalMs);
    this.kronosState.refreshSessions();
  }

  stopPolling(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SessionTreeItem[] {
    const sessions = this.kronosState.sessions;
    if (sessions.length === 0) {
      const empty = new SessionTreeItem('No active sessions', {
        pid: 0,
        cwd: '',
        kind: '',
        startedAt: 0,
        sessionId: '',
        status: '',
      });
      return [empty];
    }

    return sessions.map(s => new SessionTreeItem(
      `${path.basename(s.cwd)} (pid ${s.pid})`,
      s
    ));
  }

  dispose(): void {
    this.stopPolling();
  }
}

class SessionTreeItem extends vscode.TreeItem {
  constructor(label: string, session: ClaudeSession) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'session';

    if (session.pid === 0) {
      return;
    }

    this.description = session.status;
    const started = new Date(session.startedAt);
    this.tooltip = `PID: ${session.pid}\nDirectory: ${session.cwd}\nStatus: ${session.status}\nStarted: ${started.toLocaleTimeString()}`;

    const icon = session.status === 'busy' ? 'play' : 'circle-outline';
    const color = session.status === 'busy'
      ? new vscode.ThemeColor('charts.blue')
      : new vscode.ThemeColor('testing.iconPassed');
    this.iconPath = new vscode.ThemeIcon(icon, color);
  }
}
